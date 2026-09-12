/** TOML is JOSL's; interpolation/rendering is JTLT's. Only syntax translation lives here. */
import {parseToml} from '@jarenjs/josl';
import {compileJtltStylesheet} from '@jarenjs/json/jtlt';
import {canonicalizeJson} from '@jarenjs/json/canonical';
import {gmplRefuse,type GmplOutcome} from './errors.ts';
import {compileGmplSchema,validateGmplShape,type JsonSchema} from './schema.ts';
import {gmplTextDigest,gmplRevisionOf,gmplVersionOf,immutableJson} from './identity.ts';
import type {GmplPromptArtifact,GmplPromptPack,GmplRoleVersion,GmplVariables} from './contracts.gen.ts';
export interface CompileGmplPromptOptions {variables:GmplVariables;outputSchema:JsonSchema;}
interface Rule {match?:unknown;mode?:string;priority?:number;body:unknown[];}
function textTemplate(text:string,variables:GmplVariables){
  const required=new Set<string>(),used=new Set<string>();const rules:Rule[]=[];
  let offset=0,serial=0;
  const name=(s:string):string=>{
    if(!/^[a-z][a-z0-9_]*$/.test(s)||['constructor','prototype','__proto__'].includes(s)||!Object.hasOwn(variables,s))throw Error(`undeclared or prohibited variable '${s}'`);
    used.add(s);return s;
  };
  const scan=(conditional:boolean):unknown[]=>{
    const body:unknown[]=[];
    while(offset<text.length){
      const start=text.indexOf('{{',offset);
      const literal=text.slice(offset,start<0?text.length:start);
      if(literal.includes('}}'))throw Error('unmatched closing delimiter');
      if(literal)body.push(literal.startsWith('$')?'$'+literal:literal);
      if(start<0){offset=text.length;break;}
      const end=text.indexOf('}}',start+2);if(end<0)throw Error('unclosed placeholder');
      const token=text.slice(start+2,end).trim();offset=end+2;
      if(token==='/if'){if(!conditional)throw Error('unexpected /if');return body;}
      if(token.startsWith('#if ')){
        const key=name(token.slice(4).trim()),mode=`condition-${++serial}`,nested=scan(true);
        rules.push({mode,priority:1,match:{schema:{type:'object',required:['present'],properties:{present:{type:'object',required:[key],properties:{[key]:{const:true}}}}}},body:nested},{mode,body:[]});
        body.push({$apply:['$',mode]});
      }else{
        const key=name(token);if(!conditional)required.add(key);
        body.push(variables[key].render==='json'?{$json:`$.variables.${key}`} : `$.variables.${key}`);
      }
    }
    if(conditional)throw Error('unclosed conditional block');
    return body;
  };
  const body=scan(false);
  for(const key of Object.keys(variables))if(!used.has(key))throw Error(`unused variable declaration '${key}'`);
  return {required:[...required].sort(),stylesheet:{$jtlt:'0.1',output:'text',rules:[{match:'$',body},...rules]}};
}
function compileText(doc:unknown){return compileJtltStylesheet(doc,{compileTypeTest:(schema:JsonSchema)=>{const check=compileGmplSchema(schema);return (value:unknown)=>check(value).valid;}});}
export async function compileGmplPromptPack(sourceText:string,options:CompileGmplPromptOptions):Promise<GmplOutcome<GmplPromptArtifact>>{
  try{
    if(typeof sourceText!=='string')throw Error('source must be text');
    const parsed=parseToml(sourceText);
    const shape=validateGmplShape<GmplPromptPack>('gmplPromptPack',parsed);if(!shape.valid)return gmplRefuse('TGMPL1004','/pack','invalid TOML prompt pack',shape.issues[0]);
    const pack=shape.value;
    const vars=validateGmplShape<GmplVariables>('gmplVariables',options.variables);if(!vars.valid)return gmplRefuse('TGMPL1004','/variables','invalid variable declarations');
    if(pack.system.content.includes('{{')||pack.system.content.includes('}}'))throw Error('system instructions are static');
    for(const [key,v] of Object.entries(vars.value)){
      compileGmplSchema(v.schema);
      if(v.render==='text' && (typeof v.schema!=='object'||!['string','number','integer','boolean'].includes(String(v.schema.type))))throw Error(`text variable '${key}' needs a scalar schema`);
    }
    compileGmplSchema(options.outputSchema);
    const compiled=textTemplate(pack.user.content,vars.value);
    const variableSchema={type:'object',properties:Object.fromEntries(Object.entries(vars.value).map(([k,v])=>[k,v.schema])),required:compiled.required,additionalProperties:false};
    compileGmplSchema(variableSchema);compileText(compiled.stylesheet);
    const roleBase={id:pack.meta.role,title:pack.meta.role,instructions:pack.system.content};
    const role:GmplRoleVersion={...roleBase,revision:await gmplRevisionOf(roleBase)};
    const payload={id:pack.meta.id,policyVersion:'gmpl-jtlt-v1' as const,sourceDigest:await gmplTextDigest(sourceText),pack,role,variables:vars.value,variableSchema,outputSchema:options.outputSchema,userStylesheet:compiled.stylesheet};
    return {valid:true,value:immutableJson({...payload,revision:await gmplRevisionOf(payload)})};
  }catch(error){return gmplRefuse('TGMPL1004','/prompt','prompt compilation failed',error);}
}
export async function validateGmplPromptArtifact(value:unknown):Promise<GmplOutcome<GmplPromptArtifact>>{
  const shape=validateGmplShape<GmplPromptArtifact>('gmplPromptArtifact',value);if(!shape.valid)return shape;
  const a=shape.value;
  if(await gmplVersionOf(a)!==a.revision||await gmplVersionOf(a.role)!==a.role.revision)return gmplRefuse('TGMPL1002','/revision','artifact or role revision is stale');
  try{
    const compiled=textTemplate(a.pack.user.content,a.variables);
    const variableSchema={type:'object',properties:Object.fromEntries(Object.entries(a.variables).map(([k,v])=>[k,v.schema])),required:compiled.required,additionalProperties:false};
    if(canonicalizeJson(compiled.stylesheet)!==canonicalizeJson(a.userStylesheet)||canonicalizeJson(variableSchema)!==canonicalizeJson(a.variableSchema)||a.role.id!==a.pack.meta.role||a.role.instructions!==a.pack.system.content||a.id!==a.pack.meta.id)throw Error('compiled contract disagrees with source pack');
    compileText(a.userStylesheet);compileGmplSchema(a.variableSchema);compileGmplSchema(a.outputSchema);
    return shape;
  }catch(error){return gmplRefuse('TGMPL1004','/prompt','artifact compilation contract is invalid',error);}
}
function present(value:unknown):boolean{
  if(value===null||value===undefined||value===false)return false;
  if(typeof value==='number')return Number.isFinite(value)&&value!==0;
  if(typeof value==='string'||Array.isArray(value))return value.length>0;
  if(typeof value==='object')return Object.keys(value).length>0;
  return value===true;
}
/** Call only with a validated immutable catalog artifact; no compile source lookup. */
export function renderGmplPrompt(artifact:GmplPromptArtifact,variables:unknown):GmplOutcome<{system:string;user:string}>{
  try{
    const stable=immutableJson(variables) as Record<string,unknown>;
    if(!compileGmplSchema(artifact.variableSchema)(stable).valid)return gmplRefuse('TGMPL1004','/variables','prompt variables do not match their closed schema');
    const user=compileText(artifact.userStylesheet)({variables:stable,present:Object.fromEntries(Object.keys(artifact.variables).map(k=>[k,present(stable[k])]))});
    return {valid:true,value:{system:artifact.role.instructions,user}};
  }catch(error){return gmplRefuse('TGMPL1004','/variables','prompt rendering failed',error);}
}
