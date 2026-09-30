/** Scripted physical calls execute the real durable stack; the scorer alone reads truth. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {resolveProfile,type RunIdentity} from '@tangleai/config';
import {createOfflineEmbedder} from '@tangleai/pipeline';
import {openTangleDb,createDocumentStore,createHeraStore,createMasStore,type TangleDb} from '@tangleai/store';
import {createHeraDocumentEvidenceProvider,createHeraExecutor,heraRevisionOf,HERA_DEFAULT_LIMITS,type HeraTask,type HeraExecution} from '@tangleai/hera';
import {createHeraExampleState,createHeraExampleSegments,heraValue} from '../../examples/hera.ts';
import {officialScore,normalizeAnswer} from './locomo-parity.ts';
import {SCORABLE_CATEGORIES} from './locomo.ts';
import type {HeraFixture} from './hera-qa.ts';
import type {Row} from './hera-qa.types.ts';
import type {HeraPlanOutput} from '@tangleai/hera';
import type {HeraTrainingSequence,HeraReflectionScript,HeraConsolidationScript,HeraRopeScript} from './hera-learning-scripts.ts';
import {heraQuality} from './hera-quality.ts';
type Script=Record<string,Record<'single-turn'|'fixed',Record<string,{completion:unknown;normalization:unknown;repair:unknown;tool?:{query:string;k:number}}>>>;
export interface HeraOrchestratorScript {kind:string;profile:{text:string;tags:string[]};plans:Record<string,HeraPlanOutput>;proposals:Record<string,string[]>;}
export async function loadHeraScripts(root:string) {
  const directory=join(root,'benchmark/fixtures/hera/scripts'),manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')) as {kind:string;files:Array<{path:string;sha256:string}>};
  if(manifest.kind!=='hera-scripted/v4'||JSON.stringify(manifest.files.map(f=>f.path))!==JSON.stringify(['baseline.json','orchestrator.json','reflection.json','consolidation.json','rope.json','../sequence.json']))throw Error('Invalid HERA script registration.');
  const files=new Map<string,string>();
  for(const file of manifest.files){const bytes=await readFile(join(directory,file.path),'utf8');if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('HERA script bytes changed.');files.set(file.path,bytes);}
  return {rope:JSON.parse(files.get('rope.json')!) as HeraRopeScript,revision:await heraRevisionOf(manifest),scripts:JSON.parse(files.get('baseline.json')!) as Script,orchestrator:JSON.parse(files.get('orchestrator.json')!) as HeraOrchestratorScript,
    sequence:JSON.parse(files.get('../sequence.json')!) as HeraTrainingSequence,reflection:JSON.parse(files.get('reflection.json')!) as HeraReflectionScript,consolidation:JSON.parse(files.get('consolidation.json')!) as HeraConsolidationScript};
}
/** The native document store and recall implementation own ranking and identity gates. */
export async function createHeraFixtureEvidence(db:TangleDb,corpus:HeraFixture['corpus'],corpusRevision:string) {
  const embedder=createOfflineEmbedder(),embeddedBy={model:embedder.model,dims:embedder.dims!},store=createDocumentStore(db),sourceId='hera-fixture';
  const vectors=await embedder.embed(corpus.map(p=>p.text)),at='2020-01-01T00:00:00.000Z';
  await store.activate({source:{id:sourceId,requestedUrl:'https://fixture.invalid/hera',finalUrl:'https://fixture.invalid/hera',canonicalUrl:'https://fixture.invalid/hera',title:'Original HERA corpus',mimeType:'text/plain',fetchMode:'static',status:'ready',fetchedAt:at,activeVersionId:corpusRevision},
    version:{id:corpusRevision,sourceId,contentHash:corpusRevision,extractionVersion:'authored/v1',chunkerVersion:'authored/v1',chunkerConfig:{maxTokens:256,overlapTokens:0},embeddedBy,status:'active',fetchedAt:at,
      metrics:{bytes:Buffer.byteLength(corpus.map(p=>p.text).join('\n')),elements:corpus.length,chunks:corpus.length,extractionMs:0,chunkingMs:0,embeddingMs:0,embeddingCalls:1,estimatedEmbeddingTokens:0,partial:false,warnings:[]}},
    elements:corpus.map((p,order)=>({id:p.id,sourceId,versionId:corpusRevision,text:p.text,role:'paragraph',order,headingPath:[]})),
    chunks:corpus.map((p,order)=>({id:p.id,sourceId,versionId:corpusRevision,elementIds:[p.id],text:p.text,tokenCount:Math.ceil(p.text.length/4),order,headingPath:[],embedding:Array.from(vectors[order]),embeddedBy}))});
  const evidence=createHeraDocumentEvidenceProvider({store,embedder,corpusRevision,currentCorpusRevision:async()=> (await store.getSource(sourceId))?.activeVersionId??'',revision:await heraRevisionOf({corpusRevision,policy:'native-document-cosine-k4/v1',embeddedBy})});
  return {embedder,embeddedBy,evidence,documents:store};
}
export async function runHeraBaselines(fixture:HeraFixture,root:string) {
  const registration=await loadHeraScripts(root),db=await openTangleDb({jobs:{now:()=>1000000,random:()=>0.5}});
  let tick=0,requests=0,replayCalls=0,maxConcurrentRetrievers=0;
  const now=()=>`tick-${String(tick++).padStart(6,'0')}`,rows:Row[]=[],identities:RunIdentity[]=[];
  try{
    const {embedder,embeddedBy,evidence}=await createHeraFixtureEvidence(db,fixture.corpus,fixture.manifest.revision);
    const store=createHeraStore(db,{scope:'hera-baseline'}),masStore=createMasStore(db,{now});
    const state=await createHeraExampleState(store,{corpusRevision:fixture.manifest.revision,embeddedBy});
    const resolved=await resolveProfile({...state.profiles,request:{kind:'profile',profile:'scripted',overrides:null}});if(!resolved.ok)throw Error(JSON.stringify(resolved.issues));identities.push(resolved.identity);
    const truth=new Map(fixture.questions.map(q=>[q.id,q.gold.answer]));
    const evaluator={identity:state.snapshot.identities.evaluator,async score(task:HeraTask,answer:string){const success=normalizeAnswer(answer)===normalizeAnswer(truth.get(task.id)!);return {primaryScore:success?1:0,success};}};
    const initialWrites=store.counters().learningWrites;
    for(const kind of ['single-turn','fixed'] as const){
      const executions:Array<{question:HeraFixture['questions'][number];result:HeraExecution;ms:number}>=[];
      for(const question of fixture.questions){
        const bank=registration.scripts[question.id]?.[kind];if(!bank)throw Error('Missing registered HERA script: '+question.id+'/'+kind);
        const task:HeraTask={id:question.id,scope:store.scope,query:question.query,corpusRevision:fixture.manifest.revision,split:question.split,evaluator:evaluator.identity,goldAddress:'fixture:'+question.id};
        let active=0,release!:()=>void;const entered=new Set<string>(),both=new Promise<void>(r=>{release=r;});
        const executor=createHeraExecutor({store,masStore,segments:createHeraExampleSegments(db,masStore),profiles:state.profiles,evidence,embedder,evaluator,now,clock:()=>1000000,concurrency:4,
          clientFor:(_profile,_identity,node)=>({endpoint:{provider:'ollama'},complete:async raw=>{
            requests++;const request=raw as {responseFormat?:unknown;messages:Array<{role:string;content:unknown}>},script=bank[node.id];
            if(!script)throw Error('Unregistered node script: '+node.id);
            if(request.messages.some(m=>/"(?:gold|goldAddress|split)"\s*:/.test(JSON.stringify(m.content))))throw Error('Scoring metadata leaked into the role input.');
            const normalization=request.responseFormat!==undefined,first=script.tool&&!normalization&&!request.messages.some(m=>m.role==='tool');
            if(first){active++;maxConcurrentRetrievers=Math.max(maxConcurrentRetrievers,active);entered.add(node.id);if(entered.size===2)release();await both;active--;
              return {message:{role:'assistant',content:'',toolCalls:[{id:'tool-'+node.id,name:'hera-evidence',arguments:JSON.stringify(script.tool)}]},finishReason:'tool_calls',usage:{prompt_tokens:7,completion_tokens:3}};}
            return {message:{role:'assistant',content:JSON.stringify(normalization?script.normalization:script.completion)},finishReason:'stop',usage:{prompt_tokens:7,completion_tokens:3}};
          }})});
        const request={task,snapshot:state.snapshot,topology:kind,mode:'evaluate' as const,groupIndex:0,candidateIndex:0,configRevision:await heraRevisionOf({kind,script:registration.revision})};
        const result=heraValue(await executor.execute(request)),before=requests,replay=heraValue(await executor.execute(request));replayCalls+=requests-before;
        if(await heraRevisionOf(result)!==await heraRevisionOf(replay))throw Error('HERA replay changed its durable trajectory.');
        const run=(await masStore.getRun(result.trajectory.masRunId))!;executions.push({question,result,ms:run.budget.spent.ms});
      }
      const sum=(fn:(e:typeof executions[number])=>number)=>executions.reduce((n,e)=>n+fn(e),0),n=executions.length;
      const scored=executions.map(({question,result})=>{const score=officialScore({category:question.category,prediction:result.trajectory.answer,answer:truth.get(question.id)!});return {category:question.category,f1:score.scored?score.f1:0,answered:result.trajectory.status==='completed',split:question.split,success:Number(result.trajectory.success),citationRecall:result.trajectory.metrics.citationRecall};});
      rows.push({id:kind==='fixed'?'fixed-topology':'single-turn',kind:'ablation',status:'run',reason:null,tier:'scripted',seeds:[17753],
        identity:{snapshotId:state.snapshot.id,model:state.snapshot.identities.model,decoder:state.snapshot.identities.decoder,corpusRevision:fixture.manifest.revision,evaluatorId:evaluator.identity.id,toolIds:state.snapshot.identities.tools,
          budget:{calls:HERA_DEFAULT_LIMITS.calls,tokens:HERA_DEFAULT_LIMITS.tokens,ms:HERA_DEFAULT_LIMITS.ms,turns:HERA_DEFAULT_LIMITS.toolRounds,nodes:6,depth:6,fanOut:4,concurrency:4}},
        heldOutQuality:heraQuality(scored.filter(c=>c.split==='held-out')),quality:{f1:scored.reduce((n,c)=>n+c.f1,0)/n,successRate:sum(e=>Number(e.result.trajectory.success))/n,citationRecall:sum(e=>e.result.trajectory.metrics.citationRecall)/n,answered:scored.filter(c=>c.answered).length,planned:n,
          byCategory:SCORABLE_CATEGORIES.map(category=>{const cases=scored.filter(c=>c.category===category);return {category,f1:cases.length?cases.reduce((n,c)=>n+c.f1,0)/cases.length:0,answered:cases.filter(c=>c.answered).length,planned:cases.length};})},
        cost:{calls:sum(e=>e.result.trajectory.calls),promptTokens:sum(e=>e.result.trajectory.tokens.prompt),completionTokens:sum(e=>e.result.trajectory.tokens.completion),unknownTokenRequests:sum(e=>e.result.trajectory.tokens.unknownRequests),estimatedTokens:sum(e=>e.result.trajectory.tokens.estimated),ms:sum(e=>e.ms),unknownMsRequests:sum(e=>e.result.steps.reduce((n,s)=>n+s.usage.unknownMsRequests,0)),money:null,
          trainingCalls:sum(e=>e.question.split==='training'?e.result.trajectory.calls:0),heldOutCalls:sum(e=>e.question.split==='held-out'?e.result.trajectory.calls:0)},
        failures:{skipped:0,failed:sum(e=>Number(e.result.trajectory.status==='failed')),refusedCandidates:0,budgetStops:sum(e=>Number(e.result.trajectory.stopReason==='TMAS2009')),orphans:sum(e=>Number(e.result.trajectory.status==='orphan')),headConflicts:0,refusedLearningWrites:store.counters().refusedLearningWrites},learning:null,topology:null});
    }
    const learningWrites=store.counters().learningWrites-initialWrites;
    if(learningWrites||replayCalls||requests!==rows.reduce((n,r)=>n+r.cost!.calls,0))throw Error('HERA operational cost or learning-write census mismatch.');
    return {rows,identities,scripted:{revision:registration.revision,requests,replayCalls,maxConcurrentRetrievers},learningWrites};
  }finally{await db.close();}
}
