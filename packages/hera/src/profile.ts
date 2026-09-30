/** The authored orchestrator profiles text; the host supplies the vector identity. */
import {createStructuredOutput} from '@tangleai/models/structured';
import type {Embedder} from '@tangleai/models/embed';
import {renderGmplPrompt,type GmplPromptArtifact} from '@tangleai/gmpl';
import type {MasChatClient} from '@tangleai/mas';
import {heraSchemaOf,validateHeraShape} from './schema.ts';
import {HeraRefusal,heraIssue} from './errors.ts';
import type {HeraBudget,HeraProfile,HeraTask,HeraLearningSnapshot,HeraQueryProfileOutput} from './contracts.gen.ts';
import type {HeraControlReceipts} from './operations.ts';
export async function profileQuery(task:HeraTask,snapshot:HeraLearningSnapshot,host:{artifact:GmplPromptArtifact;client:MasChatClient;embedder:Embedder;receipts:HeraControlReceipts},caps:HeraBudget):Promise<HeraProfile> {
  const initial:HeraProfile={text:task.query,tags:[],embedding:[],embeddedBy:snapshot.identities.embeddedBy};
  const rendered=renderGmplPrompt(host.artifact,{phase:'profile',query:task.query,profile:initial,offered_experiences:[],agents:[],caps});
  if(!rendered.valid)throw new HeraRefusal(rendered.issues.map(i=>heraIssue('THERA1001',i.path,i.detail,i)));
  const result=await createStructuredOutput({client:host.receipts.client('profile',host.client),schema:heraSchemaOf('heraQueryProfileOutput'),maxRepairs:1})
    .generate([{role:'system',content:rendered.value.system},{role:'user',content:rendered.value.user}]);
  if(result.errors)throw new HeraRefusal(result.errors.map(i=>heraIssue('THERA1001',i.instancePath,i.message)));
  const value=result.value as HeraQueryProfileOutput;
  const embedding=await host.receipts.embed('profile/embedding',value.text,async signal=>{
    const vectors=await host.embedder.embed([value.text],{signal}),vector=Array.from(vectors[0]??[]);
    if(vectors.length!==1||vector.length!==snapshot.identities.embeddedBy.dims||!vector.every(Number.isFinite))
      throw new HeraRefusal([heraIssue('THERA1009','/embedding','The embedder returned an invalid profile vector.')]);
    return vector;
  });
  const profile={...value,embedding,embeddedBy:snapshot.identities.embeddedBy},checked=validateHeraShape<HeraProfile>('heraProfile',profile);
  if(!checked.valid)throw new HeraRefusal(checked.issues);return checked.value;
}
