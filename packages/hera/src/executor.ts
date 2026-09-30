/** One durable MAS executor; hosts own credentials, queues, storage and scoring. */
import { resolveProfile, type RunIdentity } from '@tangleai/config';
import { sameIdentity } from '@tangleai/context';
import { createGmplCatalog, renderGmplPrompt, type GmplPatternResult } from '@tangleai/gmpl';
import { compileMasRuntime, createMasRegistrySnapshot, jsonSchemaAdapter, masRevisionOf,
  type MasStore, type MasRuntime, type MasChatClient, type AgentNode, type MasMessageAdapter, type MasRuntimeObserver, type WorkflowLimits } from '@tangleai/mas';
import type { Embedder } from '@tangleai/models/embed';
import { heraArtifacts } from './artifacts.ts';
import { heraRegistryDocument, heraConfigCatalog, HERA_EVIDENCE_INPUT } from './registry.ts';
import { heraRevisionOf, heraContentIdOf } from './identity.ts';
import { validateHeraRecord, validateHeraShape } from './schema.ts';
import { compileEffectivePrompt } from './prompt.ts';
import { assertTaskSplit } from './modes.ts';
import { HeraRefusal, heraIssue, heraRefuse, type HeraOutcome } from './errors.ts';
import { prepareHeraScaffold, HERA_FIXED_NODES, HERA_DEFAULT_LIMITS } from './scaffold.ts';
import { assertHeraCorpus, validateHeraEvidenceUnits, createHeraContextBindings, createHeraEvidenceTool, validateHeraAnswer,
  type HeraEvidenceProvider, type HeraEvidenceUnit, type HeraAnswerEvidence } from './evidence.ts';
import { assembleHeraTrajectory } from './trajectory.ts';
import { toMasWorkflow } from './topology.ts';
import { validateHeraEvaluator, validateHeraTaskScore, type HeraTaskAdapter } from './evaluator.ts';
import type { HeraStore } from './store.ts';
import type { HeraTask, HeraLearningSnapshot, HeraMode, HeraTopology, HeraAgentDefinition, HeraTrajectory, HeraTrajectoryStep } from './contracts.gen.ts';
export interface HeraExecutorHost {
  store:HeraStore; masStore:MasStore;
  /** Enqueues the deterministic segment and drives the existing MAS worker. */
  segments:{drive(runId:string,runtime:MasRuntime):Promise<void>};
  profiles:{registry:unknown;host:unknown};
  clientFor(profile:string,identity:RunIdentity,node:AgentNode):MasChatClient;
  embedder:Embedder; evidence:HeraEvidenceProvider; evaluator:HeraTaskAdapter;
  now:()=>string;clock:()=>number;concurrency:number;observer?:MasRuntimeObserver;
}
export interface HeraExecuteRequest {
  task:HeraTask;snapshot:HeraLearningSnapshot;topology:'fixed'|'single-turn'|HeraTopology;mode:HeraMode;
  groupIndex:number;candidateIndex:number;configRevision:string;caps?:Partial<WorkflowLimits>;
}
export interface HeraExecution {trajectory:HeraTrajectory;steps:HeraTrajectoryStep[];}
const must=<T>(r:HeraOutcome<T>):T=>{if(!r.valid)throw new HeraRefusal(r.issues);return r.value;};
function refuse(code:Parameters<typeof heraIssue>[0],path:string,detail:string,cause?:unknown):never {throw new HeraRefusal([heraIssue(code,path,detail,cause)]);}
/** Snapshot membership, not today's active pointers, controls old frozen executions. */
export async function prepareHeraExecutionSnapshot(store:HeraStore,snapshot:HeraLearningSnapshot) {
  const shape=await validateHeraRecord('snapshot',snapshot);if(!shape.valid)return shape;
  const catalog=await createGmplCatalog(heraArtifacts);if(!catalog.valid)return heraRefuse('THERA1002','/catalog','The role catalog is invalid.',catalog.issues);
  const agents:HeraAgentDefinition[]=[];
  const prompts=new Map<string,string>();
  for(const [agentId,promptId] of Object.entries(snapshot.activePromptVersionIds)) {
    const agent=await store.getAgent(agentId),prompt=await store.getPromptVersion(promptId);
    if(!agent||!prompt||agent.scope!==snapshot.scope||prompt.scope!==snapshot.scope||prompt.agentId!==agentId)
      return heraRefuse('THERA1002','/activePromptVersionIds/'+agentId,'A frozen agent or prompt is missing or belongs to another scope.');
    const artifact=catalog.value.prompt(agent.artifactId);
    if(!artifact)return heraRefuse('THERA1002','/artifactId','A pinned role artifact is absent.');
    const compiled=await compileEffectivePrompt(artifact,prompt);if(!compiled.valid)return compiled;
    if(compiled.value!==prompt.effectivePrompt)return heraRefuse('THERA1002','/effectivePrompt','The stored prompt does not compile from its frozen blocks.');
    agents.push(agent);prompts.set(agentId,compiled.value);
  }
  const document=await heraRegistryDocument(catalog.value,{agents});if(!document.valid)return document;
  for(const role of document.value.roles){const prompt=prompts.get(role.id);if(prompt!==undefined){role.instructions=prompt;role.instructionsRevision=await masRevisionOf(prompt);}}
  const registry=await createMasRegistrySnapshot(document.value);
  if(!registry.valid)return heraRefuse('THERA1002','/registry','The role registry does not validate.',registry.issues);
  if(registry.value.revision!==snapshot.registryRevision)return heraRefuse('THERA1002','/registryRevision','The effective role registry differs from the frozen snapshot.');
  return {valid:true as const,value:{catalog:catalog.value,registry:registry.value,agents}};
}
export function createHeraExecutor(host:HeraExecutorHost) {
  const pending=new Map<string,Promise<HeraOutcome<HeraExecution>>>();
  const perform=async(request:HeraExecuteRequest):Promise<HeraOutcome<HeraExecution>>=>{
    try {
      if(!['learn','evaluate','infer'].includes(request.mode)||request.topology===null||!['string','object'].includes(typeof request.topology)
        ||(typeof request.topology==='string'&&!['fixed','single-turn'].includes(request.topology)))refuse('THERA1001','/request','Execution requires a registered mode and topology.');
      const task=must(validateHeraShape<HeraTask>('heraTask',request.task)),snapshot=must(await validateHeraRecord('snapshot',request.snapshot));
      must(assertTaskSplit(task,request.mode));
      if(task.scope!==host.store.scope||snapshot.scope!==task.scope)refuse('THERA1004','/scope','Task, snapshot and store must share scope.');
      if(!await host.store.getSnapshot(snapshot.id))refuse('THERA1002','/snapshot','The frozen snapshot must be retained in the scoped store.');
      if(task.corpusRevision!==snapshot.identities.corpusRevision)refuse('THERA1002','/corpusRevision','Task and snapshot corpus pins differ.');
      must(await assertHeraCorpus(host.evidence,task.corpusRevision));
      if(!Number.isSafeInteger(request.groupIndex)||request.groupIndex<0||!Number.isSafeInteger(request.candidateIndex)||request.candidateIndex<0||!/^[0-9a-f]{64}$/.test(request.configRevision))
        refuse('THERA1001','/key','Candidate keys require nonnegative indexes and a canonical configuration revision.');
      if(host.embedder.dims===undefined || !sameIdentity(snapshot.identities.embeddedBy,{model:host.embedder.model,dims:host.embedder.dims}))refuse('THERA1009','/embedder','The embedder differs from the frozen identity.');
      must(validateHeraEvaluator(task,snapshot,host.evaluator,request.mode));
      const prepared=must(await prepareHeraExecutionSnapshot(host.store,snapshot));
      const profile=prepared.agents[0]?.profile;
      if(!profile||prepared.agents.some(a=>a.profile!==profile))refuse('THERA1009','/profile','The fixed comparison uses one resolved model profile.');
      const resolution=await resolveProfile({registry:host.profiles.registry,host:host.profiles.host,request:{kind:'profile',profile,overrides:null}});
      if(!resolution.ok)refuse('THERA1009','/profile','The configured model profile cannot resolve.',resolution.issues);
      const identity=resolution.identity,chat=identity.roles.chat;
      if(!chat||snapshot.identities.model!==chat.provider+'/'+chat.model||snapshot.identities.decoder!==await heraRevisionOf(chat.inference)
        ||!sameIdentity(snapshot.identities.embeddedBy,identity.embedding))refuse('THERA1002','/identity','The resolved model, decoder or embedding differs from the snapshot.');
      const tools=chat.tools.effective,allowed=[...new Set(prepared.agents.flatMap(a=>a.tools))].sort(),toolRevision=await heraRevisionOf(HERA_EVIDENCE_INPUT);
      if(JSON.stringify([...snapshot.identities.tools].sort())!==JSON.stringify(allowed)
        ||JSON.stringify(tools.map(t=>t.name).sort())!==JSON.stringify(allowed)
        ||tools.some(t=>t.name!=='hera-evidence'||t.inputSchemaRevision!==toolRevision))
        refuse('THERA1002','/tools','Resolved tool names and schemas must match the frozen role grants.');
      if(!Number.isSafeInteger(host.concurrency)||host.concurrency<1)throw new TypeError('HERA host concurrency must be a positive integer.');
      const caps:Partial<WorkflowLimits>={...request.caps,concurrency:Math.min(request.caps?.concurrency??HERA_DEFAULT_LIMITS.concurrency,host.concurrency,identity.budget.maxConcurrency??Infinity)};
      for(const [field,limit] of [['calls',identity.budget.maxCalls],['tokens',identity.budget.maxTokens],['ms',identity.budget.maxMs]] as const)
        if(limit!==null)caps[field]=Math.min(caps[field]??HERA_DEFAULT_LIMITS[field],limit);
      const config=await heraConfigCatalog(profile,{...HERA_DEFAULT_LIMITS});if(!config.valid)refuse('THERA1009','/config','The MAS profile catalog is invalid.',config.issues);
      const supplied=typeof request.topology==='object'?must(await validateHeraRecord('topology',request.topology)):null;
      if(supplied&&(supplied.taskId!==task.id||!supplied.validation.valid))refuse('THERA1003','/topology','Only a valid candidate for this task can execute.');
      const scaffold=must(supplied?await toMasWorkflow(supplied,snapshot,{...prepared,config:config.value},
        {calls:caps.calls??HERA_DEFAULT_LIMITS.calls,tokens:caps.tokens??HERA_DEFAULT_LIMITS.tokens,ms:caps.ms??HERA_DEFAULT_LIMITS.ms,
          turns:caps.toolRounds??HERA_DEFAULT_LIMITS.toolRounds,nodes:snapshot.config.maxAgents,depth:snapshot.config.maxAgents,
          fanOut:caps.fanOut??HERA_DEFAULT_LIMITS.fanOut,concurrency:caps.concurrency!})
        :await prepareHeraScaffold({...prepared,config:config.value},{kind:request.topology as 'fixed'|'single-turn',caps}));
      const workflow=scaffold.validated.workflow;
      const key=[task.id,snapshot.id,request.groupIndex,request.candidateIndex,request.configRevision],id=await heraRevisionOf([task.scope,...key]),runId='hera:'+id;
      const binding=await heraRevisionOf({task,snapshotId:snapshot.id,workflowVersionId:workflow.versionId,identityId:identity.identityId,evidenceRevision:host.evidence.revision,contextAdapter:host.evidence.contextAdapter??'documents'});
      let run=await host.masStore.getRun(runId);
      const oldInput=run?.input as {query:string;evidence:HeraEvidenceUnit[];binding:string}|undefined;
      if(run && (oldInput?.binding!==binding||run.workflowVersionId!==workflow.versionId))refuse('THERA1007','/key','A candidate key already binds different task, workflow or host identities.');
      const prior=await host.store.getTrajectory(id);
      if(prior&&!run)refuse('THERA1007','/run','The stored trajectory has no durable execution binding.');
      if(prior){const steps=await Promise.all(prior.stepIds.map(id=>host.store.getTrajectoryStep(id)));if(steps.some(s=>!s))refuse('THERA1007','/steps','A stored trajectory has missing attempts.');return {valid:true,value:{trajectory:prior,steps:steps as HeraTrajectoryStep[]}};}
      const units=must(await validateHeraEvidenceUnits(oldInput?.evidence??await host.evidence.recall(task.query,{k:4,signal:new AbortController().signal})));
      must(await assertHeraCorpus(host.evidence,task.corpusRevision));
      if(units.length>4||units.reduce((n,e)=>n+JSON.stringify(e).length,0)>workflow.limits.contextChars)refuse('THERA1007','/evidence','The frozen evidence slice exceeds the context bound.');
      const declarations=request.topology==='single-turn'?[{...HERA_FIXED_NODES[5],dependsOn:[]}]:HERA_FIXED_NODES;
      const payload={scope:task.scope,taskId:task.id,snapshotId:snapshot.id,profile:{text:task.query,tags:[],embedding:[],embeddedBy:snapshot.identities.embeddedBy},
        nodes:declarations.map(n=>({...n,dependsOn:[...n.dependsOn],promptVersionId:snapshot.activePromptVersionIds[n.agentId]})),offeredExperienceIds:[],appliedExperienceIds:[],
        generator:{kind:'fixed' as const,configRevision:request.configRevision},validation:{valid:true,issues:[]},workflowVersionId:workflow.versionId};
      const topology:HeraTopology=supplied??{...payload,id:await heraContentIdOf(payload)};
      if(supplied?.workflowVersionId!==null&&supplied?.workflowVersionId!==undefined&&supplied.workflowVersionId!==workflow.versionId)
        refuse('THERA1003','/workflowVersionId','The retained workflow differs from the compiled candidate.');
      const authority={scope:task.scope,mode:request.mode};must(await host.store.putTopology(topology,authority));
      const adapters=new Map<string,MasMessageAdapter>([[jsonSchemaAdapter.id,jsonSchemaAdapter]]);
      for(const artifact of prepared.catalog.document.prompts)adapters.set('hera-'+artifact.id,{id:'hera-'+artifact.id,version:artifact.revision,render(input){
        const rendered=renderGmplPrompt(artifact,{query:input.value.subquery??input.value.query,evidence:units.map(({id,digest,text})=>({id,digest,text})),context:input.value});
        if(!rendered.valid)throw new HeraRefusal(rendered.issues.map(i=>heraIssue('THERA1001',i.path,i.detail,i)));
        return rendered.value.user;
      }});
      const compiled=compileMasRuntime(scaffold.validated,scaffold.plan,prepared.registry,{store:host.masStore,now:host.now,clock:host.clock,observer:host.observer,
        clientFor:node=>host.clientFor(node.profile,identity,node),contextProviders:createHeraContextBindings(units,task.corpusRevision,host.evidence.contextAdapter),
        toolBindings:{'hera-evidence':createHeraEvidenceTool(host.evidence,task.corpusRevision)},messageAdapters:adapters,
        taskHandlers:{'hera-validate-answer':async({value})=>({result:await validateHeraAnswer(value.answer as GmplPatternResult,units)})}});
      if(!compiled.valid)refuse('THERA1009','/bindings','The host cannot bind the frozen workflow.',compiled.issues);
      if(!run){
        for(const saved of [await host.masStore.putWorkflowVersion(workflow),await host.masStore.putRegistrySnapshot(prepared.registry.document as unknown as Record<string,unknown>,prepared.registry.revision)])
          if(!saved.ok)refuse('THERA1007','/persistence','The workflow identity could not be persisted.',saved.issue);
        const created=await host.masStore.createRun({runId,workflowId:workflow.workflowId,workflowVersionId:workflow.versionId,registryRevision:prepared.registry.revision,
          executableRevision:scaffold.plan.executableRevision,configRegistryRevision:config.value.revision,profile,input:{query:task.query,evidence:units,binding},limits:{...workflow.limits}});
        if(!created.ok)refuse('THERA1007','/run','The candidate run could not be created.',created.issue);run=created.value;
      }
      if(!['completed','failed'].includes(run.status))await host.segments.drive(runId,compiled.value);
      const trace=await host.masStore.readTrace(runId);if(!trace)refuse('THERA1007','/trace','The durable candidate trace is missing.');
      const answer=trace.run.status==='completed'?(trace.run.output as {result:HeraAnswerEvidence}).result
        :await validateHeraAnswer({answer:'',disposition:'needs-information',claims:[],findings:[]},[]);
      const score=must(validateHeraTaskScore(task.evaluator===null?{primaryScore:null,success:null}:await host.evaluator.score(task,answer.answer,answer)));
      if(task.evaluator!==null&&score.primaryScore===null)refuse('THERA1001','/score','An evaluated task cannot discard its score.');
      const result=await assembleHeraTrajectory({id,groupId:await heraRevisionOf([task.id,snapshot.id,request.groupIndex,request.configRevision]),task,snapshot,topology,trace,
        workflow,identityId:identity.identityId,answer,score,maxChars:workflow.limits.contextChars});
      must(await host.store.transaction(authority,async tx=>{for(const step of result.steps)await tx.put('trajectoryStep',step);await tx.put('trajectory',result.trajectory);}));
      return {valid:true,value:result};
    }catch(error){if(error instanceof HeraRefusal)return {valid:false,issues:error.issues};throw error;}
  };
  return {execute(request:HeraExecuteRequest):Promise<HeraOutcome<HeraExecution>> {
    request=structuredClone(request);
    const key=JSON.stringify(request);
    const active=pending.get(key);if(active)return active;
    const work=perform(request).finally(()=>pending.delete(key));pending.set(key,work);return work;
  }};
}
