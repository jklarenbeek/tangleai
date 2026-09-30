/** Durable learning proposals commit all domain changes under the two frozen heads. */
import {equalsJson} from '@jarenjs/core/object';
import {resolveProfile} from '@tangleai/config';
import {prepareHeraExecutionSnapshot} from './executor.ts';
import {createHeraGroupRunner,readHeraFrozenLibrary,type HeraGroupHost,type HeraGroupRequest} from './group.ts';
import {extractSemanticAdvantage,type HeraReflectionEvidence} from './advantage.ts';
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
import type {HeraExperience,HeraHead,HeraLearningSnapshot,HeraOperation,HeraSemanticAdvantage,HeraRolloutGroup,HeraTask,HeraUsage} from './contracts.gen.ts';
const must=<T>(value:HeraOutcome<T>):T=>{if(!value.valid)throw new HeraRefusal(value.issues);return value.value;};
export interface HeraLearningHost extends HeraGroupHost {
  /** This host policy admits source-backed contradictions; absence admits none. */
  consolidationPolicy?:{revision:string;conflicts(advantage:HeraSemanticAdvantage,library:readonly HeraExperience[]):Promise<readonly HeraConflictEvidence[]>};
}
export interface HeraLearningResult {
  group:HeraRolloutGroup;snapshot:HeraLearningSnapshot;advantageId:string|null;librarySize:number;
  mixedGroup:boolean;groupsWithoutMixedOutcome:number;libraryChurn:HeraConsolidationApplication['churn'];
  usage:HeraUsage;spent:{calls:number;tokens:number;ms:number};operationIds:string[];
}
interface LearningBinding {libraryHead:HeraHead;snapshotHead:HeraHead;library:HeraExperience[];}
interface LearningPreparation {
  advantage:HeraSemanticAdvantage|null;library:HeraExperience[];versions:HeraExperience[];snapshot:HeraLearningSnapshot;noOp:boolean;
  churn:HeraConsolidationApplication['churn'];usage:HeraUsage;spent:{calls:number;tokens:number;ms:number};operationIds:string[];
}
export function createHeraLearner(host:HeraLearningHost){
  const runner=createHeraGroupRunner(host),pending=new Map<string,Promise<HeraOutcome<HeraLearningResult>>>();
  const perform=async(request:HeraGroupRequest):Promise<HeraOutcome<HeraLearningResult>>=>{
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
      if(snapshot.config.flags.rope||snapshot.config.flags.mutation)throw new HeraRefusal([heraIssue('THERA1008','/config/flags','Prompt refinement and topology mutation are not available.')]);
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
        must(await runner.run(request));await readHeraFrozenLibrary(host,result.snapshot);
        return {valid:true,value:result};
      }
      const evidence=must(await runner.run(request));groupId=evidence.group.id;
      let bound=await host.store.getOperation(attempt+':task.bind-snapshot');
      if(!bound){
        const libraryHead=await host.store.readHead(emptyHeraHead(task.scope,'library').id)??emptyHeraHead(task.scope,'library'),snapshotHead=await host.store.readHead(emptyHeraHead(task.scope,'snapshot').id)??emptyHeraHead(task.scope,'snapshot');
        if(snapshotHead.versionId!==snapshot.id||(libraryHead.versionId!==snapshot.libraryRevision&&!(libraryHead.versionId===null&&snapshot.experienceIds.length===0)))
          throw new HeraRefusal([heraIssue('THERA1006','/expected','The learning parent is no longer the active library and snapshot.')]);
        const library=await readHeraFrozenLibrary(host,snapshot);
        bound=await save('task.bind-snapshot',{libraryHead,snapshotHead,library} satisfies LearningBinding);
      }
      if(bound.binding!==binding)throw new HeraRefusal([heraIssue('THERA1007','/learning/binding','The learning proposal binds different task or host input.')]);
      const frozen=bound.value as LearningBinding;
      let prepared=await host.store.getOperation(attempt+':learning.prepared');
      if(!prepared){
        const remaining={...evidence.group.budget.limits,calls:Math.max(0,evidence.group.budget.limits.calls-evidence.group.budget.spent.calls),
          tokens:Math.max(0,evidence.group.budget.limits.tokens-evidence.group.budget.spent.tokens),ms:Math.max(0,evidence.group.budget.limits.ms-evidence.group.budget.spent.ms)};
        const receipts=createHeraControlReceipts({store:host.store,authority,taskId:task.id,snapshotId:snapshot.id,groupId,binding,identity:resolved.identity,budget:remaining,clock:host.clock});
        let library=frozen.library,advantage:HeraSemanticAdvantage|null=null,versions:HeraExperience[]=[],churn={add:0,merge:0,prune:0,keep:0};
        const stageIds=[bound.id];
        if(snapshot.config.flags.experience){
          const applications=must(await recordApplications(evidence,library));library=applications.library;versions.push(...applications.updates.map(u=>u.next));
          stageIds.push((await save('experience.utility',{evaluated:applications.evaluated,versions:applications.updates.map(u=>({previous:u.previous.id,next:u.next.id}))})).id);
          const steps=await Promise.all(evidence.trajectories.flatMap(t=>t.stepIds).map(id=>host.store.getTrajectoryStep(id)));
          if(steps.some(s=>!s))throw new HeraRefusal([heraIssue('THERA1007','/steps','Reflection evidence is missing.')]);
          const reflection={...evidence,steps} as HeraReflectionEvidence;
          advantage=await extractSemanticAdvantage(task,reflection,{artifact:execution.catalog.prompt('hera-reflection')!,client:host.controlClientFor(profile,resolved.identity,'learn/reflection'),receipts});
          stageIds.push((await save('advantage.extract',{advantageId:advantage?.id??null,mixed:evidence.group.mixedOutcome.value})).id);
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
        stageIds.push((await save('rope.run',null,'disabled')).id,(await save('topology.mutate',null,'disabled')).id);
        const next=must(await prepareHeraSnapshot(snapshot,{experienceIds:library.map(e=>e.id)}));
        stageIds.push((await save('snapshot.stage',{snapshotId:next.snapshot.id,noOp:next.noOp})).id);
        // Intermediate utility versions consumed by consolidation remain archived provenance.
        versions=versions.map(e=>({...e,status:library.some(n=>n.id===e.id)?'active' as const:'archived' as const}));
        const value:LearningPreparation={advantage,library,versions,snapshot:next.snapshot,noOp:next.noOp,churn,usage:receipts.usage(),spent:receipts.spent(),operationIds:[...stageIds,...receipts.operationIds()]};
        prepared=await save('learning.prepared',value);
      }
      if(prepared.binding!==binding)throw new HeraRefusal([heraIssue('THERA1007','/learning/binding','The prepared learning transaction binds different input.')]);
      const plan=prepared.value as LearningPreparation,finalId=attempt+':learning.complete',activationId=attempt+':snapshot.activate-or-conflict';
      const operationIds=[...(evidence.group.operationIds??[]),...plan.operationIds,prepared.id,activationId,finalId];
      const result:HeraLearningResult={group:{...evidence.group,operationIds},snapshot:{...plan.snapshot,status:'active'},advantageId:plan.advantage?.id??null,librarySize:plan.library.length,
        mixedGroup:evidence.group.mixedOutcome.value,groupsWithoutMixedOutcome:Number(!evidence.group.mixedOutcome.value&&evidence.trajectories.some(t=>t.primaryScore!==null)),libraryChurn:plan.churn,
        usage:plan.usage,spent:{calls:evidence.group.budget.spent.calls+plan.spent.calls,tokens:evidence.group.budget.spent.tokens+plan.spent.tokens,ms:evidence.group.budget.spent.ms+plan.spent.ms},operationIds};
      return await host.store.transaction(authority,async tx=>{
        const replay=await tx.get('operation',finalId);if(replay){if(replay.binding!==binding)throw new HeraRefusal([heraIssue('THERA1007','/learning/binding','A competing result binds different input.')]);return replay.value as HeraLearningResult;}
        const actualSnapshot=await tx.get('head',frozen.snapshotHead.id)??emptyHeraHead(task.scope,'snapshot'),actualLibrary=await tx.get('head',frozen.libraryHead.id)??emptyHeraHead(task.scope,'library');
        must(planHeraHeadTransition(actualSnapshot,frozen.snapshotHead,snapshot.id));
        must(planHeraHeadTransition(actualLibrary,frozen.libraryHead,snapshot.libraryRevision));
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
  return {run(request:HeraGroupRequest){request=structuredClone(request);const key=JSON.stringify(request),active=pending.get(key);if(active)return active;
    const work=perform(request).finally(()=>pending.delete(key));pending.set(key,work);return work;}};
}
export const learnHeraGroup=(request:HeraGroupRequest,host:HeraLearningHost)=>createHeraLearner(host).run(request);
