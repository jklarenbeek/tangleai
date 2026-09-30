/** Failure buffers are immutable evidence versions selected by a learning snapshot. */
import {equalsJson} from '@jarenjs/core/object';
import {validateSemanticAdvantage,type HeraReflectionEvidence} from './advantage.ts';
import {validateHeraRecord} from './schema.ts';
import {heraContentIdOf} from './identity.ts';
import {heraRefuse,type HeraOutcome} from './errors.ts';
import type {HeraFailureBuffer,HeraSemanticAdvantage} from './contracts.gen.ts';
export interface HeraFailureCreditPlan {buffers:HeraFailureBuffer[];versions:HeraFailureBuffer[];}
/** Existing order is authoritative; append exact new invocation credits, then drop oldest. */
export async function assignFailureCredit(advantage:HeraSemanticAdvantage,evidence:HeraReflectionEvidence,
  previous:readonly HeraFailureBuffer[],cap:number):Promise<HeraOutcome<HeraFailureCreditPlan>>{
  const fail=(path:string,detail:string)=>heraRefuse<HeraFailureCreditPlan>('THERA1008',path,detail);
  if(!Number.isSafeInteger(cap)||cap<1)return fail('/failureBufferSize','Failure buffers require a positive safe-integer capacity.');
  const checked=await validateHeraRecord('advantage',advantage);if(!checked.valid)return checked;
  if(advantage.scope!==evidence.group.scope||advantage.groupId!==evidence.group.id
    ||!equalsJson([...advantage.sourceTrajectoryIds].sort(),evidence.trajectories.map(t=>t.id).sort()))return fail('/advantage','Failure credit requires the complete source query group.');
  const {successFactors,failureModes,insights,failedInvocationCredit}=advantage;
  const admitted=validateSemanticAdvantage({successFactors,failureModes,insights,failedInvocationCredit},evidence);if(!admitted.valid)return admitted;
  const old=new Map(previous.map(b=>[b.agentId,b]));if(old.size!==previous.length)return fail('/buffers','One frozen buffer version is allowed per role.');
  for(const buffer of previous){const valid=await validateHeraRecord('failureBuffer',buffer);if(!valid.valid)return valid;
    if(buffer.scope!==advantage.scope)return fail('/buffers/scope','A failure buffer crosses the source scope.');}
  const entries=new Map(previous.map(b=>[b.agentId,structuredClone(b.entries)]));
  for(const [index,credit] of failedInvocationCredit.entries()){
    const trajectory=evidence.trajectories.find(t=>t.id===credit.trajectoryId)!,steps=evidence.steps.filter(s=>credit.stepIds.includes(s.id));
    const agentId=steps[0]?.agentId;
    if(!agentId||steps.some(s=>s.agentId!==agentId))return fail('/failedInvocationCredit/'+index,'An invocation credit must identify exactly one role.');
    const held=entries.get(agentId)??[],entry={...structuredClone(credit),advantageId:advantage.id,groupId:advantage.groupId,taskId:trajectory.taskId,snapshotId:trajectory.snapshotId};
    const duplicate=held.find(e=>e.trajectoryId===credit.trajectoryId&&e.invocationId===credit.invocationId);
    if(duplicate&&!equalsJson(duplicate,entry))return fail('/failedInvocationCredit/'+index,'The same invocation already has different frozen credit.');
    if(!duplicate)held.push(entry);entries.set(agentId,held);
  }
  const buffers:HeraFailureBuffer[]=[],versions:HeraFailureBuffer[]=[];
  for(const [agentId,all] of [...entries].sort(([a],[b])=>a<b?-1:a>b?1:0)){
    const retained=all.slice(-cap),prior=old.get(agentId);
    if(prior&&equalsJson(prior.entries,retained)){buffers.push(structuredClone(prior));continue;}
    const content={scope:advantage.scope,agentId,parentId:prior?.id??null,entries:retained},buffer={...content,id:await heraContentIdOf(content)};
    const valid=await validateHeraRecord('failureBuffer',buffer);if(!valid.valid)return valid;buffers.push(buffer);versions.push(buffer);
  }
  return {valid:true,value:{buffers,versions}};
}
