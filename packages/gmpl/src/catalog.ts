/** Immutable, detached artifact sets; no process-wide mutable role/domain registry. */
import {gmplRefuse,type GmplOutcome} from './errors.ts';
import {gmplRevisionOf,gmplVersionOf,immutableJson} from './identity.ts';
import {validateGmplShape,compileGmplSchema} from './schema.ts';
import {validateGmplPromptArtifact} from './prompts.ts';
import type {GmplCatalogDocument,GmplPromptArtifact,GmplDomainBinding,GmplPatternRecipe,GmplPatternParameters} from './contracts.gen.ts';
export interface GmplCatalog {
  document:GmplCatalogDocument;
  prompt:(id:string)=>GmplPromptArtifact|undefined;
  domain:(id:string)=>GmplDomainBinding|undefined;
  recipe:(id:string)=>GmplPatternRecipe|undefined;
}
export async function createGmplDomainBinding(document:Omit<GmplDomainBinding,'revision'>):Promise<GmplOutcome<GmplDomainBinding>>{
  try{
    const value={...document,revision:await gmplRevisionOf(document)};
    const shape=validateGmplShape<GmplDomainBinding>('gmplDomainBinding',value);if(!shape.valid)return shape;
    compileGmplSchema(shape.value.payloadSchema);
    const p=shape.value.projection;
    if((p.kind==='numeric'&&(!p.scale||p.scale.minimum>=p.scale.maximum))||(p.kind==='text'&&p.scale!==null))return gmplRefuse('TGMPL1001','/projection/scale','projection scale disagrees with its kind');
    return shape;
  }catch(error){return gmplRefuse('TGMPL1001','/domain','invalid domain',error);}
}
export async function createGmplRecipe(document:Omit<GmplPatternRecipe,'revision'>):Promise<GmplOutcome<GmplPatternRecipe>>{
  try{return validateGmplShape<GmplPatternRecipe>('gmplPatternRecipe',{...document,revision:await gmplRevisionOf(document)});}
  catch(error){return gmplRefuse('TGMPL1001','/recipe','invalid recipe',error);}
}
export async function createGmplCatalog(document:unknown):Promise<GmplOutcome<GmplCatalog>>{
  const shape=validateGmplShape<GmplCatalogDocument>('gmplCatalogDocument',document);if(!shape.valid)return shape;
  const value=shape.value;
  if(await gmplVersionOf(value)!==value.revision)return gmplRefuse('TGMPL1002','/revision','catalog revision is stale');
  for(const section of ['prompts','domains','recipes'] as const){
    if(new Set(value[section].map(v=>v.id)).size!==value[section].length)return gmplRefuse('TGMPL1001',`/${section}`,'duplicate artifact id');
    for(const item of value[section])if(await gmplVersionOf(item)!==item.revision)return gmplRefuse('TGMPL1002','/revision',`stale ${section} artifact '${item.id}'`);
  }
  for(const prompt of value.prompts){const valid=await validateGmplPromptArtifact(prompt);if(!valid.valid)return valid;}
  for(const domain of value.domains){
    const {revision:_,...base}=domain;const valid=await createGmplDomainBinding(base);if(!valid.valid)return valid;
    for(const id of Object.values(domain.rolePrompts))if(!value.prompts.some(p=>p.id===id))return gmplRefuse('TGMPL1003','/domains/rolePrompts',`unknown prompt '${id}'`);
  }
  for(const recipe of value.recipes)for(const stage of recipe.stages)if(!value.prompts.some(p=>p.id===stage))return gmplRefuse('TGMPL1003','/recipes/stages',`unknown stage '${stage}'`);
  const prompts=new Map(value.prompts.map(p=>[p.id,p])),domains=new Map(value.domains.map(d=>[d.id,d])),recipes=new Map(value.recipes.map(r=>[r.id,r]));
  return {valid:true,value:Object.freeze({document:value,prompt:(id:string)=>prompts.get(id),domain:(id:string)=>domains.get(id),recipe:(id:string)=>recipes.get(id)})};
}
export async function gmplCatalogDocument(document:Omit<GmplCatalogDocument,'revision'>):Promise<GmplCatalogDocument>{return immutableJson({...document,revision:await gmplRevisionOf(document)});}
export const GMPL_LIMITS=Object.freeze({calls:128,tokens:131072,ms:120000,toolRounds:1,fanOut:20,concurrency:4,iterations:10,contextChars:65536,traceBytes:1048576});
export function resolveGmplParameters(value:unknown):GmplOutcome<GmplPatternParameters>{
  const shape=validateGmplShape<GmplPatternParameters>('gmplPatternParameters',value);if(!shape.valid)return shape;
  const p=shape.value;
  switch(p.pattern){
    case 'parallel-analysis':return {valid:true,value:immutableJson({participants:2,...p})};
    case 'peer-review':return {valid:true,value:immutableJson({participants:2,maxRounds:3,threshold:0.7,...p})};
    case 'red-team':return {valid:true,value:immutableJson({participants:1,maxRounds:3,threshold:0.7,...p})};
    case 'structured-debate':return {valid:true,value:immutableJson({participants:2,maxRounds:3,...p})};
    case 'clarification':return {valid:true,value:immutableJson({maxTurns:5,...p})};
    case 'delphi-panel':return {valid:true,value:immutableJson({participants:5,maxRounds:3,threshold:0.2,peerHistory:true,...p})};
  }
}
