/** Whole-topology prompt trials retain both proposal and measured contrast receipts. */
import {equalsJson} from '@jarenjs/core/object';
import {createStructuredOutput} from '@tangleai/models/structured';
import {renderGmplPrompt,type GmplPromptArtifact} from '@tangleai/gmpl';
import type {RunIdentity} from '@tangleai/config';
import type {MasChatClient} from '@tangleai/mas';
import {createHeraExecutor,heraExecutionId,type HeraExecuteRequest} from './executor.ts';
import type {HeraGroupHost} from './group.ts';
import {createHeraPromptVersion} from './prompt.ts';
import {integratePrompt} from './integrate.ts';
import {heraContentIdOf,heraRevisionOf} from './identity.ts';
import {heraSchemaOf,validateHeraRecord,validateHeraShape} from './schema.ts';
import {emptyHeraUsage,type HeraControlReceipts} from './operations.ts';
import {HeraRefusal,heraIssue,type HeraOutcome} from './errors.ts';
import type {HeraAgentDefinition,HeraFailureBuffer,HeraLearningSnapshot,HeraTask,HeraRopeOutput,HeraPromptTrial,HeraPromptVersion,HeraTrajectory,HeraUsage,HeraOperation} from './contracts.gen.ts';
const must=<T>(value:HeraOutcome<T>):T=>{if(!value.valid)throw new HeraRefusal(value.issues);return value.value;};
function refuse(path:string,detail:string):never{throw new HeraRefusal([heraIssue('THERA1008',path,detail)]);}
export const HERA_VARIANT_AXES=['efficiency','thoroughness','risk-sensitivity','error-correction','heuristic-injection'] as const;
export interface HeraPromptTrialResult {
  trial:HeraPromptTrial;candidate:HeraPromptVersion|null;controlReused:boolean;
  replayCost:{calls:number;tokens:number;ms:number};usage:HeraUsage;operationIds:string[];
}
/** Category and provenance checks run inside the single-repair structured-output gate. */
export async function planPromptTrial(input:{agent:HeraAgentDefinition;buffer:HeraFailureBuffer;active:HeraPromptVersion;axis:string;
  artifact:GmplPromptArtifact;client:MasChatClient;receipts:HeraControlReceipts;contrast?:{candidate:HeraPromptVersion;control:HeraTrajectory;replay:HeraTrajectory}}):Promise<HeraRopeOutput>{
  const {agent,buffer,active,axis,contrast}=input,phase=contrast?'contrast':'proposal';
  if(!(HERA_VARIANT_AXES as readonly string[]).includes(axis)||buffer.agentId!==agent.id||active.agentId!==agent.id||buffer.scope!==agent.scope||active.scope!==agent.scope)
    refuse('/trial/agent','The axis, buffer and active version must belong to one registered role.');
  must(await validateHeraRecord('failureBuffer',buffer));must(await validateHeraRecord('promptVersion',active));
  const allowed=contrast?[contrast.control.id,contrast.replay.id]:[...new Set(buffer.entries.map(e=>e.trajectoryId))];
  const rendered=renderGmplPrompt(input.artifact,{phase,agent:agent.id,current_prompt:JSON.stringify({operationalRules:active.operationalRules,behavioralPrinciples:active.behavioralPrinciples}),
    failures:buffer.entries.map(e=>({trajectoryId:e.trajectoryId,invocationId:e.invocationId,reason:e.reason,stepIds:e.stepIds})),axis,
    trials:contrast?[{control:{id:contrast.control.id,score:contrast.control.primaryScore,tokens:contrast.control.tokens,status:contrast.control.status},
      replay:{id:contrast.replay.id,score:contrast.replay.primaryScore,tokens:contrast.replay.tokens,status:contrast.replay.status},
      operationalRules:contrast.candidate.operationalRules,behavioralPrinciples:contrast.candidate.behavioralPrinciples}]:[]});
  if(!rendered.valid)refuse('/prompt',JSON.stringify(rendered.issues));
  const output=await createStructuredOutput({client:input.receipts.client('learn/rope/'+phase,input.client),schema:heraSchemaOf('heraRopeOutput'),maxRepairs:1,
    gate(value:unknown){
      const shape=validateHeraShape<HeraRopeOutput>('heraRopeOutput',value);if(!shape.valid)return {valid:false,errors:shape.issues.map(i=>({docPath:i.path,message:i.detail}))};
      const candidate=shape.value,all=[candidate,...candidate.operationalRules,...candidate.behavioralPrinciples];
      if(all.some(rule=>!rule.derivedFrom.length||rule.derivedFrom.some(id=>!allowed.includes(id))||(contrast&&allowed.some(id=>!rule.derivedFrom.includes(id)))))
        return {valid:false,errors:[{docPath:'/derivedFrom',message:'Every rule must cite the supplied source trajectories; contrasts require both actual executions.'}]};
      if(contrast&&(['operationalRules','behavioralPrinciples'] as const).some(block=>!equalsJson(candidate[block].map(r=>r.text),contrast.candidate[block].map(r=>r.text))))
        return {valid:false,errors:[{docPath:'/rules',message:'Contrast analysis cannot change the tested rule text or its category.'}]};
      return true;
    }}).generate([{role:'system',content:rendered.value.system},{role:'user',content:rendered.value.user}]);
  if(output.errors)throw new HeraRefusal(output.errors.map(i=>heraIssue('THERA1008',i.docPath??i.instancePath,i.message)));
  return output.value as HeraRopeOutput;
}
/** Only one deterministic credited role is tried per learning group; the caller owns activation. */
export async function runHeraPromptTrial(input:{task:HeraTask;snapshot:HeraLearningSnapshot;buffer:HeraFailureBuffer;groupIndex:number;groupId:string;binding:string;
  identity:RunIdentity;artifact:GmplPromptArtifact;roleArtifact:GmplPromptArtifact;receipts:HeraControlReceipts},host:HeraGroupHost):Promise<HeraPromptTrialResult>{
  const {task,snapshot,buffer,receipts}=input,authority={scope:task.scope,mode:'learn' as const},agent=await host.store.getAgent(buffer.agentId),active=await host.store.getPromptVersion(snapshot.activePromptVersionIds[buffer.agentId]);
  if(!agent||!active||task.split!=='training'||task.evaluator===null||task.scope!==host.store.scope||snapshot.scope!==task.scope)refuse('/trial','A trial requires scoped, evaluated training evidence and an active role.');
  must(validateHeraShape<HeraTask>('heraTask',task));must(await validateHeraRecord('snapshot',snapshot));must(await validateHeraRecord('failureBuffer',buffer));
  if(buffer.scope!==task.scope||buffer.entries.length>snapshot.config.failureBufferSize)refuse('/buffer','Failure evidence crosses the scope or registered capacity.');
  for(const entry of buffer.entries){const failed=await host.store.getTrajectory(entry.trajectoryId),steps=await Promise.all(entry.stepIds.map(id=>host.store.getTrajectoryStep(id)));
    if(!failed||failed.scope!==task.scope||failed.success!==false||failed.primaryScore===null||failed.taskId!==entry.taskId||failed.snapshotId!==entry.snapshotId||failed.groupId!==entry.groupId
      ||steps.some(step=>!step||step.trajectoryId!==failed.id||step.agentId!==buffer.agentId||step.invocationId!==entry.invocationId||!failed.stepIds.includes(step.id)))refuse('/buffer','A source buffer must retain evaluated failed invocations from its exact role.');
  }
  const axis=snapshot.config.variantAxes[input.groupIndex%snapshot.config.variantAxes.length];
  if(!axis)refuse('/variantAxes','A prompt trial requires an enabled registered axis.');
  const sourceEntry=[...buffer.entries].reverse().find(e=>e.taskId===task.id);
  if(!sourceEntry)refuse('/buffer','The bounded buffer has no failure for this training task.');
  const source=await host.store.getTrajectory(sourceEntry.trajectoryId),sourceRun=source?await host.masStore.getRun(source.masRunId):undefined;
  let topology=source?await host.store.getTopology(source.topologyId):undefined;
  const workflow=sourceRun?await host.masStore.getWorkflowVersion(sourceRun.workflowVersionId):undefined;
  if(!source||source.primaryScore===null||source.success!==false||!topology||!sourceRun||!workflow)refuse('/control','Failure credit must bind a retained evaluated whole execution.');
  if(topology.snapshotId!==snapshot.id){
    const content={...topology,snapshotId:snapshot.id,nodes:topology.nodes.map(n=>({...n,promptVersionId:snapshot.activePromptVersionIds[n.agentId]})),workflowVersionId:null};
    topology={...content,id:await heraContentIdOf(content)};
  }
  const limits=workflow.limits,pins={taskId:task.id,snapshotId:snapshot.id,corpusRevision:task.corpusRevision,topologyId:topology.id,activePromptVersionIds:snapshot.activePromptVersionIds,
    identityId:input.identity.identityId,evidenceRevision:host.evidence.revision,contextAdapter:host.evidence.contextAdapter??'documents' as const,limits:{...limits}};
  const trialBinding=await heraRevisionOf({parent:input.binding,bufferId:buffer.id,axis,pins}),key=await heraRevisionOf([task.scope,input.groupId,buffer.agentId,'rope']),resultId=key+':result';
  const old=await host.store.getOperation(resultId);
  if(old){if(old.binding!==trialBinding)refuse('/binding','A retained prompt trial binds different input.');
    const value=old.value as unknown as HeraPromptTrialResult;
    if((await Promise.all((value.trial.executionRunIds??[]).map(id=>host.masStore.getRun(id)))).some(run=>!run)||(value.trial.replayTrajectoryId&&!await host.store.getTrajectory(value.trial.replayTrajectoryId))||(await Promise.all(value.operationIds.map(id=>host.store.getOperation(id)))).some(v=>!v))refuse('/evidence','A retained trial has missing replay or proposal evidence.');
    for(const trajectoryId of [value.trial.controlTrajectoryId,value.trial.replayTrajectoryId])if(trajectoryId){const retained=await host.store.getTrajectory(trajectoryId);
      if(!retained||!await host.masStore.getRun(retained.masRunId)||(await Promise.all(retained.stepIds.map(id=>host.store.getTrajectoryStep(id)))).some(step=>!step))refuse('/evidence','A retained whole execution has missing invocation evidence.');
    }
    const retainedSpend={calls:0,tokens:0,ms:0};
    for(const id of value.trial.executionRunIds){const run=(await host.masStore.getRun(id))!,charge={calls:run.budget.spent.turns,tokens:run.budget.spent.tokens,ms:run.budget.spent.ms};
      receipts.chargeExecution(run.id,charge);for(const key of ['calls','tokens','ms'] as const)retainedSpend[key]+=charge[key];
    }
    if(!equalsJson(retainedSpend,value.replayCost))refuse('/evidence','The trial spend differs from its retained executions.');
    await receipts.replay(value.operationIds);return structuredClone(value);
  }
  const operation=async(id:string,stage:string,value:unknown):Promise<HeraOperation>=>({id,scope:task.scope,taskId:task.id,snapshotId:snapshot.id,groupId:input.groupId,binding:trialBinding,stage,phase:'result',status:'completed',value,usage:emptyHeraUsage(),issues:[]});
  const executor=createHeraExecutor(host),spent={calls:0,tokens:0,ms:0},usage=emptyHeraUsage(),executed=new Set<string>();
  const execute=async(request:HeraExecuteRequest)=>{
    const remaining=receipts.remaining();
    if((['calls','tokens','ms'] as const).some(k=>remaining[k]<limits[k]))refuse('/budget','The remaining refinement budget cannot fund the complete pinned whole run.');
    const id=await heraExecutionId(request),result=await executor.execute(request),run=await host.masStore.getRun('hera:'+id);
    if(run&&!executed.has(id)){
      const value={calls:run.budget.spent.turns,tokens:run.budget.spent.tokens,ms:run.budget.spent.ms};receipts.chargeExecution(run.id,value);executed.add(id);
      for(const k of ['calls','tokens','ms'] as const)spent[k]+=value[k];
      const trace=await host.masStore.readTrace(run.id);
      for(const attempt of trace?.attempts??[])if(attempt.kind==='agent'){
        usage.calls+=attempt.usage.calls;usage.promptTokens+=attempt.usage.promptTokens;usage.completionTokens+=attempt.usage.completionTokens;
        const tokens=attempt.usage as typeof attempt.usage&{unknownTokenRequests?:number;estimatedTokens?:number};usage.unknownTokenRequests+=tokens.unknownTokenRequests??attempt.usage.calls;usage.estimatedTokens+=tokens.estimatedTokens??0;
        usage.ms+=attempt.spend.ms;usage.unknownMsRequests+=attempt.usage.calls;
      }
    }
    if(!result.valid&&result.issues.some(i=>i.path==='/score'))decision='unevaluated';
    return must(result).trajectory;
  };
  let control:HeraTrajectory|null=null,replay:HeraTrajectory|null=null,candidate:HeraPromptVersion|null=null,controlReused=false;
  let decision:HeraPromptTrial['decision']='malformed',reason='No valid whole-run proposal.',rules:Pick<HeraPromptTrial,'operationalRules'|'behavioralPrinciples'>={operationalRules:[],behavioralPrinciples:[]};
  const proposalId=key+':proposal',ids:string[]=[];
  try{
    const expected=await heraRevisionOf({task,snapshotId:snapshot.id,workflowVersionId:workflow.versionId,identityId:input.identity.identityId,evidenceRevision:host.evidence.revision,contextAdapter:pins.contextAdapter});
    controlReused=source.snapshotId===snapshot.id&&source.identityId===input.identity.identityId&&topology.id===source.topologyId
      &&equalsJson(sourceRun.budget.limits,limits)&&(sourceRun.input as {binding?:string}).binding===expected;
    const base:HeraExecuteRequest={task,snapshot,topology,mode:'learn',groupIndex:input.groupIndex,candidateIndex:0,configRevision:trialBinding,caps:limits};
    control=controlReused?source:await execute(base);
    if(control.primaryScore===null){decision='unevaluated';refuse('/control','The control has no evaluation.');}
    let retained=await host.store.getOperation(proposalId);
    if(retained){if(retained.binding!==trialBinding)refuse('/proposal','A retained proposal binds different input.');candidate=(retained.value as {candidate:HeraPromptVersion}).candidate;await receipts.replay((retained.value as {receiptIds:string[]}).receiptIds);}
    else{
      const proposed=await planPromptTrial({agent,buffer,active,axis,artifact:input.artifact,client:host.controlClientFor(agent.profile,input.identity,'learn/rope/proposal'),receipts});
      candidate=must(await createHeraPromptVersion(input.roleArtifact,{scope:task.scope,at:host.now(),parentId:active.id,operationalRules:proposed.operationalRules,behavioralPrinciples:proposed.behavioralPrinciples,proposalOperationId:proposalId}));
      retained=must(await host.store.putOperation(await operation(proposalId,'learn/rope.proposal',{candidate,receiptIds:receipts.operationIds()}),authority)).value;
    }
    ids.push(retained.id);rules={operationalRules:candidate.operationalRules,behavioralPrinciples:candidate.behavioralPrinciples};
    replay=await execute({...base,promptTrial:{candidate,controlTrajectoryId:control.id,proposalOperationId:proposalId}});
    if(replay.primaryScore===null){decision='unevaluated';refuse('/replay','The replay has no evaluation.');}
    if(replay.status!=='completed')refuse('/replay','The whole-run replay did not complete.');
    const analysis=await planPromptTrial({agent,buffer,active,axis,artifact:input.artifact,client:host.controlClientFor(agent.profile,input.identity,'learn/rope/contrast'),receipts,contrast:{candidate,control,replay}});
    rules={operationalRules:analysis.operationalRules,behavioralPrinciples:analysis.behavioralPrinciples};
    decision='rejected';reason='The paired whole-run comparison did not pass integration.';
    const provisional=await makeTrial();
    const integrated=await integratePrompt({agent,active,candidate,trial:provisional,control,replay,artifact:input.roleArtifact,config:snapshot.config});
    if(integrated.valid&&!integrated.value.noOp){decision='activated';reason='The paired whole-run comparison passed the bounded prompt gates.';}
    else reason=integrated.valid?'The tested prompt has no block changes.':integrated.issues.map(i=>i.detail).join(' ');
  }catch(error){if(!(error instanceof HeraRefusal))throw error;reason=error.issues.map(i=>i.detail).join(' ');}
  async function makeTrial():Promise<HeraPromptTrial>{
    const content={scope:task.scope,agentId:buffer.agentId,bufferId:buffer.id,failedInvocationIds:[...new Set(buffer.entries.map(e=>e.invocationId))],bufferTrajectoryIds:[...new Set(buffer.entries.map(e=>e.trajectoryId))],axis,
      candidatePromptVersionId:candidate?.id??null,controlTrajectoryId:control?.id??null,replayTrajectoryId:replay?.id??null,
      delta:control?.primaryScore!==null&&control?.primaryScore!==undefined&&replay?.primaryScore!==null&&replay?.primaryScore!==undefined?{score:replay.primaryScore-control.primaryScore,tokens:replay.tokens.prompt+replay.tokens.completion-control.tokens.prompt-control.tokens.completion}:null,
      ...rules,decision,reason,pins,executionRunIds:[...executed].map(id=>'hera:'+id)};return {...content,id:await heraContentIdOf(content)};
  }
  const trial=must(await validateHeraRecord('promptTrial',await makeTrial())),result:HeraPromptTrialResult={trial,candidate,controlReused,replayCost:spent,usage,operationIds:[...ids,...receipts.operationIds()]};
  must(await host.store.putOperation(await operation(resultId,'learn/rope.result',result),authority));return result;
}
