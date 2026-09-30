/** Topology interventions remain proposals until the complete candidate wins its original group. */
import {createStructuredOutput,unfence} from '@tangleai/models/structured';
import {renderGmplPrompt,type GmplPromptArtifact} from '@tangleai/gmpl';
import type {RunIdentity} from '@tangleai/config';
import type {MasChatClient} from '@tangleai/mas';
import {createHeraExecutor,heraExecutionId,prepareHeraExecutionSnapshot} from './executor.ts';
import {validateHeraTopology,toMasWorkflow,type HeraTopologyRegistry} from './topology.ts';
import {heraConfigCatalog} from './registry.ts';
import {HERA_DEFAULT_LIMITS} from './scaffold.ts';
import {heraSchemaOf,validateHeraShape,validateHeraRecord} from './schema.ts';
import {heraContentIdOf,heraRevisionOf} from './identity.ts';
import {heraTopologyView} from './views.ts';
import {createHeraControlReceipts,emptyHeraUsage,type HeraControlReceipts} from './operations.ts';
import {HeraRefusal,heraRefuse,heraIssue,type HeraOutcome} from './errors.ts';
import {rankTrajectories} from './rank.ts';
import {persistentFailure,heraProfileBucket} from './predicate.ts';
import {equalsJson} from '@jarenjs/core/object';
import type {HeraGroupHost} from './group.ts';
import type {HeraTopology,HeraLearningSnapshot,HeraMutationProposal,HeraMutation,HeraBudget,HeraTask,HeraTrajectory,HeraOperation,HeraUsage} from './contracts.gen.ts';
const must=<T>(result:HeraOutcome<T>):T=>{if(!result.valid)throw new HeraRefusal(result.issues);return result.value;};
export function applyMutation(parent:HeraTopology,proposal:HeraMutationProposal,credit:readonly HeraMutation['credit'][number][],snapshot:HeraLearningSnapshot,registry:HeraTopologyRegistry,caps:HeraBudget,id:string):HeraOutcome<HeraTopology>{
  const fail=(path:string,detail:string)=>heraRefuse<HeraTopology>('THERA1003',path,detail);
  const shape=validateHeraShape<HeraMutationProposal>('heraMutationProposal',proposal);if(!shape.valid)return fail('/proposal','The mutation must use the closed registered proposal contract.');
  if(!registry.agents.some(a=>a.id===proposal.addAgentId)||parent.nodes.some(n=>n.agentId===proposal.addAgentId))return fail('/addAgentId','The added role must be registered and absent from this topology.');
  if(!id||parent.nodes.some(n=>n.id===id))return fail('/id','The inserted invocation requires a fresh identity.');
  if(proposal.dependsOn.some(dep=>!parent.nodes.some(n=>n.id===dep)))return fail('/dependsOn','Every dependency must name an existing invocation.');
  const remove=proposal.action==='replace'?proposal.removeInvocationId:undefined;
  if(proposal.action==='replace'&&(!remove||!credit.some(c=>c.invocationId===remove)||!parent.nodes.some(n=>n.id===remove)))return fail('/removeInvocationId','Replacement requires a retained failed invocation target.');
  if(proposal.dependsOn.includes(remove??''))return fail('/dependsOn','A replacement cannot depend on the removed invocation.');
  if(proposal.action==='augment'&&(!proposal.dependsOn.length||!proposal.dependsOn.some(dep=>credit.some(c=>c.invocationId===dep))))return fail('/dependsOn','Augmentation requires an explicit retained failure boundary.');
  const agent=registry.agents.find(a=>a.id===proposal.addAgentId)!,node={id,agentId:agent.id,promptVersionId:snapshot.activePromptVersionIds[agent.id],dependsOn:[...proposal.dependsOn],tools:[...agent.tools]};
  const nodes=parent.nodes.filter(n=>n.id!==remove).map(n=>({...n,dependsOn:[...new Set(n.dependsOn.flatMap(dep=>remove?(dep===remove?[id]:[dep]):proposal.dependsOn.includes(dep)?[id]:[dep]))]}));
  nodes.push(node);
  const topology:HeraTopology={...structuredClone(parent),id,parentTopologyId:parent.id,nodes,generator:{...parent.generator,kind:'mutation'},workflowVersionId:null,validation:{valid:true,issues:[]}};
  delete topology.rawProposal;
  const valid=validateHeraTopology(topology,snapshot,registry,caps);return valid.valid?{valid:true,value:topology}:valid;
}
export async function proposeMutation(input:{topology:HeraTopology;credit:HeraMutation['credit'];snapshot:HeraLearningSnapshot;registry:HeraTopologyRegistry;caps:HeraBudget;id:string;artifact:GmplPromptArtifact;client:MasChatClient;receipts:HeraControlReceipts}){
  const rendered=renderGmplPrompt(input.artifact,{topology:heraTopologyView(input.topology),failures:input.credit,
    agents:input.registry.agents.filter(a=>!input.topology.nodes.some(n=>n.agentId===a.id)).map(({id,title,tools})=>({id,title,tools})),caps:input.caps});
  if(!rendered.valid)throw new HeraRefusal(rendered.issues.map(i=>heraIssue('THERA1003',i.path,i.detail)));
  const generated=await createStructuredOutput({client:input.receipts.client('mutation/proposal',input.client),schema:heraSchemaOf('heraMutationProposal'),maxRepairs:1,
    gate(value){const candidate=applyMutation(input.topology,value as HeraMutationProposal,input.credit,input.snapshot,input.registry,input.caps,input.id);
      return candidate.valid?true:{valid:false,errors:candidate.issues.map(i=>({code:i.code,docPath:i.path,message:i.detail}))};}})
    .generate([{role:'system',content:rendered.value.system},{role:'user',content:rendered.value.user}]);
  let raw:unknown=generated.raw;try{raw=JSON.parse(unfence(generated.raw));}catch{/* Preserve malformed proposal bytes. */}
  return {raw,proposal:generated.errors?null:generated.value as HeraMutationProposal,issues:generated.errors?.map(i=>heraIssue('THERA1003',i.docPath??i.instancePath,i.message))??[]};
}
export interface HeraMutationExecution {mutation:HeraMutation;topology:HeraTopology|null;trajectory:HeraTrajectory|null;controlUsage:HeraUsage;operationId:string;}
/** Only retained failed invocation evidence is eligible; it does not assert causal blame. */
export async function runHeraMutation(input:{task:HeraTask;snapshot:HeraLearningSnapshot;groupId:string;groupIndex:number;configRevision:string;binding:string;profileBucket:string;trajectories:HeraTrajectory[];budget:HeraBudget;identity:RunIdentity},host:HeraGroupHost):Promise<HeraMutationExecution>{
  const {task,snapshot}=input,authority={scope:task.scope,mode:'learn' as const},key=await heraRevisionOf([task.scope,input.groupId,'mutation']),resultId=key+':result';
  if(task.split!=='training'||task.scope!==host.store.scope||snapshot.scope!==task.scope)throw new HeraRefusal([heraIssue('THERA1004','/mutation','Mutation requires scoped training authority.')]);
  const control=rankTrajectories(input.trajectories).ranked[0],parent=control?await host.store.getTopology(control.topologyId):undefined,run=control?await host.masStore.getRun(control.masRunId):undefined,workflow=run?await host.masStore.getWorkflowVersion(run.workflowVersionId):undefined;
  if(!control||control.primaryScore!==0||!parent||!run||!workflow||control.groupId!==input.groupId||parent.snapshotId!==snapshot.id)throw new HeraRefusal([heraIssue('THERA1003','/control','Mutation requires a retained zero-scoring control from the original group.')]);
  must(validateHeraShape<HeraBudget>('heraBudget',input.budget));
  for(const trajectory of input.trajectories)if(trajectory.groupId!==input.groupId||trajectory.scope!==task.scope||trajectory.taskId!==task.id||trajectory.snapshotId!==snapshot.id||!equalsJson(trajectory,await host.store.getTrajectory(trajectory.id)))throw new HeraRefusal([heraIssue('THERA1003','/control','Ranking must use exact retained same-group trajectories.')]);
  const bucket=await heraProfileBucket(parent.profile),failure=must(persistentFailure(snapshot.failureState,{profileBucket:bucket,groupId:input.groupId,primaryScore:control.primaryScore},snapshot.config));
  if(!snapshot.config.flags.mutation||!failure.trigger||bucket!==input.profileBucket||input.groupId!==await heraRevisionOf([task.id,snapshot.id,input.groupIndex,input.configRevision])||control.identityId!==input.identity.identityId)
    throw new HeraRefusal([heraIssue('THERA1003','/predicate','A mutation must bind the enabled persistent-failure threshold and its frozen group identity.')]);
  const pins={taskId:task.id,snapshotId:snapshot.id,corpusRevision:task.corpusRevision,topologyId:parent.id,activePromptVersionIds:snapshot.activePromptVersionIds,identityId:input.identity.identityId,evidenceRevision:host.evidence.revision,contextAdapter:host.evidence.contextAdapter??'documents' as const,limits:workflow.limits};
  const binding=await heraRevisionOf({parent:input.binding,pins,budget:input.budget}),old=await host.store.getOperation(resultId);
  if(old){if(old.binding!==binding)throw new HeraRefusal([heraIssue('THERA1007','/mutation/binding','A mutation receipt already binds another input.')]);
    const value=old.value as HeraMutationExecution;
    must(await validateHeraRecord('mutation',value.mutation));
    if((await Promise.all(value.mutation.executionRunIds.map(id=>host.masStore.getRun(id)))).some(r=>!r)||(await Promise.all(value.mutation.operationIds.map(id=>host.store.getOperation(id)))).some(o=>!o)
      ||(value.topology&&!await host.store.getTopology(value.topology.id))||(value.trajectory&&!await host.store.getTrajectory(value.trajectory.id)))throw new HeraRefusal([heraIssue('THERA1007','/mutation/evidence','Retained mutation evidence is missing.')]);
    return structuredClone(value);
  }
  const prepared=must(await prepareHeraExecutionSnapshot(host.store,snapshot)),profile=prepared.agents[0].profile,configured=await heraConfigCatalog(profile,{...HERA_DEFAULT_LIMITS});
  if(!configured.valid)throw new HeraRefusal([heraIssue('THERA1009','/config','The mutation profile catalog is invalid.',configured.issues)]);
  const config=configured.value,receipts=createHeraControlReceipts({store:host.store,authority,taskId:task.id,snapshotId:snapshot.id,groupId:input.groupId,binding,identity:input.identity,budget:input.budget,clock:host.clock});
  const steps=await Promise.all(control.stepIds.map(id=>host.store.getTrajectoryStep(id)));
  if(steps.some(s=>!s||s.trajectoryId!==control.id||s.scope!==task.scope))throw new HeraRefusal([heraIssue('THERA1007','/mutation/credit','The failed control has missing invocation evidence.')]);
  const credit=parent.nodes.flatMap(node=>{const stepIds=steps.filter(s=>s!.invocationId===node.id&&s!.agentId===node.agentId).map(s=>s!.id);return stepIds.length?[{trajectoryId:control.id,invocationId:node.id,stepIds}]:[];});
  const operation=async(id:string,stage:string,value:unknown):Promise<HeraOperation>=>({id,scope:task.scope,taskId:task.id,snapshotId:snapshot.id,groupId:input.groupId,binding,stage,phase:'result',status:'completed',value,usage:emptyHeraUsage(),issues:[]});
  const caps:HeraBudget={...input.budget,calls:workflow.limits.calls,tokens:workflow.limits.tokens,ms:workflow.limits.ms,turns:workflow.limits.toolRounds,fanOut:workflow.limits.fanOut,concurrency:workflow.limits.concurrency};
  const candidateId='mutation-'+key.slice(0,24),proposalId=key+':proposal';
  let proposal:HeraMutationProposal|null=null,rawProposal:unknown=null,topology:HeraTopology|null=null,trajectory:HeraTrajectory|null=null;
  let validation:HeraMutation['validation']={valid:false,issues:[]},decision:HeraMutation['decision']='invalid',reason='No valid registered mutation.',executionRunIds:string[]=[];
  try{
    let saved=await host.store.getOperation(proposalId);
    if(!saved){const proposed=await proposeMutation({topology:parent,credit,snapshot,registry:prepared,caps,id:candidateId,artifact:prepared.catalog.prompt('hera-topology-mutation')!,client:host.controlClientFor(profile,input.identity,'mutation/proposal'),receipts});
      saved=must(await host.store.putOperation(await operation(proposalId,'mutation.proposal',{...proposed,candidate:proposed.proposal?must(applyMutation(parent,proposed.proposal,credit,snapshot,prepared,caps,candidateId)):null,receiptIds:receipts.operationIds()}),authority)).value;}
    if(saved.binding!==binding)throw new HeraRefusal([heraIssue('THERA1007','/mutation/binding','The proposal changed its frozen input.')]);
    const proposed=saved.value as Awaited<ReturnType<typeof proposeMutation>>&{receiptIds:string[]};await receipts.replay(proposed.receiptIds);proposal=proposed.proposal;rawProposal=proposed.raw;validation={valid:proposal!==null,issues:proposed.issues};
    if(proposal){
      topology=must(applyMutation(parent,proposal,credit,snapshot,prepared,caps,candidateId));
      const built=must(await toMasWorkflow(topology,snapshot,{...prepared,config},caps));topology.workflowVersionId=built.validated.workflow.versionId;
      must(await host.store.putTopology(topology,authority));
      decision='unevaluated';reason='The remaining refinement allowance cannot fund the complete candidate.';
      const remaining=receipts.remaining();
      if((['calls','tokens','ms'] as const).every(k=>remaining[k]>=workflow.limits[k])){
        const request={task,snapshot,topology,mode:'learn' as const,groupIndex:input.groupIndex,candidateIndex:snapshot.config.groupSize,configRevision:input.configRevision,caps:workflow.limits,mutationTrial:{controlTrajectoryId:control.id,proposalOperationId:proposalId}};
        const execution=await createHeraExecutor(host).execute(request),candidateRun=await host.masStore.getRun('hera:'+await heraExecutionId(request));
        if(candidateRun){if(!['completed','failed'].includes(candidateRun.status))throw new HeraRefusal([heraIssue('THERA1007','/mutation/execution','The mutation has an unresolved durable execution.')]);
          executionRunIds=[candidateRun.id];receipts.chargeExecution(candidateRun.id,{calls:candidateRun.budget.spent.turns,tokens:candidateRun.budget.spent.tokens,ms:candidateRun.budget.spent.ms});}
        if(execution.valid){trajectory=execution.value.trajectory;
          if(trajectory.primaryScore!==null){const first=rankTrajectories([...input.trajectories,trajectory]).ranked[0];decision=trajectory.status==='completed'&&first.id===trajectory.id&&trajectory.primaryScore>control.primaryScore?'accepted':'rejected';reason=decision==='accepted'?'The complete candidate ranks first and strictly improves the zero-scoring control.':'The complete candidate does not strictly improve the control.';}
          else reason='The candidate has no measured task score.';
        }else{if(execution.issues.some(i=>i.code==='THERA1007'))throw new HeraRefusal(execution.issues);reason=execution.issues.map(i=>i.detail).join(' ');}
      }
    }else reason=validation.issues.map(i=>i.detail).join(' ');
  }catch(error){if(!(error instanceof HeraRefusal))throw error;
    if(error.issues.some(i=>i.path==='/operation'||i.path.includes('/binding')||i.path==='/mutation/execution'))throw error;
    reason=error.issues.map(i=>i.detail).join(' ');if(!topology){decision='invalid';validation={valid:false,issues:error.issues};}
  }
  const operationIds=[...(await host.store.getOperation(proposalId)?[proposalId]:[]),...receipts.operationIds()];
  const content={scope:task.scope,taskId:task.id,snapshotId:snapshot.id,groupId:input.groupId,profileBucket:input.profileBucket,parentTopologyId:parent.id,candidateTopologyId:topology?.id??null,controlTrajectoryId:control.id,candidateTrajectoryId:trajectory?.id??null,proposal,rawProposal,credit,decision,reason,validation,controlScore:control.primaryScore,candidateScore:trajectory?.primaryScore??null,spent:receipts.spent(),pins,executionRunIds,operationIds};
  const mutation=must(await validateHeraRecord('mutation',{...content,id:await heraContentIdOf(content)})),value:HeraMutationExecution={mutation,topology,trajectory,controlUsage:receipts.usage(),operationId:resultId};
  must(await host.store.putOperation(await operation(resultId,'mutation.result',value),authority));return value;
}
