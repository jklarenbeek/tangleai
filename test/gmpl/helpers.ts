import assert from 'node:assert/strict';
import {createMasRegistrySnapshot,createMasConfigCatalog} from '@tangleai/mas';
import {gmplArtifacts,createGmplCatalog,gmplCatalogDocument,createGmplDomainBinding,createGmplRecipe,gmplSchemaOf,
  materializeGmplTemplate,instantiateGmplPattern,type GmplPatternParameters} from '@tangleai/gmpl';
export async function fixtureCatalog(parameters:GmplPatternParameters={pattern:'parallel-analysis'},options:{profile?:string;limits?:Record<string,number>;domainId?:string}={}){
  const domain=await createGmplDomainBinding({id:options.domainId??'document-review',title:'Document review',payloadSchema:gmplSchemaOf('gmplInput'),projection:{id:'text-answer',version:'1',kind:'text',scale:null},rolePrompts:{},requiredCapabilities:[]});assert.ok(domain.valid);
  const recipe=await createGmplRecipe({id:parameters.pattern,parameters,stages:['analysis-analyst','analysis-merge']});assert.ok(recipe.valid);
  const document=await gmplCatalogDocument({id:gmplArtifacts.id,prompts:gmplArtifacts.prompts as never,domains:[domain.value],recipes:[recipe.value]});
  const catalog=await createGmplCatalog(document);assert.ok(catalog.valid,JSON.stringify(catalog));
  const registry=await createMasRegistrySnapshot({$masRegistry:'0.1',registryId:'gmpl-test',roles:[],handlers:[],tools:[],contextAdapters:[],messageAdapters:[],subgraphs:[],templates:[]});assert.ok(registry.valid);
  const config=await createMasConfigCatalog({profiles:[options.profile??'scripted-v1'],tools:[],contexts:[],...(options.limits?{limits:options.limits}:{})});assert.ok(config.valid);
  const host={registry:registry.value,config:config.value,profile:options.profile??'scripted-v1'};
  return {catalog:catalog.value,host,recipe:recipe.value,domain:domain.value};
}
export async function preparedAnalysis(participants=2,concurrency=4){
  const fixture=await fixtureCatalog({pattern:'parallel-analysis',participants},{limits:{concurrency}});
  const materialized=await materializeGmplTemplate(fixture.recipe,fixture.domain,fixture.host,fixture.catalog);assert.ok(materialized.valid,JSON.stringify(materialized));
  const instance=await instantiateGmplPattern(materialized.value,{},fixture.host,fixture.catalog);assert.ok(instance.valid,JSON.stringify(instance));
  return {...fixture,materialized:materialized.value,instance:instance.value};
}
