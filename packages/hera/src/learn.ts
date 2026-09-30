/** Durable learning proposals commit all domain changes under the two frozen heads. */
import {equalsJson} from '@jarenjs/core/object';
import {resolveProfile} from '@tangleai/config';
import {prepareHeraExecutionSnapshot,prepareHeraPromptRegistry} from './executor.ts';
import {createHeraGroupRunner,readHeraFrozenLibrary,type HeraGroupHost,type HeraGroupRequest} from './group.ts';
import {extractSemanticAdvantage,type HeraReflectionEvidence} from './advantage.ts';
import {assignFailureCredit} from './credit.ts';
import {runHeraPromptTrial,type HeraPromptTrialResult} from './trial.ts';
import {activatePromptVersion} from './activate.ts';
import {recordApplications} from './utility.ts';
import {proposeConsolidation,type HeraConflictEvidence,type HeraConsolidationApplication} from './consolidate.ts';
import {prepareHeraSnapshot,activateSnapshot} from './snapshot.ts';
import {emptyHeraHead,planHeraHeadTransition,planHeraLibraryTransition} from './heads.ts';
import {assertTaskSplit} from './modes.ts';
import {validateHeraEvaluator} from './evaluator.ts';
import {validateHeraRecord,validateHeraShape} from './schema.ts';
import {heraRevisionOf} from './identity.ts';
import {createHeraControlReceipts,emptyHeraUsage} from './operations.ts';
import {HeraRefusal,heraIssue,type HeraOutcome} from './errors.ts';
import type {HeraExperience,HeraHead,HeraLearningSnapshot,HeraOperation,HeraSemanticAdvantage,HeraRolloutGroup,HeraTask,HeraUsage,HeraBudget,HeraFailureBuffer} from './contracts.gen.ts';
const must=<T>(value:HeraOutcome<T>):T=>{if(!value.valid)throw new HeraRefusal(value.issues);return value.value;};
export interface HeraLearningHost extends HeraGroupHost {
  /** This host policy admits source-backed contradictions; absence admits none. */
  consolidationPolicy?:{revision:string;conflicts(advantage:HeraSemanticAdvantage,library:readonly HeraExperience[]):Promise<readonly HeraConflictEvidence[]>};
}
export interface HeraLearningRequest extends HeraGroupRequest {
  /** Explicit additional refinement allowance; omission uses the remaining group allocation. */
  learningBudget?:HeraBudget;
}
export interface HeraLearningResult {
  group:HeraRolloutGroup;snapshot:HeraLearningSnapshot;advantageId:string|null;librarySize:number;
  mixedGroup:boolean;groupsWithoutMixedOutcome:number;libraryChurn:HeraConsolidationApplication['churn'];
  usage:HeraUsage;spent:{calls:number;tokens:number;ms:number};operationIds:string[];
  promptTrialIds:string[];promptChurn:Record<string,{activated:number;rejected:number}>;trials:Record<"activated"|"rejected"|"malformed"|"unevaluated",number>;replayCost:{calls:number;tokens:number;ms:number};
}
interface LearningBinding {libraryHead:HeraHead;snapshotHead:HeraHead;library:HeraExperience[];promptHeads:HeraHead[];buffers:HeraFailureBuffer[];}
interface LearningPreparation {
  advantage:HeraSemanticAdvantage|null;library:HeraExperience[];versions:HeraExperience[];snapshot:HeraLearningSnapshot;noOp:boolean;
  buffers:HeraFailureBuffer[];promptTrials:HeraPromptTrialResult[];churn:HeraConsolidationApplication['churn'];usage:HeraUsage;spent:{calls:number;tokens:number;ms:number};operationIds:string[];
}
export function createHeraLearner(host:HeraLearningHost){
  const runner=createHeraGroupRunner(host),pending=new Map<string,Promise<HeraOutcome<HeraLearningResult>>>();
  const perform=async(request:HeraLearningRequest):Promise<HeraOutcome<HeraLearningResult>>=>{
    let attempt='',binding='',groupId='';
    const authority={scope:host.store.scope,mode:'learn' as const};
    const operation=async(stage:string,value:unknown,status:HeraOperation['status']='completed',issues:HeraOperation['issues']=[]):Promise<HeraOperation>=>({
      id:attempt+':'+stage,scope:host.store.scope,taskId:request.task.id,snapshotId:request.snapshot.id,groupId:groupId||attempt,stage,phase:'result',status,binding,value,usage:emptyHeraUsage(),issues});
    const save=async(stage:string,value:unknown,status:HeraOperation['status']='completed')=>must(await host.store.putOperation(await operation(stage,value,status),authority)).value;
    try{
      const task=must(validateHeraShape<HeraTask>('heraTask',request.task)),snapshot=must(await validateHeraRecord('snapshot',request.snapshot));
      attempt=await heraRevisionOf([host.store.scope,task.id,snapshot.id,request.groupIndex,'learn']);
      binding=await heraRevisionOf({request,policy:host.consolidationPolicy?.revision??'no-conflicts/v1'});
      if(request.mode!=='learn'||task.scope!==host.store.scope||snapshot.scope!==host.store.scope)throw new HeraRefusal([heraIssue('THERA1004','/mode','The learner requires scoped learn authority.')]);
      must(assertTaskSplit(task,'learn'));must(validateHeraEvaluator(task,snapshot,host.evaluator,'learn'));
      if(snapshot.config.flags.mutation)throw new HeraRefusal([heraIssue('THERA1008','/config/flags','Topology mutation is not available.')]);
      const {learningBudget,...groupRequest}=request;
      if(learningBudget){const value=must(validateHeraShape<HeraBudget>('heraBudget',learningBudget));if(!Object.values(value).every(Number.isSafeInteger))throw new HeraRefusal([heraIssue('THERA1001','/learningBudget','Refinement budgets require safe integers.')]);}
      if(host.consolidationPolicy&&!host.consolidationPolicy.revision.trim())throw new HeraRefusal([heraIssue('THERA1002','/policy/revision','A consolidation policy must be versioned.')]);
      const execution=must(await prepareHeraExecutionSnapshot(host.store,snapshot)),profile=execution.agents[0]?.profile;
      const resolved=await resolveProfile({...host.profiles,request:{kind:'profile',profile,overrides:null}});
      if(!resolved.ok)throw new HeraRefusal([heraIssue('THERA1009','/profile','The learning profile cannot resolve.',resolved.issues)]);
      binding=await heraRevisionOf({binding,identity:resolved.identity.identityId,artifacts:execution.catalog.document.revision,evidence:host.evidence.revision});
      const completed=await host.store.getOperation(attempt+':learning.complete');
      if(completed){
        if(completed.binding!==binding)throw new HeraRefusal([heraIssue('THERA1007','/learning/binding','This learning key already binds different input.')]);
        const result=structuredClone(completed.value) as HeraLearningResult;
        if(!await host.store.getRolloutGroup(result.group.id)||!await host.store.getSnapshot(result.snapshot.id)
          ||(result.advantageId&&!await host.store.getAdvantage(result.advantageId))||(await Promise.all(result.operationIds.map(id=>host.store.getOperation(id)))).some(o=>!o))
          throw new HeraRefusal([heraIssue('THERA1007','/learning/evidence','A completed learning result has missing durable evidence.')]);
        must(await runner.run(groupRequest));await readHeraFrozenLibrary(host,result.snapshot);
        for(const id of result.promptTrialIds){const trial=await host.store.getPromptTrial(id);
          if(trial&&(await Promise.all((trial.executionRunIds??[]).map(id=>host.masStore.getRun(id)))).some(run=>!run))throw new HeraRefusal([heraIssue('THERA1007','/learning/trial','A completed trial has missing execution evidence.')]);
          if(!trial||(trial.candidatePromptVersionId&&!await host.store.getPromptVersion(trial.candidatePromptVersionId))||(trial.replayTrajectoryId&&!await host.store.getTrajectory(trial.replayTrajectoryId)))
            throw new HeraRefusal([heraIssue('THERA1007','/learning/trial','A completed learning result has missing prompt-trial evidence.')]);
          for(const trajectoryId of [trial.controlTrajectoryId,trial.replayTrajectoryId])if(trajectoryId){const trajectory=await host.store.getTrajectory(trajectoryId);
            if(!trajectory||!await host.masStore.getRun(trajectory.masRunId)||(await Promise.all(trajectory.stepIds.map(id=>host.store.getTrajectoryStep(id)))).some(s=>!s))throw new HeraRefusal([heraIssue('THERA1007','/learning/trial','A retained whole replay has missing durable invocation evidence.')]);}
        }
        return {valid:true,value:result};
      }
      const evidence=must(await runner.run(groupRequest));groupId=evidence.group.id;
      let bound=await host.store.getOperation(attempt+':task.bind-snapshot');
      if(!bound){
        const libraryHead=await host.store.readHead(emptyHeraHead(task.scope,'library').id)??emptyHeraHead(task.scope,'library'),snapshotHead=await host.store.readHead(emptyHeraHead(task.scope,'snapshot').id)??emptyHeraHead(task.scope,'snapshot');
        if(snapshotHead.versionId!==snapshot.id||(libraryHead.versionId!==snapshot.libraryRevision&&!(libraryHead.versionId===null&&snapshot.experienceIds.length===0)))
          throw new HeraRefusal([heraIssue('THERA1006','/expected','The learning parent is no longer the active library and snapshot.')]);
        const library=await readHeraFrozenLibrary(host,snapshot);
        const promptHeads=await Promise.all(Object.keys(snapshot.activePromptVersionIds).map(async agentId=>{
          const head=await host.store.readHead(emptyHeraHead(task.scope,'prompt',agentId).id);
          if(!head||head.versionId!==snapshot.activePromptVersionIds[agentId])throw new HeraRefusal([heraIssue('THERA1006','/prompt','A frozen prompt is no longer active.')]);return head;
        }));
        const buffers=await Promise.all(Object.entries(snapshot.failureBufferIds??{}).map(async([agentId,id])=>{
          const buffer=await host.store.getFailureBuffer(id);if(!buffer||buffer.agentId!==agentId)throw new HeraRefusal([heraIssue('THERA1007','/buffers','A frozen failure buffer is missing.')]);return buffer;
        }));
        bound=await save('task.bind-snapshot',{libraryHead,snapshotHead,library,promptHeads,buffers} satisfies LearningBinding);
      }
      if(bound.binding!==binding)throw new HeraRefusal([heraIssue('THERA1007','/learning/binding','The learning proposal binds different task or host input.')]);
      const frozen=bound.value as LearningBinding;
      let prepared=await host.store.getOperation(attempt+':learning.prepared');
      if(!prepared){
        let remaining={...evidence.group.budget.limits,calls:Math.max(0,evidence.group.budget.limits.calls-evidence.group.budget.spent.calls),
          tokens:Math.max(0,evidence.group.budget.limits.tokens-evidence.group.budget.spent.tokens),ms:Math.max(0,evidence.group.budget.limits.ms-evidence.group.budget.spent.ms)};
        if(learningBudget)remaining={...learningBudget,calls:Math.min(learningBudget.calls,resolved.identity.budget.maxCalls??Infinity),tokens:Math.min(learningBudget.tokens,resolved.identity.budget.maxTokens??Infinity),ms:Math.min(learningBudget.ms,resolved.identity.budget.maxMs??Infinity),concurrency:Math.min(learningBudget.concurrency,resolved.identity.budget.maxConcurrency??Infinity,host.concurrency)};
        const receipts=createHeraControlReceipts({store:host.store,authority,taskId:task.id,snapshotId:snapshot.id,groupId,binding,identity:resolved.identity,budget:remaining,clock:host.clock});
        let library=frozen.library,advantage:HeraSemanticAdvantage|null=null,versions:HeraExperience[]=[],churn={add:0,merge:0,prune:0,keep:0};
        const stageIds=[bound.id];
        let bufferVersions:HeraFailureBuffer[]=[],buffers=frozen.buffers,promptTrials:HeraPromptTrialResult[]=[];
        const steps=await Promise.all(evidence.trajectories.flatMap(t=>t.stepIds).map(id=>host.store.getTrajectoryStep(id)));
        if(steps.some(s=>!s))throw new HeraRefusal([heraIssue('THERA1007','/steps','Reflection evidence is missing.')]);
        const reflection={...evidence,steps} as HeraReflectionEvidence;
        if(snapshot.config.flags.experience||snapshot.config.flags.rope){
          advantage=await extractSemanticAdvantage(task,reflection,{artifact:execution.catalog.prompt('hera-reflection')!,client:host.controlClientFor(profile,resolved.identity,'learn/reflection'),receipts});
          stageIds.push((await save('advantage.extract',{advantageId:advantage?.id??null,mixed:evidence.group.mixedOutcome.value})).id);
        }
        if(snapshot.config.flags.experience){
          const applications=must(await recordApplications(evidence,library));library=applications.library;versions.push(...applications.updates.map(u=>u.next));
          stageIds.push((await save('experience.utility',{evaluated:applications.evaluated,versions:applications.updates.map(u=>({previous:u.previous.id,next:u.next.id}))})).id);
          if(advantage){
            // Retain ancestry by identity, without a collection-size-dependent query truncation.
            const history=new Map(frozen.library.map(e=>[e.id,e])),queue=library.flatMap(e=>e.parents);
            while(queue.length){const id=queue.pop()!;if(history.has(id)){queue.push(...history.get(id)!.parents.filter(p=>!history.has(p)));continue;}
              const entry=await host.store.getExperience(id);if(!entry)throw new HeraRefusal([heraIssue('THERA1008','/history/'+id,'Experience ancestry is missing.')]);history.set(id,entry);queue.push(...entry.parents);}
            const policyId=attempt+':experience.conflicts';let policy=await host.store.getOperation(policyId);
            if(!policy)policy=await save('experience.conflicts',host.consolidationPolicy?await host.consolidationPolicy.conflicts(advantage,library):[]);
            stageIds.push(policy.id);
            const applied=await proposeConsolidation(library,{scope:task.scope,config:snapshot.config,profile:evidence.group.profile!,advantage,conflicts:policy.value as HeraConflictEvidence[],history:[...history.values()]},
              {artifact:execution.catalog.prompt('hera-consolidation')!,client:host.controlClientFor(profile,resolved.identity,'learn/consolidation'),embedder:host.embedder,receipts});
            library=applied.library;versions.push(...applied.created);churn=applied.churn;
          }
          stageIds.push((await save('experience.consolidate',{churn,libraryIds:library.map(e=>e.id)})).id);
        }else stageIds.push((await save('experience.learn',null,'disabled')).id);
        let promptIds={...snapshot.activePromptVersionIds},registryRevision=snapshot.registryRevision;
        if(snapshot.config.flags.rope){
          if(advantage){
            const credited=must(await assignFailureCredit(advantage,reflection,buffers,snapshot.config.failureBufferSize));buffers=credited.buffers;bufferVersions=credited.versions;
            const selected=bufferVersions.filter(b=>b.entries.some(e=>e.advantageId===advantage!.id)).sort((a,b)=>a.agentId.localeCompare(b.agentId))[0];
            if(selected){const agent=execution.agents.find(a=>a.id===selected.agentId)!;
              const trial=await runHeraPromptTrial({task,snapshot,buffer:selected,groupIndex:request.groupIndex,groupId,binding,identity:resolved.identity,
                artifact:execution.catalog.prompt('hera-rope-evolution')!,roleArtifact:execution.catalog.prompt(agent.artifactId)!,receipts},host);promptTrials.push(trial);
              if(trial.trial.decision==='activated'&&trial.candidate)promptIds[trial.candidate.agentId]=trial.candidate.id;
            }
          }
          stageIds.push((await save('rope.run',{trialIds:promptTrials.map(p=>p.trial.id),bufferIds:buffers.map(b=>b.id)})).id);
          if(!equalsJson(promptIds,snapshot.activePromptVersionIds))registryRevision=must(await prepareHeraPromptRegistry(host.store,task.scope,promptIds,promptTrials.flatMap(p=>p.candidate?[p.candidate]:[]))).registry.revision;
        }else stageIds.push((await save('rope.run',null,'disabled')).id);
        stageIds.push((await save('topology.mutate',null,'disabled')).id);
        const next=must(await prepareHeraSnapshot(snapshot,{experienceIds:library.map(e=>e.id),activePromptVersionIds:promptIds,registryRevision,...(buffers.length?{failureBufferIds:Object.fromEntries(buffers.map(b=>[b.agentId,b.id]))}:{})}));
        stageIds.push((await save('snapshot.stage',{snapshotId:next.snapshot.id,noOp:next.noOp})).id);
        // Intermediate utility versions consumed by consolidation remain archived provenance.
        versions=versions.map(e=>({...e,status:library.some(n=>n.id===e.id)?'active' as const:'archived' as const}));
        const usage=receipts.usage();for(const trial of promptTrials)for(const key of Object.keys(usage) as Array<keyof HeraUsage>)usage[key]=(usage[key]??0)+(trial.usage[key]??0);
        const value:LearningPreparation={advantage,library,versions,buffers:bufferVersions,promptTrials,snapshot:next.snapshot,noOp:next.noOp,churn,usage,spent:receipts.spent(),operationIds:[...stageIds,...receipts.operationIds()]};
        prepared=await save('learning.prepared',value);
      }
      if(prepared.binding!==binding)throw new HeraRefusal([heraIssue('THERA1007','/learning/binding','The prepared learning transaction binds different input.')]);
      const plan=prepared.value as LearningPreparation,finalId=attempt+':learning.complete',activationId=attempt+':snapshot.activate-or-conflict';
      const operationIds=[...(evidence.group.operationIds??[]),...plan.operationIds,prepared.id,activationId,finalId];
      const trials={activated:0,rejected:0,malformed:0,unevaluated:0},promptChurn:Record<string,{activated:number;rejected:number}>={},replayCost={calls:0,tokens:0,ms:0};
      for(const {trial,replayCost:cost} of plan.promptTrials){trials[trial.decision]++;const counts=promptChurn[trial.agentId]??={activated:0,rejected:0};counts[trial.decision==='activated'?'activated':'rejected']++;for(const key of ['calls','tokens','ms'] as const)replayCost[key]+=cost[key];}
      const result:HeraLearningResult={group:{...evidence.group,operationIds},snapshot:{...plan.snapshot,status:'active'},advantageId:plan.advantage?.id??null,librarySize:plan.library.length,
        mixedGroup:evidence.group.mixedOutcome.value,groupsWithoutMixedOutcome:Number(!evidence.group.mixedOutcome.value&&evidence.trajectories.some(t=>t.primaryScore!==null)),libraryChurn:plan.churn,
        usage:plan.usage,spent:{calls:evidence.group.budget.spent.calls+plan.spent.calls,tokens:evidence.group.budget.spent.tokens+plan.spent.tokens,ms:evidence.group.budget.spent.ms+plan.spent.ms},operationIds,promptTrialIds:plan.promptTrials.map(p=>p.trial.id),promptChurn,trials,replayCost};
      return await host.store.transaction(authority,async tx=>{
        const replay=await tx.get('operation',finalId);if(replay){if(replay.binding!==binding)throw new HeraRefusal([heraIssue('THERA1007','/learning/binding','A competing result binds different input.')]);return replay.value as HeraLearningResult;}
        const actualSnapshot=await tx.get('head',frozen.snapshotHead.id)??emptyHeraHead(task.scope,'snapshot'),actualLibrary=await tx.get('head',frozen.libraryHead.id)??emptyHeraHead(task.scope,'library');
        must(planHeraHeadTransition(actualSnapshot,frozen.snapshotHead,snapshot.id));
        must(planHeraHeadTransition(actualLibrary,frozen.libraryHead,snapshot.libraryRevision));
        for(const expected of frozen.promptHeads)must(planHeraHeadTransition(await tx.get('head',expected.id)??{...expected,versionId:null,revision:0},expected,expected.versionId!));
        for(const buffer of plan.buffers)await tx.put('failureBuffer',buffer);
        for(const {trial,candidate} of plan.promptTrials){
          if(candidate){await tx.put('promptVersion',{...candidate,status:trial.decision==='activated'?'candidate':'rejected'});
            if(trial.decision==='activated')await activatePromptVersion(tx,frozen.promptHeads.find(h=>h.versionId===candidate.parentId)!,candidate);}
          await tx.put('promptTrial',trial);
        }
        if(plan.advantage)await tx.put('advantage',plan.advantage);
        for(const version of plan.versions)await tx.put('experience',version);
        if(!equalsJson(frozen.library.map(e=>e.id).sort(),plan.library.map(e=>e.id).sort()))await tx.transitionHead(must(await planHeraLibraryTransition(actualLibrary,frozen.libraryHead,frozen.library,plan.library)));
        if(!plan.noOp){await tx.put('snapshot',plan.snapshot);await activateSnapshot(tx,frozen.snapshotHead,plan.snapshot);}
        await tx.put('operation',await operation('snapshot.activate-or-conflict',{snapshotId:result.snapshot.id,noOp:plan.noOp}));
        await tx.put('operation',await operation('learning.complete',result));return result;
      }).then(async outcome=>{if(!outcome.valid)throw new HeraRefusal(outcome.issues);return outcome;});
    }catch(error){
      if(!(error instanceof HeraRefusal))throw error;
      if(attempt&&binding){
        const suffix=await heraRevisionOf({binding,groupId,issues:error.issues}),record=await operation('learning.refused/'+suffix,{refusedLearningWrites:Number(error.issues.some(i=>i.code==='THERA1004')),headConflicts:Number(error.issues.some(i=>i.code==='THERA1006'))},'failed',error.issues);
        must(await host.store.putOperation(record,authority));
      }
      return {valid:false,issues:error.issues};
    }
  };
  return {run(request:HeraLearningRequest){request=structuredClone(request);const key=JSON.stringify(request),active=pending.get(key);if(active)return active;
    const work=perform(request).finally(()=>pending.delete(key));pending.set(key,work);return work;}};
}
export const learnHeraGroup=(request:HeraLearningRequest,host:HeraLearningHost)=>createHeraLearner(host).run(request);
