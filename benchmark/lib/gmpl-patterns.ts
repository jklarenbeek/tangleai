/** Public content composition for the measured MAS host, with no provider default. */
import {createMasRegistrySnapshot,createMasConfigCatalog} from '@tangleai/mas';
import {GMPL_STAGES,gmplArtifacts,gmplCatalogDocument,createGmplCatalog,createGmplDomainBinding,createGmplRecipe,gmplSchemaOf,
  materializeGmplTemplate,instantiateGmplPattern,createGmplHostBindings,type GmplPatternParameters,type GmplPromptArtifact,type GmplDomainBinding,type GmplAnswerProjector} from '@tangleai/gmpl';
export async function prepareGmplPattern(parameters:GmplPatternParameters={pattern:'parallel-analysis'},scope:'pattern'|'round'='pattern',options:{domain?:Omit<GmplDomainBinding,'revision'>;answerProjector?:GmplAnswerProjector;profile?:string}={}){
  const domain=await createGmplDomainBinding(options.domain??{id:'document-review',title:'Document review',payloadSchema:gmplSchemaOf('gmplInput'),projection:{id:'text-answer',version:'1',kind:'text',scale:null},rolePrompts:{},requiredCapabilities:[]});if(!domain.valid)throw Error(JSON.stringify(domain.issues));
  const recipe=await createGmplRecipe({id:parameters.pattern,scope,parameters,stages:[...GMPL_STAGES[parameters.pattern]]});if(!recipe.valid)throw Error(JSON.stringify(recipe.issues));
  const catalog=await createGmplCatalog(await gmplCatalogDocument({id:'gmpl-measurement',prompts:gmplArtifacts.prompts as GmplPromptArtifact[],domains:[domain.value],recipes:[recipe.value]}));if(!catalog.valid)throw Error(JSON.stringify(catalog.issues));
  const registry=await createMasRegistrySnapshot({$masRegistry:'0.1',registryId:'gmpl-measurement',roles:[],handlers:[],tools:[],contextAdapters:[],messageAdapters:[],subgraphs:[],templates:[]});
  const config=await createMasConfigCatalog({profiles:[options.profile??'scripted-v1'],tools:[],contexts:[]});if(!registry.valid||!config.valid)throw Error('invalid host registry');
  const host={registry:registry.value,config:config.value,profile:options.profile??'scripted-v1'};
  const materialized=await materializeGmplTemplate(recipe.value,domain.value,host,catalog.value);if(!materialized.valid)throw Error(JSON.stringify(materialized.issues));
  const instance=await instantiateGmplPattern(materialized.value,{},host,catalog.value);if(!instance.valid)throw Error(JSON.stringify(instance.issues));
  const bindings=createGmplHostBindings(materialized.value,catalog.value,{answerProjector:options.answerProjector});if(!bindings.valid)throw Error(JSON.stringify(bindings.issues));
  return {...instance.value,bindings:bindings.value,contentCatalog:catalog.value,host};
}
