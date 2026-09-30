/** Keyless host composition: CONFIG, frozen roles, SQLite jobs and replay. */
import {createGmplCatalog,gmplTextDigest} from '@tangleai/gmpl';
import {resolveProfile,type ProfileRegistry,type HostManifest} from '@tangleai/config';
import {createMasRegistrySnapshot,type MasStore,type MasRuntime} from '@tangleai/mas';
import {createMasSegmentWorker,enqueueMasSegment,openTangleDb,createMasStore,createHeraStore,type TangleDb} from '@tangleai/store';
import {heraArtifacts,createHeraAgents,heraRegistryDocument,heraContentIdOf,heraLibraryRevisionOf,heraRevisionOf,
  emptyHeraHead,planPromptActivation,planSnapshotActivation,createHeraExecutor,HERA_EVIDENCE_INPUT,
  type HeraStore,type HeraLearningSnapshot,type HeraLearningConfig,type HeraEvidenceProvider,type HeraTask,type HeraOutcome} from '@tangleai/hera';
export function heraValue<T>(outcome:{valid:true;value:T}|{valid:false;issues:unknown[]}):T {if(!outcome.valid)throw Error(JSON.stringify(outcome.issues));return outcome.value;}
export const HERA_EXAMPLE_CONFIG:HeraLearningConfig={groupSize:3,maxAgents:5,selectorVersion:'mmr-v1',selectorWeights:{similarity:1,utility:0.5,novelty:0.25,selectionPenalty:0.1},selectorCap:4,libraryCap:32,operationCap:8,failureBufferSize:8,consecutiveFailures:3,variantAxes:['evidence','decomposition'],promptBounds:{maxRules:16,maxBytes:8192,maxOps:16},flags:{experience:false,rope:false,mutation:false}};
export async function createHeraExampleState(store:HeraStore,options:{corpusRevision:string;embeddedBy:{model:string;dims:number};config?:HeraLearningConfig}) {
  const toolRevision=await heraRevisionOf(HERA_EVIDENCE_INPUT);
  const registry:ProfileRegistry={version:1,credentialSlots:[],candidates:[
    {id:'scripted-chat',kind:'chat',provider:'ollama',model:'hera-scripted',baseUrl:null,credentialSlot:null,features:[],rateCard:null},
    {id:'scripted-embedding',kind:'embedding',provider:'builtin',model:options.embeddedBy.model,dims:options.embeddedBy.dims,baseUrl:null,credentialSlot:null,features:[],rateCard:null}],
    capabilities:[],prompts:[],responseSchemas:[],components:[],inference:[],budgets:[],profiles:[{id:'scripted',kind:'root',description:'Keyless injected client',roles:{chat:{candidate:'scripted-chat',capability:null,prompt:null,responseSchema:null,tools:['hera-evidence'],toolsRequired:true,inference:null,ranker:null}},embedding:'scripted-embedding',policyComponent:null,budget:null}]};
  const host:HostManifest={sourceClass:'synthetic',credentialSlots:[],providers:[{provider:'ollama',base:'http://127.0.0.1:11434/v1',models:['hera-scripted'],features:[]}],
    embedding:[{provider:'builtin',base:null,...options.embeddedBy}],tools:[{name:'hera-evidence',description:'Pinned evidence',inputSchemaRevision:toolRevision}],components:[],
    budget:{maxCalls:24,maxTokens:65536,maxMs:120000,maxConcurrency:4},observation:null};
  const resolution=await resolveProfile({registry,host,request:{kind:'profile',profile:'scripted',overrides:null}});if(!resolution.ok)throw Error(JSON.stringify(resolution.issues));
  const catalog=heraValue(await createGmplCatalog(heraArtifacts)),created=heraValue(await createHeraAgents(catalog,{scope:store.scope,profile:'scripted',at:'2020-01-01T00:00:00.000Z'}));
  const pinned=heraValue(await createMasRegistrySnapshot(heraValue(await heraRegistryDocument(catalog,{agents:created.agents}))));
  const body={scope:store.scope,parentId:null,activePromptVersionIds:Object.fromEntries(created.prompts.map(p=>[p.agentId,p.id])),libraryRevision:await heraLibraryRevisionOf([]),experienceIds:[],registryRevision:pinned.revision,
    identities:{model:'ollama/hera-scripted',decoder:await heraRevisionOf(resolution.identity.roles.chat.inference),tools:['hera-evidence'],corpusRevision:options.corpusRevision,embeddedBy:options.embeddedBy,evaluator:{id:'fixture-exact',version:'1',successRuleId:'exact-v1'}},config:options.config??HERA_EXAMPLE_CONFIG,status:'staged' as const};
  const snapshot:HeraLearningSnapshot={...body,id:await heraContentIdOf(body)},authority={scope:store.scope,mode:'learn' as const};
  const existing=await store.getSnapshot(snapshot.id);
  if(!existing)heraValue(await store.transaction(authority,async tx=>{
    for(const agent of created.agents)await tx.put('agent',agent);
    for(const prompt of created.prompts){await tx.put('promptVersion',prompt);const head=emptyHeraHead(store.scope,'prompt',prompt.agentId);await tx.transitionHead(heraValue(planPromptActivation(head,head,prompt)));}
    await tx.put('snapshot',snapshot);const head=emptyHeraHead(store.scope,'snapshot');await tx.transitionHead(heraValue(planSnapshotActivation(head,head,snapshot)));
  }));
  return {profiles:{registry,host},snapshot:(await store.getSnapshot(snapshot.id))!,catalog,...created};
}
/** A host adapter around the existing worker, with no separate queue or checkpoint format. */
export function createHeraExampleSegments(db:TangleDb,store:MasStore) {
  return {async drive(runId:string,runtime:MasRuntime){
    const run=await store.getRun(runId);if(!run)throw Error('Missing HERA run');
    await enqueueMasSegment(db,{runId,segment:run.segment,workflowVersionId:runtime.workflow.versionId,registryRevision:runtime.plan.registryRevision,executableRevision:runtime.plan.executableRevision});
    let resolve!:()=>void,reject!:(error:unknown)=>void;
    const done=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    const timeout=setTimeout(()=>reject(Error('HERA example worker deadline')),15000);
    const worker=createMasSegmentWorker(db,store,{executableRevisions:[runtime.plan.executableRevision],concurrency:1,pollInterval:1,owner:'hera-example',execute:async job=>{
      try{await runtime.executeSegment(job);resolve();}catch(error){reject(error);throw error;}
    }});
    worker.start();try{await done;}finally{clearTimeout(timeout);await worker.stop();}
  }};
}
/** Reopen a completed candidate and prove zero additional provider calls. */
export async function runHeraExample(path:string) {
  const text='The Lumen archive is in Eastmere.',unit={id:'archive',text,digest:await gmplTextDigest(text),address:'document:lumen/v1/archive'};
  const corpusRevision=await heraRevisionOf([unit]),embeddedBy={model:'hera-example',dims:2};
  const evidence:HeraEvidenceProvider={revision:await heraRevisionOf({kind:'example',corpusRevision}),currentCorpusRevision:()=>corpusRevision,recall:async()=>[unit]};
  let calls=0,tick=0;const now=()=>`tick-${String(tick++).padStart(6,'0')}`,clock=()=>1000000;
  const open=()=>openTangleDb({path,jobs:{now:clock,random:()=>0.5}});
  let db=await open();
  const host=async()=>{
    const store=createHeraStore(db,{scope:'hera-example'}),masStore=createMasStore(db,{now}),state=await createHeraExampleState(store,{corpusRevision,embeddedBy});
    const task:HeraTask={id:'archive-location',scope:store.scope,query:'Where is the Lumen archive?',corpusRevision,split:'held-out',evaluator:state.snapshot.identities.evaluator,goldAddress:'fixture:archive-location'};
    const executor=createHeraExecutor({store,masStore,segments:createHeraExampleSegments(db,masStore),profiles:state.profiles,evidence,
      embedder:{...embeddedBy,embed:async texts=>texts.map(()=>new Float32Array([1,0]))},evaluator:{identity:state.snapshot.identities.evaluator,score:async(_task,answer)=>({primaryScore:answer==='Eastmere'?1:0,success:answer==='Eastmere'})},
      now,clock,concurrency:4,clientFor:(_profile,_identity,node)=>({endpoint:{provider:'ollama'},complete:async()=>{calls++;const result={answer:'Eastmere',disposition:'completed',claims:[{text:'The archive is in Eastmere.',citations:[{id:unit.id,digest:unit.digest}]}],findings:[]};
        return {message:{role:'assistant',content:JSON.stringify({...result,...(node.role==='query-decomposer'?{queries:[task.query,task.query]}:node.role==='retriever'||node.role==='evidence-selector'?{selectedEvidenceIds:[unit.id]}:{})})},finishReason:'stop',usage:{prompt_tokens:7,completion_tokens:3}};}})});
    return {executor,request:{task,snapshot:state.snapshot,topology:'fixed' as const,mode:'evaluate' as const,groupIndex:0,candidateIndex:0,configRevision:await heraRevisionOf({kind:'example-fixed'})}};
  };
  try{const first=await host(),result=heraValue(await first.executor.execute(first.request)),before=calls;await db.close();db=await open();const second=await host(),replay=heraValue(await second.executor.execute(second.request));
    return {result,replay,calls,replayCalls:calls-before,reopens:1};
  }finally{await db.close();}
}
