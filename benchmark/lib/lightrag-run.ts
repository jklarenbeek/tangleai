/** Frozen graph experiments reuse the grounding corpus, scorer and aggregate arithmetic. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalSha256} from '@jarenjs/json/canonical';
import {equalsJson} from '@jarenjs/core/object';
import {createBudgetAccount} from '@tangleai/agents';
import {EMPTY_HEAD} from '@tangleai/outcomes';
import {createHashEmbedder,type Embedder} from '@tangleai/models/embed';
import {createLightRagStore} from '@tangleai/store';
import {generateGroundedAnswer,type GroundedAnswer} from '@tangleai/documents/grounding';
import {createLightRagMeter,LightRagBudgetStop,lightRagPrompt,lightRagSchemaOf,createStructuredExtractor,createStructuredProfiler,createStructuredCoreferenceJudge,createCandidateResolver,buildContribution,projectionForContribution,planProjectionWrites,lightragMust,createKeywordPlanner,createLightRagRetriever,createLightRagEngine,LIGHTRAG_LIMITS,lightRagGenerationRevision,type LightRagChatClient,type LightRagMode,type LightRagRetrieval} from '@tangleai/lightrag';
import {collectDocumentEvidence,type DocumentEvidence} from '../../apps/desktop/src/grounding.ts';
import {loadGroundingFixture,answerSchemaRevision,scoreAnswer,type LoadedFixture,type EvidenceCorpus} from './grounding.ts';
import {buildFixtureCorpus,GROUNDING_ANSWER_PROMPT,groundingMessages,emptySums,addSums,rowBlock,comparisonOf,emptyTally,charge,replayMs,traceBlock,type Tally,type BuiltCorpus} from './grounding-run.ts';
import type {LiveQuestionResult} from './grounding.types.ts';
import {wireDescriptorOf} from './grounding-run.ts';
import {latency} from './stats.ts';
import {evidenceRecall} from './recall.ts';
import type {AiEnv} from './ai-env.ts';
import {sourceManifest} from './source-manifest.ts';
import {createLightRagValidator} from './lightrag.ts';
import type {LightragLivePlan,LightragLive,LightLiveRow,LightLiveAttempt,LightControlDrift,LightLivePairing,LightLiveDecision} from './lightrag.types.ts';
import registration from '../fixtures/lightrag/live-registration.json' with {type:'json'};
import handoffType from '../results/grounding-handoff.json' with {type:'json'};

export const LIGHTRAG_LIVE_ROWS=['flat-grounded','lightrag-low','lightrag-high','lightrag-hybrid-no-original','lightrag-hybrid'] as const;
export type LightLiveRowKey=typeof LIGHTRAG_LIVE_ROWS[number];
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export async function lightRagLiveSource(root=process.cwd()){
    const source=await sourceManifest(root,['benchmark/lightrag.ts','benchmark/lib/lightrag-run.ts','benchmark/lib/lightrag-judge.ts','benchmark/lib/lightrag-parity.ts','benchmark/fixtures/lightrag/parity-protocol.json','benchmark/lib/lightrag.ts','benchmark/lib/grounding-run.ts','benchmark/lib/grounding.ts','benchmark/lib/grounding.types.ts','benchmark/schemas/grounding.schema.json','benchmark/lib/ai-env.ts','benchmark/lib/wire-cache.ts','benchmark/lib/stats.ts','benchmark/lib/locomo-policy.ts','benchmark/lib/relevance.ts','benchmark/lib/recall.ts','benchmark/lib/source-manifest.ts','benchmark/lib/validate.ts','benchmark/lib/lightrag.types.ts','benchmark/schemas/lightrag.schema.json','benchmark/fixtures/lightrag/live-registration.json','scripts/lightrag-report-schema.ts','apps/desktop/src/settings.ts','apps/desktop/src/grounding.ts'],['packages/lightrag','packages/documents','packages/models','packages/store']);
    return {files:source.files,sha256:await canonicalSha256({files:source.files})};
}
async function loadHandoff(root:string){return JSON.parse(await readFile(join(root,'benchmark/results/grounding-handoff.json'),'utf8')) as typeof handoffType;}
export interface LightLiveContext {plan:LightragLivePlan;loaded:LoadedFixture;handoff:typeof handoffType;root:string;}
/** Counts are scheduled calls plus explicit worst-case allowances, never guessed model output sizes. */
export async function planLightRagLive(options:{env:AiEnv;rows?:readonly LightLiveRowKey[];cache?:string;fresh?:boolean;root?:string}):Promise<LightLiveContext>{
    const root=options.root??process.cwd(),loaded=await loadGroundingFixture(root),handoff=await loadHandoff(root),flat=handoff.handoff.flatRow;
    const rows=LIGHTRAG_LIVE_ROWS.filter(row=>(options.rows??LIGHTRAG_LIVE_ROWS).includes(row));
    if(!rows.length||options.rows&&new Set(options.rows).size!==options.rows.length||options.rows?.some(row=>!LIGHTRAG_LIVE_ROWS.includes(row)))throw Error('Choose distinct registered live rows.');
    if(loaded.fixtureId!==handoff.handoff.identities.fixtureId||!equalsJson(loaded.fixture.questions.map(q=>q.key),flat.questionIds)||await answerSchemaRevision()!==flat.answerSchemaRevision||await canonicalSha256({prompt:GROUNDING_ANSWER_PROMPT})!==flat.promptRevision)throw Error('The immutable flat handoff, question set or answer owner differs.');
    const wire=wireDescriptorOf(options.env,'default'),probe=await buildFixtureCorpus(loaded.fixture,{...createHashEmbedder({dims:registration.dims}),model:registration.embedModel},root);
    let activeChunks=0,activeSources=0,profileBound=0,graphEmbeddings=0;
    try{for(const source of await probe.store.listSources())if(source.activeVersionId){const chunks=await probe.store.listChunks(source.activeVersionId);activeChunks+=chunks.length;activeSources++;
        const shape=lightRagSchemaOf('graphExtractionReply') as unknown as {properties:{entities:{maxItems:number};relations:{maxItems:number}}},passes=1+registration.gleaning;
        profileBound+=activeChunks*passes*(shape.properties.entities.maxItems+shape.properties.relations.maxItems);
        graphEmbeddings+=Math.ceil(chunks.length*passes*shape.properties.entities.maxItems/registration.embeddingBatchSize)+Math.ceil(chunks.length*passes*shape.properties.relations.maxItems/registration.embeddingBatchSize);
    }}finally{await probe.close();}
    const graph=rows.some(row=>row!=='flat-grounded'),extraction=graph?activeChunks*(1+registration.gleaning):0,profilingUpperBound=graph?profileBound:0,coreferenceUpperBound=graph?activeSources*registration.coreferenceDecisionsPerSource:0;
    const index={documentEmbeddingCalls:probe.census.embeddingCalls,extraction,extractionRepairAllowance:extraction*registration.maxRepairs,profilingUpperBound,profilingRepairAllowance:profilingUpperBound*registration.maxRepairs,coreferenceUpperBound,coreferenceRepairAllowance:coreferenceUpperBound*registration.maxRepairs,graphEmbeddingUpperBound:graph?graphEmbeddings:0};
    const indexing={...index,maxCalls:Object.values(index).reduce((n,value)=>n+value,0)},n=flat.questionIds.length;
    const rowCalls=rows.map(key=>{const planning=key==='flat-grounded'?0:n,answers=n,queryEmbeddingUpperBound=(key==='flat-grounded'||key==='lightrag-low'||key==='lightrag-high'?1:2)*n,repairAllowance=(planning+answers)*registration.maxRepairs;return {key,planning,answers,queryEmbeddingUpperBound,repairAllowance,maxCalls:planning+answers+queryEmbeddingUpperBound+repairAllowance};});
    const maxRequests=indexing.maxCalls+rowCalls.reduce((sum,row)=>sum+row.maxCalls,0),refusals:string[]=[];
    if(!options.env.live)refusals.push(options.env.reason??'The provider is not configured.');
    if(options.env.model!==registration.model||options.env.embedModel!==registration.embedModel)refusals.push('The paired tier requires the handoff model and embedding model.');
    if(maxRequests>options.env.maxCalls)refusals.push(`The conservative ${maxRequests}-request bound exceeds TANGLE_AI_MAX_CALLS=${options.env.maxCalls}; model-dependent profiling and review allowances cannot be silently discarded.`);
    const prompts={extraction:lightRagPrompt('graph-extractor').revision,profiling:lightRagPrompt('graph-profiler').revision,deduplication:lightRagPrompt('graph-deduplicator').revision,planning:lightRagPrompt('graph-planner').revision,generation:await lightRagGenerationRevision(),flat:flat.promptRevision};
    const body={document:'lightrag-live-plan' as const,registration,registrationId:await canonicalSha256(registration),fixtureId:loaded.fixtureId,handoffSha256:digest(await readFile(join(root,'benchmark/results/grounding-handoff.json'))),source:await lightRagLiveSource(root),questionIds:flat.questionIds,rows,prompts,
        wire:{provider:wire.provider,base:wire.base,model:wire.model||'(unset)',embedModel:wire.embedModel??'(unset)',dims:registration.dims,thinking:'default' as const},maxCalls:options.env.maxCalls,fresh:options.fresh??false,cache:options.cache??'benchmark/cache/wire.sqlite',corpus:{chunks:probe.census.chunks,activeChunks,activeSources,documentEmbeddingCalls:probe.census.embeddingCalls},indexing,rowCalls,maxRequests,runnable:refusals.length===0,refusals};
    const plan={...body,planId:await canonicalSha256(body)} as LightragLivePlan;await validateLightRagLivePlan(plan);return {plan,loaded,handoff,root};
}
function checkShape(value:unknown){const result=createLightRagValidator()(value);if(!result.valid){const document=(value as {document?:string}).document,matching=result.errors?.filter(error=>JSON.stringify(error).includes('/'+String(document).replaceAll(/-([a-z])/g,(_,s:string)=>s.toUpperCase())));throw Error('Invalid '+document+': '+JSON.stringify(matching?.length?matching:result.errors?.slice(-8)));}}
export async function validateLightRagLivePlan(plan:LightragLivePlan){checkShape(plan);const {planId,...body}=plan;if(await canonicalSha256(body)!==planId||await canonicalSha256(plan.registration)!==plan.registrationId)throw Error('The live plan content identity differs.');}
export function lightRagAuthorization(plan:LightragLivePlan,authorize?:string):'dry-run'|'refused'|'execute'{if(authorize===undefined)return 'dry-run';return authorize===plan.planId&&plan.runnable?'execute':'refused';}
export function describeLightRagPlan(context:LightLiveContext){return JSON.stringify(context.plan,null,2)+'\n';}
const emptyPairing=():LightLivePairing=>({eligible:false,reasons:['Both complete paired rows have not run.'],comparisons:[],costTokenDelta:null,p95DeltaMs:null});
export async function lightRagNotRun(context:LightLiveContext,reason='No matching explicit live authorization was supplied.'):Promise<LightragLive>{
    const body={document:'lightrag-live' as const,status:'not-run' as const,tier:'not-run' as const,reason,plan:context.plan,rows:[],indexing:{calls:0,tokens:0,ms:0,completedSources:0,failedSources:0,physicalRequests:0},physicalRequests:0,logicalSpend:{calls:0,tokens:0,ms:0},controlDrift:null,pairing:emptyPairing(),decision:{state:'not-evaluated' as const,defaultChanged:false as const,clauses:[]}};
    const report={...body,reportId:await canonicalSha256(body)};await validateLightRagLive(report);return report;
}
/** A retry is another physical request and reserves its place before the injected wire starts. */
export function createLightRagFetchGuard(maxCalls:number,inner:typeof fetch=globalThis.fetch){
    if(!Number.isSafeInteger(maxCalls)||maxCalls<1)throw Error('A physical request ceiling must be positive.');let requests=0;
    return {requests:()=>requests,fetch:((...args:Parameters<typeof fetch>)=>{if(requests>=maxCalls)throw new LightRagBudgetStop('physical-requests');requests++;return inner(...args);}) as typeof fetch};
}
function plusTally(a:Tally,b:Tally):Tally{return Object.fromEntries(Object.keys(a).map(key=>[key,a[key as keyof Tally]+b[key as keyof Tally]])) as unknown as Tally;}
function deltaTally(after:Tally,before:Tally):Tally{return Object.fromEntries(Object.keys(after).map(key=>[key,after[key as keyof Tally]-before[key as keyof Tally]])) as unknown as Tally;}
function resultOf(attempt:LightLiveAttempt):LiveQuestionResult{const {questionId,cost:_,retrievalCost:__,elapsedMs:___,completionLatencies:____,physicalRequests:_____,...result}=attempt;return {id:questionId,...result};}
export function lightRagObservedTier(tier:'scripted'|'paid',physical:number,logical:number):LightLiveRow['tier']{return tier==='scripted'?'scripted':physical===0?'replayed':physical<logical?'mixed':'paid';}
function scoreObservedAttempt(question:LoadedFixture['fixture']['questions'][number],fixture:LoadedFixture['fixture'],corpus:EvidenceCorpus,answer:GroundedAnswer|null,trace:LiveQuestionResult['trace']){
    const expected=fixture.claims.filter(claim=>claim.question===question.key),scored=scoreAnswer(question,expected,answer??{disposition:'abstain',reason:'No valid generated answer.',claims:[]},corpus,{retrieved:trace?.retrieved??[],supplied:trace?.supplied??[]},fixture.cutoff);
    if(!answer){scored.abstention.correct=false;scored.abstention.given=false;scored.answerF1=question.reference===null?null:0;}
    const gold=new Set(expected.flatMap(claim=>claim.support)),recall=(ids:readonly string[])=>gold.size?evidenceRecall([...gold],new Set(ids.flatMap(id=>[...(corpus.chunk(id)?.elements??[])]))):null;
    return {rendered:answer?scored.rendered:null,citations:scored.citations,citationCounts:scored.citationCounts,claims:scored.claims,abstention:scored.abstention,answerF1:scored.answerF1,retrievedRecall:recall(trace?.retrieved??[]),suppliedRecall:recall(trace?.supplied??[]),citedRecall:recall(scored.citations.filter(row=>row.outcome==='supporting').map(row=>row.citation))};
}
/** The existing grounding row owner computes all claim, citation and abstention aggregates. */
export async function summarizeLightLiveRow(key:LightLiveRowKey,attempts:LightLiveAttempt[],executionTier:'scripted'|'paid'='scripted'):Promise<LightLiveRow>{
    const results=attempts.map(resultOf),sums=emptySums();for(const result of results)addSums(sums,result);
    const cost=attempts.reduce((sum,row)=>plusTally(sum,row.cost),emptyTally()),retrievalCost=attempts.reduce((sum,row)=>plusTally(sum,row.retrievalCost),emptyTally());
    const aggregate=rowBlock('grounded-answer',true,await canonicalSha256(results.map(row=>row.id).sort()),results,sums,true,true,cost,attempts.flatMap(row=>row.completionLatencies));
    const {key:_,questions:{results:__,...questions},...rest}=aggregate;
    const totalCost=plusTally(cost,retrievalCost),tier=lightRagObservedTier(executionTier,attempts.reduce((n,row)=>n+row.physicalRequests,0),totalCost.turns);
    return {key,tier,attempts,summary:{...rest,questions},totalCost,retrievalCost,latency:latency(attempts.map(row=>row.elapsedMs))};
}
export function controlDriftOf(row:LightLiveRow,handoff:typeof handoffType):LightControlDrift{
    const expected=handoff.handoff.rows.find(row=>row.key==='grounded-answer')!,{questions,...summary}=row.summary;
    const actual={...summary,planned:questions.planned,answered:questions.answered,invalid:questions.invalid,unanswered:questions.unanswered},fields:LightControlDrift['fields']=[];
    function walk(before:unknown,after:unknown,path:string){
        if(before!==null&&typeof before==='object'){for(const [key,value]of Object.entries(before))if(key!=='key')walk(value,after&&typeof after==='object'?(after as Record<string,unknown>)[key]:null,path+'/'+key);return;}
        const left=before as string|number|boolean|null,right=after===undefined?null:after as string|number|boolean|null;fields.push({path,expected:left,actual:right,changed:!equalsJson(left,right)});
    }
    walk(expected,actual,'');return {reportId:handoff.handoff.identities.reportId,fields,changed:fields.filter(field=>field.changed).length};
}
export function pairLightRagRows(rows:readonly LightLiveRow[]):LightLivePairing{
    const control=rows.find(row=>row.key==='flat-grounded'),treatment=rows.find(row=>row.key==='lightrag-hybrid');if(!control||!treatment)return emptyPairing();
    const reasons:string[]=[];
    if(!equalsJson(control.attempts.map(row=>row.questionId),treatment.attempts.map(row=>row.questionId)))reasons.push('The paired question ids or order differ.');
    if([...control.attempts,...treatment.attempts].some(row=>row.status!=='answered'))reasons.push('Every failed, invalid or unattempted answer remains a counted failure; this pair is incomplete.');
    const comparisons:LightLivePairing['comparisons']=[];
    if(!reasons.length)for(const metric of ['supported-claim-f1','answer-f1'] as const){
        const deltas=treatment.attempts.flatMap((row,index)=>{const left=metric==='answer-f1'?row.answerF1:row.claims?.f1,right=metric==='answer-f1'?control.attempts[index].answerF1:control.attempts[index].claims?.f1;return left==null||right==null?[]:[left-right];});
        if(deltas.length){const comparison=comparisonOf(metric,deltas);comparisons.push({...comparison,treatment:'lightrag-hybrid',control:'flat-grounded'});}
    }
    return {eligible:reasons.length===0,reasons,comparisons,costTokenDelta:treatment.totalCost.tokens-control.totalCost.tokens,p95DeltaMs:treatment.latency.p95Ms===null||control.latency.p95Ms===null?null:treatment.latency.p95Ms-control.latency.p95Ms};
}
export function decideLightRagLive(report:Pick<LightragLive,'status'|'tier'|'rows'|'indexing'|'pairing'>):LightLiveDecision{
    if(report.status==='not-run')return {state:'not-evaluated',defaultChanged:false,clauses:[]};
    const control=report.rows.find(row=>row.key==='flat-grounded'),hybrid=report.rows.find(row=>row.key==='lightrag-hybrid'),primary=report.pairing.comparisons.find(row=>row.metric==='supported-claim-f1');
    const cost=!!control&&!!hybrid&&(hybrid.totalCost.tokens+report.indexing.tokens)<=control.totalCost.tokens*registration.maxTotalTokenRatio;
    const p95=control?.latency.p95Ms!=null&&hybrid?.latency.p95Ms!=null&&hybrid.latency.p95Ms<=control.latency.p95Ms*registration.maxP95Ratio;
    const clauses=[
        {clause:'complete-pair',passed:report.pairing.eligible&&report.indexing.failedSources===0,detail:'Every registered paired question completes without an indexing or answer failure.'},
        {clause:'paid-generation',passed:(report.tier==='paid'||report.tier==='mixed')&&!!control&&!!hybrid&&[...control.attempts,...hybrid.attempts].every(row=>row.replayed===0&&row.physicalRequests>0),detail:'Scripted and replayed answers cannot establish fresh paid answer quality.'},
        {clause:'primary-interval',passed:primary!==undefined&&primary.interval.low>0,detail:'The registered two-sided 95% supported-claim F1 interval must exclude zero in favour of hybrid.'},
        {clause:'citation-outcomes',passed:!!hybrid&&hybrid.attempts.every(row=>row.citations.every(citation=>citation.outcome==='supporting'||citation.outcome==='resolved-not-supporting')),detail:'Every answer citation resolves to supplied, active evidence within the cutoff.'},
        {clause:'total-token-cost',passed:cost,detail:'Hybrid query and answer tokens plus all corpus indexing tokens must not exceed the flat query and answer token total.'},
        {clause:'p95',passed:p95,detail:'Hybrid end-to-end question p95 must not exceed the regenerated flat control p95.'},
    ];return {state:clauses.every(row=>row.passed)?'eligible-for-default-review':'keep-experimental',defaultChanged:false,clauses};
}
export async function validateLightRagLive(report:LightragLive,root=process.cwd()){
    checkShape(report);await validateLightRagLivePlan(report.plan);const {reportId,...body}=report;if(await canonicalSha256(body)!==reportId)throw Error('The live report identity differs.');
    if(!equalsJson(report.pairing,report.status==='not-run'?emptyPairing():pairLightRagRows(report.rows))||!equalsJson(report.decision,decideLightRagLive(report)))throw Error('The live pairing or default decision differs from its observed attempts.');
    const loaded=report.status==='executed'?await loadGroundingFixture(root):null,built=loaded?await buildFixtureCorpus(loaded.fixture,{...createHashEmbedder({dims:report.plan.wire.dims}),model:report.plan.wire.embedModel},root):null;
    try{for(const row of report.rows){
        if(!equalsJson(row.attempts.map(attempt=>attempt.questionId),report.plan.questionIds))throw Error('The live row dropped or reordered a registered question.');
        const rebuilt=await summarizeLightLiveRow(row.key,row.attempts,report.tier==='scripted'?'scripted':'paid');
        if(!equalsJson(row,rebuilt))throw Error('A live row aggregate differs from its retained attempts.');
        for(const attempt of row.attempts){const question=loaded!.fixture.questions.find(row=>row.key===attempt.questionId);if(!question)throw Error('Unknown live question.');
            if((attempt.status==='answered')!==(attempt.answer!==null))throw Error('A failed live attempt cannot carry a successful answer.');
            const expected=scoreObservedAttempt(question,loaded!.fixture,built!.corpus,attempt.answer as GroundedAnswer|null,attempt.trace);
            for(const [key,value]of Object.entries(expected))if(!equalsJson(value,attempt[key as keyof LightLiveAttempt]))throw Error('The shared grounding scorer rejects a forged live '+key+'.');
        }
    }}finally{await built?.close();}
    if(loaded&&loaded.fixtureId!==report.plan.fixtureId)throw Error('The live fixture identity differs.');
    const flat=report.rows.find(row=>row.key==='flat-grounded'),drift=flat?controlDriftOf(flat,await loadHandoff(root)):null;
    if(!equalsJson(drift,report.controlDrift))throw Error('The flat control drift differs from the immutable handoff.');
    if(report.logicalSpend.calls!==report.indexing.calls+report.rows.reduce((n,row)=>n+row.totalCost.turns,0)||report.logicalSpend.tokens!==report.indexing.tokens+report.rows.reduce((n,row)=>n+row.totalCost.tokens,0))throw Error('The live total spend differs from indexing and question attempts.');
    if(report.physicalRequests!==report.indexing.physicalRequests+report.rows.reduce((n,row)=>n+row.attempts.reduce((m,attempt)=>m+attempt.physicalRequests,0),0)||report.status==='executed'&&report.tier!==lightRagObservedTier(report.tier==='scripted'?'scripted':'paid',report.physicalRequests,report.logicalSpend.calls))throw Error('The live physical request counts or replay labels differ.');
    return report;
}
export interface ExecuteLightRagOptions {authorize:string;env:AiEnv;client:LightRagChatClient;embedder:Embedder;tier:'scripted'|'paid';physicalRequests:()=>number;timer?:()=>number;now?:()=>string;}
export async function executeLightRagLive(context:LightLiveContext,options:ExecuteLightRagOptions):Promise<LightragLive>{
    const {plan,loaded,root}=context;await validateLightRagLivePlan(plan);
    if(lightRagAuthorization(plan,options.authorize)!=='execute')throw Error('Live authorization is absent, mismatched or over the request ceiling; zero requests.');
    const current=await planLightRagLive({env:options.env,rows:plan.rows,cache:plan.cache,fresh:plan.fresh,root});
    if(current.plan.planId!==plan.planId||options.client.endpoint.provider!==plan.wire.provider||options.client.endpoint.model!==plan.wire.model||options.embedder.model!==plan.wire.embedModel||options.embedder.dims!==undefined&&options.embedder.dims!==plan.wire.dims)throw Error('The frozen plan, wire or source changed before execution; zero requests.');
    const timer=options.timer??(()=>performance.now()),now=options.now??(()=>new Date().toISOString()),account=createBudgetAccount({turns:plan.maxCalls,tokens:Number.MAX_SAFE_INTEGER},timer),wireMeter=createLightRagMeter(account,timer),graphBudget=createBudgetAccount({turns:plan.maxCalls,tokens:Number.MAX_SAFE_INTEGER},timer);
    let stage:'index'|'retrieval'|'generation'='index';const tallies={index:emptyTally(),retrieval:emptyTally(),generation:emptyTally()},completionLatencies:number[]=[];
    const client:LightRagChatClient={endpoint:options.client.endpoint,complete:async request=>{
        const at=timer(),before=wireMeter.spent();let result:Awaited<ReturnType<LightRagChatClient['complete']>>|undefined;
        try{result=await wireMeter.run(()=>options.client.complete(request),JSON.stringify(request.messages),reply=>({usage:reply.usage,text:reply.message?.content??''}));return result;}
        finally{const after=wireMeter.spent();if(after.calls>before.calls)charge([tallies[stage]],stage==='generation'?completionLatencies:[],{...result?.usage,total_tokens:after.tokens-before.tokens},replayMs(result)??timer()-at,replayMs(result)!==null);}
    }};
    const embedder:Embedder={model:plan.wire.embedModel,dims:plan.wire.dims,embed:async(texts,settings)=>{
        const before=wireMeter.spent();try{const result=await wireMeter.run(()=>options.embedder.embed(texts,settings),JSON.stringify(texts));
            if(result.some(vector=>vector.length!==plan.wire.dims))throw Error('The observed embedding width differs from the handoff.');return result;
        }finally{const after=wireMeter.spent();tallies[stage].turns+=after.calls-before.calls;tallies[stage].tokens+=after.tokens-before.tokens;tallies[stage].ms+=after.ms-before.ms;}
    }};
    let built:BuiltCorpus|null=null,completedSources=0,failedSources=0,indexFailed=false;const rows:LightLiveRow[]=[];
    try{
        try{built=await buildFixtureCorpus(loaded.fixture,embedder,root);}catch{indexFailed=true;failedSources++;}
        const graph=built?createLightRagStore(built.db):null;
        if(built&&graph&&plan.rows.some(row=>row!=='flat-grounded')){
            const common={client,budget:graphBudget,clock:timer,maxRepairs:1 as const},extractor=createStructuredExtractor({...common,artifact:lightRagPrompt('graph-extractor'),now}),profiler=createStructuredProfiler({...common,artifact:lightRagPrompt('graph-profiler')}),judge=createStructuredCoreferenceJudge({...common,artifact:lightRagPrompt('graph-deduplicator')});
            for(const source of await built.store.listSources())if(source.activeVersionId){try{
                const version=(await built.store.getVersion(source.activeVersionId))!,chunks=await built.store.listChunks(version.id),resolver=createCandidateResolver({lookup:request=>graph.readContributionSnapshot(request),judge,maxDecisions:registration.coreferenceDecisionsPerSource});
                const contribution=lightragMust(await buildContribution({chunks,sourceId:source.id,versionId:version.id,extractor,profiler,resolver,embedder,budget:graphBudget,clock:timer,extraction:{gleaning:registration.gleaning},batchSize:registration.embeddingBatchSize,
                    identities:{extraction:'structured-graph/1',chunker:{version:version.chunkerVersion,config:version.chunkerConfig},embedder:version.embeddedBy,prompts:{extraction:extractor.promptRevision,profiling:profiler.promptRevision,deduplication:judge.promptRevision},model:{...client.endpoint}}}));
                if(contribution.partial)throw Error('Partial extraction cannot fill a complete live row.');
                const projection=lightragMust(await projectionForContribution(contribution)),writes=lightragMust(await planProjectionWrites({projection,contribution:contribution.plan,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:now()}));lightragMust(await graph.apply(writes));completedSources++;
            }catch{indexFailed=true;failedSources++;}}
        }
        const indexSpend=wireMeter.spent(),indexPhysicalRequests=options.physicalRequests();
        for(const key of plan.rows){const attempts:LightLiveAttempt[]=[];
            for(const question of loaded.fixture.questions){
                const started=timer(),beforeGen={...tallies.generation},beforeRead={...tallies.retrieval},beforeLatency=completionLatencies.length,beforePhysical=options.physicalRequests();let answer:GroundedAnswer|null=null,status:LiveQuestionResult['status']='wire-failure',flat:DocumentEvidence|null=null,retrieval:LightRagRetrieval|null=null;
                try{
                    if(!built||key!=='flat-grounded'&&indexFailed)throw Error('Corpus indexing did not complete.');
                    stage='retrieval';
                    if(key==='flat-grounded'){
                        const [vector]=await embedder.embed([question.text]),outcome=await collectDocumentEvidence(built.store,vector,{model:embedder.model,dims:plan.wire.dims},context.handoff.handoff.flatRow.retrieval);
                        if(!outcome.ok)throw Error(outcome.error.code);flat=outcome.evidence;
                        if(flat.estimatedTokens>registration.contextTokens)throw Error('The frozen flat serializer exceeds the common context token budget.');
                        stage='generation';const generated=await generateGroundedAnswer(client,groundingMessages(question.text,flat.context),new Set(flat.suppliedChunkIds));answer=generated.answer;status=answer?'answered':generated.failure?.kind==='invalid'?'invalid':'wire-failure';
                    }else{
                        const planner=createKeywordPlanner({client,budget:graphBudget,clock:timer,artifact:lightRagPrompt('graph-planner')}),native=createLightRagRetriever({store:graph!,documents:built.store,planner});
                        const retrieve:typeof native=async(q,request)=>{stage='retrieval';try{const result=await native(q,request);if(result.valid)retrieval=result.value;return result;}finally{stage='generation';}};
                        const engine=createLightRagEngine({retrieve,client,budget:graphBudget,embedder,clock:timer,now,identities:{prompts:{planning:planner.promptRevision,generation:await lightRagGenerationRevision()},embedder:{model:embedder.model,dims:plan.wire.dims},runIdentityId:null}});
                        const result=await engine.answer(question.text,{mode:key.slice('lightrag-'.length) as LightRagMode,limits:LIGHTRAG_LIMITS});
                        if(result.valid){const value=result.value.answer;if(value.disposition==='answer'||value.disposition==='abstain'){answer=value as GroundedAnswer;status='answered';}else status=value.disposition==='invalid'||value.disposition==='empty-model'?'invalid':value.disposition==='budget-stop'?'budget-stop':'wire-failure';}
                        else status=result.issues.some(issue=>issue.code==='TLRAG1005')?'budget-stop':'wire-failure';
                    }
                }catch(cause){status=cause instanceof LightRagBudgetStop?'budget-stop':'wire-failure';}
                if(!answer&&account.stop()!==null)status='budget-stop';
                const observed=retrieval as LightRagRetrieval|null,trace=flat?traceBlock(flat):observed?{retrieved:observed.citations.map(row=>row.chunkId),supplied:observed.bundle.suppliedChunkIds,blocks:observed.citations.length,uniqueSupplied:observed.bundle.suppliedChunkIds.length,duplicateExpansions:0,characters:observed.bundle.text.length,estimatedTokens:observed.bundle.tokenCount}:null;
                const scored=scoreObservedAttempt(question,loaded.fixture,built?.corpus??{chunk:()=>undefined},answer,trace);
                const cost=deltaTally(tallies.generation,beforeGen),retrievalCost=deltaTally(tallies.retrieval,beforeRead);
                attempts.push({questionId:question.key,category:null,status,trace,answer,...scored,tokens:cost.tokens,ms:cost.ms,replayed:cost.replayed,attempts:cost.turns,cost,retrievalCost,elapsedMs:timer()-started,completionLatencies:completionLatencies.slice(beforeLatency),physicalRequests:options.physicalRequests()-beforePhysical});
            }
            rows.push(await summarizeLightLiveRow(key,attempts,options.tier));
        }
        const physicalRequests=options.physicalRequests(),tier=lightRagObservedTier(options.tier,physicalRequests,wireMeter.spent().calls),pairing=pairLightRagRows(rows),indexing={...indexSpend,completedSources,failedSources,physicalRequests:indexPhysicalRequests};
        const flat=rows.find(row=>row.key==='flat-grounded'),body={document:'lightrag-live' as const,status:'executed' as const,tier,reason:null,plan,rows,indexing,physicalRequests,logicalSpend:wireMeter.spent(),controlDrift:flat?controlDriftOf(flat,context.handoff):null,pairing,decision:decideLightRagLive({status:'executed',tier,rows,indexing,pairing})};
        if((await lightRagLiveSource(root)).sha256!==plan.source.sha256)throw Error('Graph experiment source changed during execution.');
        return validateLightRagLive({...body,reportId:await canonicalSha256(body)},root);
    }finally{await built?.close();}
}
