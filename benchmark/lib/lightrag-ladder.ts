/** Registered SQLite scale observations; clocks stay outside deterministic scores. */
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir,cpus,totalmem,loadavg} from 'node:os';
import {getHeapStatistics} from 'node:v8';
import {join} from 'node:path';
import {nodeDriver} from '@jarenjs/db/node';
import {canonicalSha256} from '@jarenjs/json/canonical';
import {createBudgetAccount} from '@tangleai/agents';
import {type DocumentCorpusStore} from '@tangleai/documents';
import {openTangleDb} from '@tangleai/store';
import {createScriptedPlanner,retrieveLightRag,lightragMust,type LightRagStore} from '@tangleai/lightrag';
import {loadLightRagFixture,createLightRagValidator,type LoadedLightRagFixture} from './lightrag.ts';
import {createLightRagLadderCorpus} from './lightrag-ladder-corpus.ts';
import {sourceManifest} from './source-manifest.ts';
import {latency} from './stats.ts';
import {describeErrors} from './validate.ts';
import type {LightragLadder,LightragLadderRegistration,LadderRow,LadderMachine,LadderSample} from './lightrag.types.ts';
import registered from '../fixtures/lightrag/ladder-registration.json' with {type:'json'};

export const LIGHTRAG_LADDER_REGISTRATION=registered as LightragLadderRegistration;
const now=()=>new Date().toISOString();
export async function lightRagLadderSource(root=process.cwd()){
    const result=await sourceManifest(root,['benchmark/lib/lightrag-ladder.ts','benchmark/lib/lightrag-ladder-corpus.ts','benchmark/lightrag-ladder.ts','benchmark/fixtures/lightrag/ladder-registration.json',
        'benchmark/fixtures/lightrag/manifest.json','benchmark/lib/lightrag.ts','benchmark/lib/lightrag-corpus.ts','benchmark/lib/stats.ts','benchmark/lib/source-manifest.ts','benchmark/lib/validate.ts','benchmark/lib/lightrag.types.ts','benchmark/schemas/lightrag.schema.json',
        'packages/store/src/document-store.ts','packages/store/src/document-state.ts','packages/store/src/corpus-promotion.ts','packages/store/src/lightrag-store.ts','packages/store/src/lightrag-model.ts',
        'packages/documents/src/ingest.ts','packages/documents/src/chunking.ts','packages/documents/src/retrieval.ts','packages/documents/src/contracts.ts','packages/models/src/embed.ts','packages/core/src/tokens.ts','packages/agents/src/recursive.ts','packages/context/src/ledger.ts','packages/outcomes/src/transitions.ts','packages/outcomes/src/errors.ts'],['packages/lightrag']);
    return {files:result.files,sha256:await canonicalSha256({files:result.files})};
}
export function lightRagBackendDecision(rows:readonly Pick<LadderRow,'chunks'|'retrieval'>[]):LightragLadder['backendDecision']{
    if(JSON.stringify(rows.map(row=>row.chunks))!==JSON.stringify(registered.sizes))return null;
    return rows.at(-1)!.retrieval.p95Ms<=registered.maxP95Ms?'sqlite-sufficient':'scale-row-registered';
}
export async function validateLightRagLadder(input:unknown):Promise<LightragLadder>{
    const checked=createLightRagValidator()(input);if(!checked.valid)throw Error('Invalid graph scale receipt: '+describeErrors(checked,6).join('; '));
    const receipt=input as LightragLadder;if(receipt.document!=='lightrag-ladder')throw Error('Expected a graph scale receipt.');
    const {receiptId,...body}=receipt;
    if(await canonicalSha256(body)!==receiptId||await canonicalSha256(receipt.registration)!==receipt.registrationId)throw Error('Graph scale receipt or registration identity differs.');
    if(receipt.backendDecision!==lightRagBackendDecision(receipt.rows))throw Error('The registered graph scale decision differs.');
    return receipt;
}
export async function readLightRagLadder(path:string,root=process.cwd()):Promise<LightragLadder>{
    const receipt=await validateLightRagLadder(JSON.parse(await readFile(path,'utf8')));
    if(receipt.source.sha256!==(await lightRagLadderSource(root)).sha256)throw Error('Graph scale receipt source is stale; measure the current implementation.');
    return receipt;
}
function observedStores(graph:LightRagStore,documents:DocumentCorpusStore){
    const counts={graph:0,documents:0};
    const graphRead:LightRagStore={...graph,
        listEntities:async filter=>{const rows=await graph.listEntities(filter);counts.graph+=rows.length;return rows;},
        listRelations:async filter=>{const rows=await graph.listRelations(filter);counts.graph+=rows.length;return rows;},
        listProjections:async filter=>{const rows=await graph.listProjections(filter);counts.graph+=rows.length;return rows;}};
    const documentRead:DocumentCorpusStore={...documents,
        getSource:async id=>{const row=await documents.getSource(id);counts.documents+=row?1:0;return row;},
        getVersion:async id=>{const row=await documents.getVersion(id);counts.documents+=row?1:0;return row;},
        listChunks:async id=>{const rows=await documents.listChunks(id);counts.documents+=rows.length;return rows;}};
    return {graph:graphRead,documents:documentRead,counts,reset:()=>{counts.graph=0;counts.documents=0;}};
}
async function measureSize(loaded:LoadedLightRagFixture,size:number,timer:()=>number,onProgress:(line:string)=>void):Promise<LadderRow>{
    const directory=await mkdtemp(join(tmpdir(),'tangle-graph-ladder-')),db=await openTangleDb({path:join(directory,'graph.db'),driver:nodeDriver()});
    try{
        const {documents,graph,embedder,prepared,document,corpus,canonicals,claims,indexing,indexingMs,promotionMs}=await createLightRagLadderCorpus(loaded,size,db,timer);
        const observed=observedStores(graph,documents),planner=createScriptedPlanner(loaded.fixture.questions),samples:LadderSample[]=[],skipped={identity:0,width:0,unresolvable:0},evidence=new Set(document.bundle.chunks.map(row=>row.id));
        async function query(question:LoadedLightRagFixture['fixture']['questions'][number],record:boolean){
            const plan=lightragMust(await planner(question.text,{mode:'hybrid',limits:registered.limits}));observed.reset();const start=timer();
            const value=lightragMust(await retrieveLightRag({store:observed.graph,documents:observed.documents,embedder,plan,budget:createBudgetAccount({turns:4,tokens:16000},()=>0),clock:timer})),ms=timer()-start;
            if(!Number.isFinite(ms)||ms<0)throw Error('Scale clock must be monotonic.');
            if(value.citations.some(row=>!evidence.has(row.chunkId)))throw Error('The scale retrieval supplied an unresolved citation.');
            if(record){for(const key of Object.keys(skipped)as Array<keyof typeof skipped>)skipped[key]+=value.skipped[key];
                samples.push({questionId:question.id,ms,graphRows:observed.counts.graph,documentRows:observed.counts.documents,skipped:Object.values(value.skipped).reduce((sum,n)=>sum+n,0),citations:value.citations.length,localCalls:value.spend.calls,budgetTokens:value.spend.tokens});}
        }
        await query(loaded.fixture.questions[0],false);for(const question of loaded.fixture.questions)await query(question,true);
        const measured=latency(samples.map(row=>row.ms)),supplied=samples.reduce((n,row)=>n+row.citations,0);
        const row:LadderRow={chunks:size,...canonicals,claims,extractedChunks:indexing.extracted,profiledCanonicals:indexing.profiled,reviewCalls:indexing.reviewed,providerCalls:0,
            queryLocalCalls:samples.reduce((n,row)=>n+row.localCalls,0),queryBudgetTokens:samples.reduce((n,row)=>n+row.budgetTokens,0),embeddingCalls:indexing.embeddingCalls,embeddingTexts:indexing.embeddingTexts,budgetTokens:prepared.contribution.spend.tokens,indexingMs,promotionMs,
            peakRssBytes:process.resourceUsage().maxRSS*1024,corpusSha256:await canonicalSha256(corpus),rowsRead:{graph:samples.reduce((n,row)=>n+row.graphRows,0),documents:samples.reduce((n,row)=>n+row.documentRows,0)},skipped,
            citationResolution:{supplied,resolved:supplied,ratio:1},retrieval:{p50Ms:measured.medianMs!,p95Ms:measured.p95Ms!,samples}};
        onProgress(`SQLite graph ${size} chunks: hybrid p50 ${row.retrieval.p50Ms.toFixed(2)} ms, p95 ${row.retrieval.p95Ms.toFixed(2)} ms.`);return row;
    }finally{await db.close();await rm(directory,{recursive:true,force:true});}
}
export async function measureLightRagLadder(options:{root?:string;sizes?:readonly number[];timer?:()=>number;now?:()=>string;identity?:LadderMachine;onProgress?:(line:string)=>void}={}):Promise<LightragLadder>{
    const root=options.root??process.cwd(),sizes=[...(options.sizes??registered.sizes)];
    if(!sizes.length||sizes.some((n,index)=>!Number.isSafeInteger(n)||n<1||n>10000||index>0&&n<=sizes[index-1]))throw new TypeError('Scale sizes must increase within 1..10000.');
    const loaded=await loadLightRagFixture(root),source=await lightRagLadderSource(root),rows:LadderRow[]=[];
    if(loaded.fixture.questions.length!==registered.questions)throw Error('The registered scale question count changed.');
    for(const size of sizes)rows.push(await measureSize(loaded,size,options.timer??(()=>performance.now()),options.onProgress??(()=>{})));
    if((await lightRagLadderSource(root)).sha256!==source.sha256)throw Error('Scale source changed during measurement.');
    const body:Omit<LightragLadder,'receiptId'>={document:'lightrag-ladder',schemaVersion:1,status:JSON.stringify(sizes)===JSON.stringify(registered.sizes)?'measured':'probe',registration:LIGHTRAG_LADDER_REGISTRATION,
        registrationId:await canonicalSha256(registered),fixtureId:loaded.fixtureId,source,at:(options.now??now)(),sizes,rows,backendDecision:lightRagBackendDecision(rows),physicalRequests:0,
        identity:options.identity??{platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model??'unknown',logicalCpus:cpus().length,totalMemoryBytes:totalmem(),
            runtime:process.versions.bun?'bun '+process.versions.bun:`node ${process.versions.node}; V8 heap limit ${getHeapStatistics().heap_size_limit} bytes`,driver:'node:sqlite',loadAverage:loadavg()}};
    return validateLightRagLadder({...body,receiptId:await canonicalSha256(body)});
}
