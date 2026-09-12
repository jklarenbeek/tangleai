import { JarenValidator } from '@jarenjs/validate';
import { compileJSONPointer } from '@jarenjs/json/pointer';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import gmplSchema from '../schemas/gmpl.schema.json' with {type:'json'};
import { gmplRefuse,type GmplOutcome } from './errors.ts';
import { immutableJson } from './identity.ts';
export {gmplSchema};
export type SchemaName=keyof typeof gmplSchema.$defs;
export type JsonSchema=Record<string,unknown>|boolean;
type Validator=(value:unknown)=>{valid:boolean;errors?:Array<{instancePath?:string;message?:string}>};
export function compileGmplSchema(schema:JsonSchema):Validator{
  const v=new JarenValidator({skipErrors:false,collectErrors:true,unknownFormats:'ignore'});
  return v.compile(schema as Record<string,unknown>) as Validator;
}
const schemas=new Map<SchemaName,Record<string,unknown>>();
/** Bundle only reachable local definitions, so role requests expose no unrelated schemas. */
export function gmplSchemaOf(name:SchemaName):Record<string,unknown>{
  const cached=schemas.get(name);if(cached)return cached;
  const defs:Record<string,unknown>={};
  const visit=(value:unknown):void=>{
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach(visit);return;}
    const ref=(value as Record<string,unknown>).$ref;
    if(typeof ref==='string'&&ref.startsWith('#/$defs/')){
      const key=ref.slice(8);
      if(!Object.hasOwn(defs,key)){const found=compileJSONPointer(ref.slice(1))(gmplSchema);defs[key]=found;visit(found);}
    }
    Object.values(value).forEach(visit);
  };
  const value=gmplSchema.$defs[name];visit(value);
  const result=immutableJson({$id:`https://tangleai.dev/schemas/gmpl/${name}`,...value,$defs:defs});schemas.set(name,result);return result;
}
const validators=new Map<SchemaName,Validator>();
export function validateGmplShape<T>(name:SchemaName,value:unknown):GmplOutcome<T>{
  try{
    canonicalizeJson(value);
    let validate=validators.get(name);if(!validate){validate=compileGmplSchema(gmplSchemaOf(name));validators.set(name,validate);}
    const result=validate(value);
    if(!result.valid)return gmplRefuse('TGMPL1001',result.errors?.[0]?.instancePath??'',result.errors?.[0]?.message??`invalid ${name}`);
    return {valid:true,value:immutableJson(value) as T};
  }catch(error){return gmplRefuse('TGMPL1001','',`invalid ${name}`,error);}
}
