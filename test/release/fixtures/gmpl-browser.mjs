import {gmplArtifacts,createGmplCatalog,gmplCatalogDocument,createGmplDomainBinding,createGmplRecipe,
  GMPL_STAGES,gmplSchemaOf,renderGmplPrompt,materializeGmplTemplate,instantiateGmplPattern} from '@tangleai/gmpl';
import {createMasRegistrySnapshot,createMasConfigCatalog} from '@tangleai/mas';
const unwrap=r=>{if(!r.valid)throw Error(JSON.stringify(r.issues));return r.value;};
export async function qualifyGmplBrowser(){
  const domain=unwrap(await createGmplDomainBinding({id:'browser',title:'Browser content',payloadSchema:gmplSchemaOf('gmplInput'),projection:{id:'text-answer',version:'1',kind:'text',scale:null},rolePrompts:{},requiredCapabilities:[]}));
  const recipe=unwrap(await createGmplRecipe({id:'browser-analysis',parameters:{pattern:'parallel-analysis'},stages:[...GMPL_STAGES['parallel-analysis']]}));
  const catalog=unwrap(await createGmplCatalog(await gmplCatalogDocument({id:'browser',prompts:gmplArtifacts.prompts,domains:[domain],recipes:[recipe]})));
  const rendered=unwrap(renderGmplPrompt(catalog.prompt('analysis-analyst'),{query:'Literal {{text}}',evidence:[],context:{participant:'analyst-1'}}));
  const registry=unwrap(await createMasRegistrySnapshot({$masRegistry:'0.1',registryId:'browser',roles:[],handlers:[],tools:[],contextAdapters:[],messageAdapters:[],subgraphs:[],templates:[]}));
  const config=unwrap(await createMasConfigCatalog({profiles:['browser'],tools:[],contexts:[]})),host={registry,config,profile:'browser'};
  const materialized=unwrap(await materializeGmplTemplate(recipe,domain,host,catalog));
  const instance=unwrap(await instantiateGmplPattern(materialized,{},host,catalog));
  return {packs:gmplArtifacts.prompts.length,rendered:rendered.user,nodes:instance.validated.workflow.nodes.length,version:instance.validated.versionId};
}
