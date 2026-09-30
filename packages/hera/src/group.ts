/** Frozen query orchestration, bounded candidate execution and task-first ranking. */
import {mapConcurrent} from '@jarenjs/core/async';
import {resolveProfile,type RunIdentity} from '@tangleai/config';
import {sameIdentity} from '@tangleai/context';
import type {MasChatClient} from '@tangleai/mas';
import {createHeraExecutor,prepareHeraExecutionSnapshot,type HeraExecutorHost} from './executor.ts';
import {assertHeraCorpus} from './evidence.ts';
import {validateHeraEvaluator} from './evaluator.ts';
import {HERA_DEFAULT_LIMITS} from './scaffold.ts';
import {heraConfigCatalog,HERA_EVIDENCE_INPUT} from './registry.ts';
import {validateHeraRecord,validateHeraShape} from './schema.ts';
import {heraRevisionOf} from './identity.ts';
import {HeraRefusal,heraIssue,type HeraOutcome} from './errors.ts';
import {assertTaskSplit} from './modes.ts';
import {createHeraControlReceipts,emptyHeraUsage} from './operations.ts';
import {profileQuery} from './profile.ts';
import {selectExperiences} from './select.ts';
import {orchestrate,type HeraOrchestration} from './orchestrate.ts';
import {toMasWorkflow,validateHeraTopology} from './topology.ts';
import {rankTrajectories,mixedOutcome} from './rank.ts';
import {persistentFailure,heraProfileBucket} from './predicate.ts';
import {runHeraMutation,type HeraMutationExecution} from './mutate.ts';
import type {HeraBudget,HeraTask,HeraLearningSnapshot,HeraMode,HeraExperience,HeraRolloutGroup,HeraTrajectory,HeraTopology,HeraProfile,HeraUsage} from './contracts.gen.ts';
const must=<T>(r:HeraOutcome<T>):T=>{if(!r.valid)throw new HeraRefusal(r.issues);return r.value;};
function refuse(code:Parameters<typeof heraIssue>[0],path:string,detail:string,cause?:unknown):never{throw new HeraRefusal([heraIssue(code,path,detail,cause)]);}
export interface HeraGroupHost extends HeraExecutorHost {
  /** Resolves the same CONFIG identity as role calls; stage is a durable diagnostic label. */
  controlClientFor(profile:string,identity:RunIdentity,stage:string):MasChatClient;
}
export interface HeraGroupRequest {task:HeraTask;snapshot:HeraLearningSnapshot;mode:HeraMode;groupIndex:number;budget:HeraBudget;groupConcurrency:number;mutationBudget?:HeraBudget;}
export interface HeraGroupExecution {group:HeraRolloutGroup;trajectories:HeraTrajectory[];topologies:HeraTopology[];mutation?:HeraMutationExecution;}
interface HeraPreparedGroup {profileValue:HeraProfile;offeredExperienceIds:string[];proposed:HeraOrchestration;share:HeraBudget;
  controlSpend:{calls:number;tokens:number;ms:number};controlUsage:HeraUsage;operationIds:string[];}
/** Snapshot membership remains readable after later library versions archive its entries. */
export async function readHeraFrozenLibrary(host:Pick<HeraExecutorHost,'store'>,snapshot:HeraLearningSnapshot):Promise<HeraExperience[]> {
  const entries:HeraExperience[]=[];
  for(const id of snapshot.experienceIds){
    const entry=await host.store.getExperience(id);
    if(!entry||entry.scope!==snapshot.scope)refuse('THERA1002','/experienceIds','A frozen experience is missing or belongs to another scope.');
    entries.push({...entry,status:'active'});
  }
  return entries;
}
export function createHeraGroupRunner(host:HeraGroupHost) {
  const executor=createHeraExecutor(host),pending=new Map<string,Promise<HeraOutcome<HeraGroupExecution>>>();
  const perform=async(request:HeraGroupRequest):Promise<HeraOutcome<HeraGroupExecution>>=>{
    try{
      if(!['learn','evaluate','infer'].includes(request.mode))refuse('THERA1001','/mode','A registered mode is required.');
      const task=must(validateHeraShape<HeraTask>('heraTask',request.task)),snapshot=must(await validateHeraRecord('snapshot',request.snapshot));
      must(assertTaskSplit(task,request.mode));
      if(task.scope!==host.store.scope||snapshot.scope!==task.scope)refuse('THERA1004','/scope','Task, store and snapshot must share scope.');
      const retained=await host.store.getSnapshot(snapshot.id);
      if(!retained||await heraRevisionOf({...retained,status:null})!==await heraRevisionOf({...snapshot,status:null}))refuse('THERA1002','/snapshot','The exact frozen snapshot must be retained.');
      if(!Number.isSafeInteger(request.groupIndex)||request.groupIndex<0||!Number.isSafeInteger(request.groupConcurrency)||request.groupConcurrency<1
        ||!Number.isSafeInteger(host.concurrency)||host.concurrency<1)refuse('THERA1001','/group','Indexes and concurrency must be bounded integers.');
      const requested=must(validateHeraShape<HeraBudget>('heraBudget',request.budget));
      if(!Object.values(requested).every(Number.isSafeInteger)||!Number.isSafeInteger(snapshot.config.groupSize))refuse('THERA1001','/budget','Budget dimensions and group size must be safe integers.');
      if(task.corpusRevision!==snapshot.identities.corpusRevision)refuse('THERA1002','/corpusRevision','The task differs from the frozen corpus.');
      must(await assertHeraCorpus(host.evidence,task.corpusRevision));must(validateHeraEvaluator(task,snapshot,host.evaluator,request.mode));
      if(host.embedder.dims===undefined||!sameIdentity(snapshot.identities.embeddedBy,{model:host.embedder.model,dims:host.embedder.dims}))refuse('THERA1009','/embedder','The profile embedder differs from the snapshot.');
      const prepared=must(await prepareHeraExecutionSnapshot(host.store,snapshot)),profile=prepared.agents[0]?.profile;
      if(!profile||prepared.agents.some(a=>a.profile!==profile))refuse('THERA1009','/profile','Every frozen role must resolve the same comparison profile.');
      const resolved=await resolveProfile({...host.profiles,request:{kind:'profile',profile,overrides:null}});
      if(!resolved.ok)refuse('THERA1009','/profile','The control profile cannot resolve.',resolved.issues);
      const identity=resolved.identity,chat=identity.roles.chat;
      if(snapshot.identities.model!==chat.provider+'/'+chat.model||snapshot.identities.decoder!==await heraRevisionOf(chat.inference)||!sameIdentity(snapshot.identities.embeddedBy,identity.embedding))refuse('THERA1002','/identity','The resolved control identity differs from the snapshot.');
      const tools=[...new Set(prepared.agents.flatMap(a=>a.tools))].sort(),toolRevision=await heraRevisionOf(HERA_EVIDENCE_INPUT);
      if(JSON.stringify(tools)!==JSON.stringify([...snapshot.identities.tools].sort())||JSON.stringify(tools)!==JSON.stringify(chat.tools.effective.map(t=>t.name).sort())
        ||chat.tools.effective.some(t=>t.name!=='hera-evidence'||t.inputSchemaRevision!==toolRevision))refuse('THERA1002','/tools','The frozen tool grants differ from CONFIG.');
      const budget={...requested,calls:Math.min(requested.calls,identity.budget.maxCalls??Infinity),tokens:Math.min(requested.tokens,identity.budget.maxTokens??Infinity),
        ms:Math.min(requested.ms,identity.budget.maxMs??Infinity),concurrency:Math.min(requested.concurrency,identity.budget.maxConcurrency??Infinity,host.concurrency)};
      if(!budget.concurrency)refuse('THERA1007','/budget/concurrency','The group has no concurrency allocation.');
      const groupConcurrency=Math.min(request.groupConcurrency,budget.concurrency),artifact=prepared.catalog.prompt('hera-plan-generation')!;
      const configRevision=await heraRevisionOf({config:snapshot.config,budget,groupConcurrency,artifactRevision:artifact.revision});
      const id=await heraRevisionOf([task.id,snapshot.id,request.groupIndex,configRevision]),binding=await heraRevisionOf({request,identityId:identity.identityId,evidenceRevision:host.evidence.revision,contextAdapter:host.evidence.contextAdapter??'documents',configRevision});
      const prior=await host.store.getRolloutGroup(id);
      if(prior){
        if(prior.requestBinding!==binding)refuse('THERA1007','/group/binding','This group key already binds different task or host input.');
        const trajectories=await Promise.all(prior.candidateTrajectoryIds.map(id=>host.store.getTrajectory(id))),topologies=await Promise.all((prior.topologyIds??[]).map(id=>host.store.getTopology(id)));
        if(trajectories.some(t=>!t)||topologies.some(t=>!t))refuse('THERA1007','/group','A completed group has missing durable evidence.');
        for(const trajectory of trajectories){
          if(!await host.masStore.getRun(trajectory!.masRunId)||(await Promise.all(trajectory!.stepIds.map(id=>host.store.getTrajectoryStep(id)))).some(s=>!s))
            refuse('THERA1007','/group/trajectory','The replay is missing its MAS execution or step evidence.');
        }
        const mutation=prior.mutationOperationId?await host.store.getOperation(prior.mutationOperationId):undefined;
        if(prior.mutationOperationId&&!mutation)refuse('THERA1007','/group/mutation','The retained mutation receipt is missing.');
        return {valid:true,value:{group:prior,trajectories:trajectories as HeraTrajectory[],topologies:topologies as HeraTopology[],...(mutation?{mutation:mutation.value as HeraMutationExecution}:{})}};
      }
      const authority={scope:task.scope,mode:request.mode},preparationId=await heraRevisionOf([task.scope,id,'prepared']);
      let preparation=await host.store.getOperation(preparationId);
      if(!preparation){
        const receipts=createHeraControlReceipts({store:host.store,authority,taskId:task.id,snapshotId:snapshot.id,groupId:id,binding,identity,budget,clock:host.clock});
        const profileValue=await profileQuery(task,snapshot,{artifact,client:host.controlClientFor(profile,identity,'profile'),embedder:host.embedder,receipts},budget);
        const selected=must(selectExperiences(await readHeraFrozenLibrary(host,snapshot),profileValue,{...snapshot.config,scope:task.scope}));
        const preferredTopologies:HeraTopology[]=[],hintId=snapshot.preferredTopologyIds?.[await heraProfileBucket(profileValue)];
        if(hintId){const retained=await host.store.getTopology(hintId);
          if(!retained||retained.scope!==task.scope)refuse('THERA1002','/preferredTopologyIds','The frozen topology hint is missing or foreign.');
          const hint={...retained,taskId:task.id,snapshotId:snapshot.id,profile:profileValue,offeredExperienceIds:[],appliedExperienceIds:[],workflowVersionId:null,nodes:retained.nodes.map(n=>({...n,promptVersionId:snapshot.activePromptVersionIds[n.agentId]}))};
          if(validateHeraTopology(hint,snapshot,prepared,budget).valid)preferredTopologies.push(hint);
        }
        const proposed=await orchestrate(task,snapshot,profileValue,selected.experiences,{...prepared,artifact,receipts,clientFor:index=>host.controlClientFor(profile,identity,'plan/'+index)},
          {groupId:id,configRevision,caps:budget,preferredTopologies});
        const operations=await host.store.listOperations({groupId:id,limit:10000}),responseIds=new Set(operations.filter(o=>o.phase==='response').map(o=>o.id));
        if(operations.some(o=>o.phase==='dispatch'&&!responseIds.has(o.id.slice(0,-9)+':response')))
          refuse('THERA1007','/operation','A control dispatch has no retained response; its physical spend is uncertain.');
        const controlSpend=receipts.spent(),count=proposed.candidates.length;
        const share=Object.fromEntries(Object.entries(budget).map(([key,value])=>[key,Math.floor(Math.max(0,value-(key==='calls'?controlSpend.calls:key==='tokens'?controlSpend.tokens:key==='ms'?controlSpend.ms:0))/Math.max(1,count))])) as unknown as HeraBudget;
        const value:HeraPreparedGroup={profileValue,offeredExperienceIds:selected.experiences.map(e=>e.id),proposed,share,controlSpend,controlUsage:receipts.usage(),operationIds:receipts.operationIds()};
        preparation=must(await host.store.transaction(authority,async tx=>{
          const existing=await tx.get('operation',preparationId);if(existing)return existing;
          return (await tx.put('operation',{id:preparationId,scope:task.scope,taskId:task.id,snapshotId:snapshot.id,groupId:id,stage:'group/prepared',phase:'result',status:'completed',binding,value,usage:emptyHeraUsage(),issues:[]})).value;
        }));
      }
      if(preparation.binding!==binding)refuse('THERA1007','/group/binding','The prepared group binds different task or host input.');
      const {profileValue,offeredExperienceIds,proposed,share,controlSpend,controlUsage,operationIds}=structuredClone(preparation.value) as HeraPreparedGroup;
      // Stored JSON does not preserve object aliases; mutations below must update the retained topology too.
      for(const candidate of proposed.candidates){const topology=proposed.topologies.find(t=>t.id===candidate.topology.id);if(!topology)refuse('THERA1007','/preparation','A prepared candidate has no topology.');candidate.topology=topology;}
      const configured=await heraConfigCatalog(profile,{...HERA_DEFAULT_LIMITS});
      if(!configured.valid)refuse('THERA1009','/config','The MAS profile catalog is invalid.',configured.issues);
      const config=configured.value;
      const failures=[...proposed.failures],skips=[] as HeraRolloutGroup['skips'];
      const topologies=[...proposed.topologies],trajectories:HeraTrajectory[]=[];
      // Compile all shares before dispatch. Invalid survivors are durable evidence, never executable repairs.
      const ready=[] as typeof proposed.candidates;
      for(const candidate of proposed.candidates){
        const built=await toMasWorkflow(candidate.topology,snapshot,{...prepared,config},share);
        if(!built.valid){candidate.topology.validation={valid:false,issues:built.issues};failures.push(...built.issues);proposed.refusals.invalidCandidates++;continue;}
        candidate.topology.workflowVersionId=built.value.validated.workflow.versionId;ready.push(candidate);
      }
      for(const topology of topologies)must(await host.store.putTopology(topology,authority));
      const executions=await mapConcurrent(ready,groupConcurrency,async candidate=>{
        try{return await executor.execute({task,snapshot,topology:candidate.topology,mode:request.mode,groupIndex:request.groupIndex,candidateIndex:candidate.index,configRevision,
          caps:{calls:share.calls,tokens:share.tokens,ms:share.ms,toolRounds:share.turns,fanOut:share.fanOut,concurrency:share.concurrency}});}
        catch(error){return {valid:false as const,issues:[heraIssue('THERA1009','/candidate/'+candidate.index,error instanceof Error?error.message:String(error))]};}
      });
      const spent={calls:controlSpend.calls,tokens:controlSpend.tokens,ms:controlSpend.ms};
      for(const [index,execution] of executions.entries()){
        const candidate=ready[index],candidateId=await heraRevisionOf([task.scope,task.id,snapshot.id,request.groupIndex,candidate.index,configRevision]),run=await host.masStore.getRun('hera:'+candidateId);
        // A competing writer or an unfinished execution cannot finalize the group as a failure.
        if(run&&!['completed','failed'].includes(run.status))refuse('THERA1007','/group/execution','A candidate still has an unresolved durable execution.');
        if(run){spent.calls+=run.budget.spent.turns;spent.tokens+=run.budget.spent.tokens;spent.ms+=run.budget.spent.ms;}
        if(!execution.valid){if(execution.issues.some(i=>i.code==='THERA1007'))throw new HeraRefusal(execution.issues);failures.push(...execution.issues);continue;}
        trajectories.push(execution.value.trajectory);if(execution.value.trajectory.failure)failures.push(execution.value.trajectory.failure.issue);
      }
      let mutation:HeraMutationExecution|undefined,refinementBudget:HeraRolloutGroup['refinementBudget'];
      if(request.mode==='learn'&&snapshot.config.flags.mutation){
        const profileBucket=await heraProfileBucket(profileValue),failure=must(persistentFailure(snapshot.failureState,{profileBucket,groupId:id,primaryScore:rankTrajectories(trajectories).ranked[0]?.primaryScore??null},snapshot.config));
        if(failure.trigger){
          const allocation=request.mutationBudget?must(validateHeraShape<HeraBudget>('heraBudget',request.mutationBudget)):{...budget,calls:Math.max(0,budget.calls-spent.calls),tokens:Math.max(0,budget.tokens-spent.tokens),ms:Math.max(0,budget.ms-spent.ms)};
          if(!Object.values(allocation).every(Number.isSafeInteger))refuse('THERA1001','/mutationBudget','Mutation allowances require safe integers.');
          const limits={...allocation,calls:Math.min(allocation.calls,identity.budget.maxCalls??Infinity),tokens:Math.min(allocation.tokens,identity.budget.maxTokens??Infinity),ms:Math.min(allocation.ms,identity.budget.maxMs??Infinity),concurrency:Math.min(allocation.concurrency,identity.budget.maxConcurrency??Infinity,host.concurrency)};
          mutation=await runHeraMutation({task,snapshot,groupId:id,groupIndex:request.groupIndex,configRevision,binding,profileBucket,trajectories,budget:limits,identity},host);
          if(mutation.topology)topologies.push(mutation.topology);if(mutation.trajectory)trajectories.push(mutation.trajectory);
          refinementBudget={limits,spent:mutation.mutation.spent,controlUsage:mutation.controlUsage};
          if(!mutation.mutation.validation.valid){failures.push(...mutation.mutation.validation.issues);proposed.refusals.invalidCandidates++;}
        }
      }
      const ranked=rankTrajectories(trajectories),group:HeraRolloutGroup={id,scope:task.scope,taskId:task.id,snapshotId:snapshot.id,groupIndex:request.groupIndex,requestedSize:snapshot.config.groupSize+Number(mutation!==undefined),
        candidateTrajectoryIds:trajectories.map(t=>t.id),failures,skips,ranking:ranked.ranked.map(t=>t.id),mixedOutcome:mixedOutcome(trajectories),budget:{limits:budget,spent},
        state:trajectories.some(t=>t.status==='orphan')?'orphan':trajectories.length?'completed':'failed',configRevision,requestBinding:binding,profile:profileValue,
        offeredExperienceIds,topologyIds:topologies.map(t=>t.id),operationIds:[...operationIds,preparationId,...(mutation?[...mutation.mutation.operationIds,mutation.operationId]:[])],unevaluatedTrajectoryIds:ranked.unevaluatedIds,controlUsage,refusals:proposed.refusals,...(mutation?{mutationOperationId:mutation.operationId,refinementBudget}: {})};
      must(await host.store.putRolloutGroup(group,authority));return {valid:true,value:{group,trajectories,topologies,...(mutation?{mutation}:{})}};
    }catch(error){if(error instanceof HeraRefusal)return {valid:false,issues:error.issues};throw error;}
  };
  return {run(request:HeraGroupRequest){
    request=structuredClone(request);const key=JSON.stringify(request),active=pending.get(key);if(active)return active;
    const work=perform(request).finally(()=>pending.delete(key));pending.set(key,work);return work;
  }};
}
export const runRolloutGroup=(request:HeraGroupRequest,host:HeraGroupHost)=>createHeraGroupRunner(host).run(request);
