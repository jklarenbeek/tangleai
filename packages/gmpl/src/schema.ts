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
/** Bundle a domain definition's reachable references for an independent role schema. */
export function gmplSchemaDefinition(document:Record<string,unknown>,name:string,id:string):Record<string,unknown>{
  const defs:Record<string,unknown>={};
  const visit=(value:unknown):void=>{
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach(visit);return;}
    const ref=(value as Record<string,unknown>).$ref;
    if(typeof ref==='string'&&ref.startsWith('#/$defs/')){
      const key=ref.slice(8);
      if(!Object.hasOwn(defs,key)){const found=compileJSONPointer(ref.slice(1))(document);if(found===undefined)throw Error(`Unknown schema reference ${ref}`);defs[key]=found;visit(found);}
    }
    Object.values(value).forEach(visit);
  };
  const value=(document.$defs as Record<string,Record<string,unknown>>)[name];
  if(!value)throw Error(`Unknown schema definition ${name}`);
  visit(value);
  return immutableJson({$id:id,...value,$defs:defs});
}
/** Bundle only reachable local definitions, so role requests expose no unrelated schemas. */
export function gmplSchemaOf(name:SchemaName):Record<string,unknown>{
  const cached=schemas.get(name);if(cached)return cached;
  const result=gmplSchemaDefinition(gmplSchema,name,`https://tangleai.dev/schemas/gmpl/${name}`);schemas.set(name,result);return result;
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
