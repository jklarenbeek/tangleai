/** One bounded structured-output repair loop owns every candidate proposal. */
import {createStructuredOutput,unfence} from '@tangleai/models/structured';
import {renderGmplPrompt,type GmplPromptArtifact} from '@tangleai/gmpl';
import {MasBudgetStop,type MasChatClient} from '@tangleai/mas';
import {heraSchemaOf,validateHeraShape} from './schema.ts';
import {heraRevisionOf} from './identity.ts';
import {HeraRefusal,heraIssue} from './errors.ts';
import {validateHeraTopology,type HeraTopologyRegistry} from './topology.ts';
import type {HeraControlReceipts} from './operations.ts';
import {heraProfileView,heraExperienceView} from './views.ts';
import type {HeraBudget,HeraExperience,HeraLearningSnapshot,HeraPlanOutput,HeraProfile,HeraTask,HeraTopology,HeraIssue} from './contracts.gen.ts';
export interface HeraOrchestration {topologies:HeraTopology[];candidates:Array<{index:number;topology:HeraTopology}>;failures:HeraIssue[];refusals:{invalidCandidates:number;duplicateCandidates:number;appliedNotOffered:number};}
export async function orchestrate(task:HeraTask,snapshot:HeraLearningSnapshot,profile:HeraProfile,offered:readonly HeraExperience[],
  host:HeraTopologyRegistry&{artifact:GmplPromptArtifact;clientFor:(index:number)=>MasChatClient;receipts:HeraControlReceipts},
  options:{groupId:string;configRevision:string;caps:HeraBudget}):Promise<HeraOrchestration> {
  const rendered=renderGmplPrompt(host.artifact,{phase:'plan',query:task.query,profile:heraProfileView(profile),offered_experiences:offered.map(heraExperienceView),
    agents:host.agents.map(({id,title,tools})=>({id,title,tools})),caps:options.caps});
  if(!rendered.valid)throw new HeraRefusal(rendered.issues.map(i=>heraIssue('THERA1001',i.path,i.detail,i)));
  const result:HeraOrchestration={topologies:[],candidates:[],failures:[],refusals:{invalidCandidates:0,duplicateCandidates:0,appliedNotOffered:0}},seen=new Set<string>();
  for(let index=0;index<snapshot.config.groupSize;index++){
    const id=await heraRevisionOf([options.groupId,'topology',index]);
    const topology=(plan:HeraPlanOutput):HeraTopology=>({id,scope:task.scope,taskId:task.id,snapshotId:snapshot.id,profile,
      nodes:plan.nodes.map(node=>({...node,promptVersionId:snapshot.activePromptVersionIds[node.agentId]??'unregistered'})),
      offeredExperienceIds:offered.map(e=>e.id),appliedExperienceIds:plan.appliedExperienceIds,
      generator:{kind:'orchestrator',configRevision:options.configRevision},validation:{valid:true,issues:[]},workflowVersionId:null});
    try{
      const generated=await createStructuredOutput({client:host.receipts.client('plan/'+index,host.clientFor(index)),schema:heraSchemaOf('heraPlanOutput'),maxRepairs:1,
        gate(value){const checked=validateHeraTopology(topology(value as HeraPlanOutput),snapshot,host,options.caps);
          return checked.valid?true:{valid:false,errors:checked.issues.map(i=>({code:i.code,docPath:i.path,message:i.detail}))};}})
        .generate([{role:'system',content:rendered.value.system},{role:'user',content:rendered.value.user}]);
      if(generated.errors){
        const issues=generated.errors.map(i=>heraIssue('THERA1003',i.docPath??i.instancePath,i.message));
        let raw:unknown=generated.raw;try{raw=JSON.parse(unfence(generated.raw));}catch{/* Retain invalid JSON as text. */}
        const shape=validateHeraShape<HeraPlanOutput>('heraPlanOutput',raw);
        const invalid=topology(shape.valid?shape.value:{nodes:[],appliedExperienceIds:[]});
        invalid.validation={valid:false,issues};invalid.rawProposal=raw;result.topologies.push(invalid);
        if(!validateHeraShape('heraTopology',invalid).valid){invalid.nodes=[];invalid.appliedExperienceIds=[];}
        result.refusals.invalidCandidates++;result.refusals.appliedNotOffered+=Number(issues.some(i=>i.path.startsWith('/appliedExperienceIds/')));result.failures.push(...issues);continue;
      }
      const candidate=topology(generated.value as HeraPlanOutput),fingerprint=await heraRevisionOf({nodes:candidate.nodes,appliedExperienceIds:candidate.appliedExperienceIds});
      if(seen.has(fingerprint)){result.refusals.duplicateCandidates++;continue;}
      seen.add(fingerprint);result.topologies.push(candidate);result.candidates.push({index,topology:candidate});
    }catch(error){
      // An unresolved purchase must remain retryable as a receipt, not finalize a competing group.
      if(error instanceof HeraRefusal&&error.issues.some(i=>i.path==='/operation'||i.path==='/operation/binding'))throw error;
      result.failures.push(...(error instanceof HeraRefusal?error.issues:[heraIssue(error instanceof MasBudgetStop?'THERA1007':'THERA1009','/generation/'+index,error instanceof Error?error.message:String(error))]));
      if(error instanceof MasBudgetStop)break;
    }
  }
  return result;
}
