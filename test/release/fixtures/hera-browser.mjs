import {createGmplCatalog,renderGmplPrompt} from '@tangleai/gmpl';
import {createMasRegistrySnapshot} from '@tangleai/mas';
import {heraArtifacts,heraRegistryDocument,createHeraAgents,createMemoryHeraStore,emptyHeraHead,planHeraHeadTransition} from '@tangleai/hera';
const unwrap=result=>{if(!result.valid)throw Error(JSON.stringify(result.issues));return result.value;};
export async function qualifyHeraBrowser(){
  const catalog=unwrap(await createGmplCatalog(heraArtifacts));
  const registry=unwrap(await createMasRegistrySnapshot(unwrap(await heraRegistryDocument(catalog))));
  const created=unwrap(await createHeraAgents(catalog,{scope:'browser',profile:'scripted',at:'2020-01-01T00:00:00.000Z'}));
  const store=createMemoryHeraStore({scope:'browser'});
  unwrap(await store.putAgent(created.agents[0],{scope:'browser',mode:'learn'}));
  const rendered=unwrap(renderGmplPrompt(catalog.prompt('hera-conclude-agent'),{query:'Literal {{question}}',evidence:[]}));
  let head=emptyHeraHead('browser','library');head=unwrap(planHeraHeadTransition(head,head,'a'.repeat(64))).next;const stale=head;
  head=unwrap(planHeraHeadTransition(head,head,'b'.repeat(64))).next;head=unwrap(planHeraHeadTransition(head,head,'a'.repeat(64))).next;
  return {packs:heraArtifacts.prompts.length,roles:registry.document.roles.length,rendered:rendered.user,staleRefused:!planHeraHeadTransition(head,stale,'b'.repeat(64)).valid};
}
