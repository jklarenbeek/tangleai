/** Semantic credit is admitted only against a complete, evaluated query group. */
import {createStructuredOutput} from '@tangleai/models/structured';
import {renderGmplPrompt,type GmplPromptArtifact} from '@tangleai/gmpl';
import type {MasChatClient} from '@tangleai/mas';
import {heraContentIdOf} from './identity.ts';
import {heraSchemaOf,validateHeraShape} from './schema.ts';
import {HeraRefusal,heraIssue,heraRefuse,type HeraOutcome} from './errors.ts';
import {mixedOutcome,rankTrajectories} from './rank.ts';
import {heraProfileView} from './views.ts';
import type {HeraGroupExecution} from './group.ts';
import type {HeraControlReceipts} from './operations.ts';
import type {HeraReflectionOutput,HeraSemanticAdvantage,HeraTask,HeraTrajectoryStep} from './contracts.gen.ts';
export interface HeraReflectionEvidence extends HeraGroupExecution {steps:readonly HeraTrajectoryStep[];}
/** Shared by the proposal repair loop and callers validating retained evidence. */
export function validateSemanticAdvantage(raw:unknown,evidence:HeraReflectionEvidence):HeraOutcome<HeraReflectionOutput>{
  const fail=(path:string,detail:string)=>heraRefuse<HeraReflectionOutput>('THERA1008',path,detail);
  const shaped=validateHeraShape<HeraReflectionOutput>('heraReflectionOutput',raw);if(!shaped.valid)return fail(shaped.issues[0].path,shaped.issues[0].detail);
  const {group,trajectories,steps}=evidence,byTrajectory=new Map(trajectories.map(t=>[t.id,t])),byStep=new Map(steps.map(s=>[s.id,s]));
  if(!mixedOutcome(trajectories).value)return fail('/trajectories','Reflection requires evaluated success and failure in the same group.');
  if(byTrajectory.size!==trajectories.length||trajectories.length!==group.candidateTrajectoryIds.length||trajectories.some(t=>!group.candidateTrajectoryIds.includes(t.id)
    ||t.groupId!==group.id||t.scope!==group.scope||t.taskId!==group.taskId||t.snapshotId!==group.snapshotId))return fail('/trajectories','Reflection requires the complete scoped query group.');
  if(byStep.size!==steps.length||steps.some(s=>s.scope!==group.scope||!byTrajectory.get(s.trajectoryId)?.stepIds.includes(s.id)||!byTrajectory.get(s.trajectoryId)?.invocationOrder.includes(s.invocationId))
    ||trajectories.some(t=>t.stepIds.some(id=>byStep.get(id)?.trajectoryId!==t.id)))return fail('/steps','Every retained step must bind its original group trajectory.');
  const value=shaped.value;
  if(new Set(value.insights.map(i=>i.id)).size!==value.insights.length)return fail('/insights','Insight identities must be unique within an advantage.');
  for(const kind of ['successFactors','failureModes','insights'] as const)for(const [index,item] of value[kind].entries()){
    for(const [j,id] of item.trajectoryIds.entries()){
      const trajectory=byTrajectory.get(id);
      if(!trajectory||trajectory.primaryScore===null||(kind==='successFactors'&&trajectory.success!==true)||(kind==='failureModes'&&trajectory.success!==false))
        return fail('/'+kind+'/'+index+'/trajectoryIds/'+j,'A credit reference must name an evaluated trajectory with the stated outcome.');
    }
    for(const [j,id] of item.stepIds.entries())if(!item.trajectoryIds.includes(byStep.get(id)?.trajectoryId??''))
      return fail('/'+kind+'/'+index+'/stepIds/'+j,'A credit step must belong to one of its cited trajectories.');
  }
  for(const [index,item] of value.failedInvocationCredit.entries()){
    const trajectory=byTrajectory.get(item.trajectoryId),path='/failedInvocationCredit/'+index;
    if(!trajectory||trajectory.primaryScore===null||trajectory.success!==false)return fail(path+'/trajectoryId','Failure credit must name an evaluated failure.');
    if(!trajectory.invocationOrder.includes(item.invocationId))return fail(path+'/invocationId','Failure credit names an unknown invocation.');
    if(!item.stepIds.length)return fail(path+'/stepIds','Failure credit requires retained invocation evidence.');
    for(const [j,id] of item.stepIds.entries()){const step=byStep.get(id);if(!step||step.trajectoryId!==trajectory.id||step.invocationId!==item.invocationId)
      return fail(path+'/stepIds/'+j,'Failure credit must cite steps from its exact invocation.');}
  }
  return {valid:true,value};
}
/** All identifiers survive compaction; potentially large payloads are visibly bounded. */
export function heraReflectionView(evidence:HeraReflectionEvidence){
  const bounded=(value:unknown,limit=256)=>{const text=typeof value==='string'?value:JSON.stringify(value);return {text:text.slice(0,limit),truncated:text.length>limit,originalChars:text.length};};
  return rankTrajectories(evidence.trajectories).ranked.map(t=>({id:t.id,topology:evidence.topologies.find(p=>p.id===t.topologyId)?.nodes??[],answer:bounded(t.answer,512),
    primaryScore:t.primaryScore,success:t.success,tokens:t.tokens,steps:evidence.steps.filter(s=>s.trajectoryId===t.id).map(s=>({id:s.id,invocationId:s.invocationId,
      agentId:s.agentId,promptVersionId:s.promptVersionId,input:bounded(s.inputView),actions:bounded(s.toolSteps),output:bounded(s.transcriptView),usage:s.usage}))}));
}
export async function extractSemanticAdvantage(task:HeraTask,evidence:HeraReflectionEvidence,
  host:{artifact:GmplPromptArtifact;client:MasChatClient;receipts:HeraControlReceipts}):Promise<HeraSemanticAdvantage|null>{
  if(task.id!==evidence.group.taskId||task.scope!==evidence.group.scope)throw new HeraRefusal([heraIssue('THERA1008','/task','Reflection must bind the evaluated query group.')]);
  if(!mixedOutcome(evidence.trajectories).value)return null;
  if(!evidence.group.profile)throw new HeraRefusal([heraIssue('THERA1008','/profile','Reflection requires the retained query profile.')]);
  const rendered=renderGmplPrompt(host.artifact,{query:task.query,profile:heraProfileView(evidence.group.profile),trajectories:heraReflectionView(evidence)});
  if(!rendered.valid)throw new HeraRefusal(rendered.issues.map(i=>heraIssue('THERA1001',i.path,i.detail,i)));
  const generated=await createStructuredOutput({client:host.receipts.client('learn/reflection',host.client),schema:heraSchemaOf('heraReflectionOutput'),maxRepairs:1,
    gate(value){const checked=validateSemanticAdvantage(value,evidence);return checked.valid?true:{valid:false,errors:checked.issues.map(i=>({code:i.code,docPath:i.path,message:i.detail}))};}})
    .generate([{role:'system',content:rendered.value.system},{role:'user',content:rendered.value.user}]);
  if(generated.errors)throw new HeraRefusal(generated.errors.map(i=>heraIssue('THERA1008',i.docPath??i.instancePath,i.message)));
  const content={...generated.value as HeraReflectionOutput,scope:task.scope,groupId:evidence.group.id,
    promptVersionIds:[...new Set(evidence.steps.map(s=>s.promptVersionId))].sort(),sourceTrajectoryIds:evidence.trajectories.map(t=>t.id).sort()};
  return {...content,id:await heraContentIdOf(content)};
}
