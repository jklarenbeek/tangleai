/** Measure replacement of the immutable grounding relay history through joint admission. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createBudgetAccount} from '@tangleai/agents';
import {createHashEmbedder} from '@tangleai/models/embed';
import {SafeStaticFetcher,createDocumentIngester} from '@tangleai/documents';
import {openTangleDb,createDocumentStore,createLightRagStore,createCorpusPromotion} from '@tangleai/store';
import {createScriptedExtractor,createScriptedProfiler,createScriptedCoreferenceJudge,lightragMust,type GraphExtractionReply} from '@tangleai/lightrag';
import {graphFixturePrompts,LIGHTRAG_SCRIPTED_MODEL} from './lightrag-corpus.ts';
import {loadGroundingFixture} from './grounding.ts';
import type {GraphIncrementalObservation} from './lightrag.types.ts';
export async function measureLightRagIncremental(root=process.cwd()):Promise<GraphIncrementalObservation>{
    const loaded=await loadGroundingFixture(root),relay=loaded.fixture.sources.find(row=>row.key==='relay-history')!,beacon=loaded.fixture.sources.find(row=>row.key==='beacon-spec')!;
    const db=await openTangleDb(),documents=createDocumentStore(db),graph=createLightRagStore(db),promotion=createCorpusPromotion({db,documents,lightrag:graph}),embedder=createHashEmbedder({dims:64}),prompts=graphFixturePrompts();
    const bodies=new Map<string,{text:string;mime:string}>();let at='1970-01-01T00:00:00.000Z';
    const ingester=createDocumentIngester({store:documents,embedder,now:()=>at,fetcher:new SafeStaticFetcher({now:()=>at,lookup:async()=>[{address:'93.184.216.34',family:4}],limits:{respectRobots:false,perHostDelayMs:0},fetch:async input=>{const body=bodies.get(String(input));if(!body)throw Error('Unregistered incremental fixture request.');return new Response(body.text,{headers:{'content-type':body.mime}});}})});
    let observation:GraphIncrementalObservation|undefined;
    try{for(const source of [beacon,relay])for(const [index,version]of source.versions.entries()){
        at=version.admittedAt;const text=await readFile(join(root,'benchmark/fixtures/grounding',version.file),'utf8');bodies.set(source.url,{text,mime:source.mimeType});
        const document=await ingester.prepare({url:source.url,strategy:'recursive',maxTokens:450,overlapTokens:48});if(document.status!=='prepared')throw Error('The incremental source did not prepare.');
        const active=await graph.activeProjectionFor(document.bundle.source.id),before=[...await graph.listEntities({status:'all'}),...await graph.listRelations({status:'all'})],extracted:string[]=[];
        const engine=index===0?'cedar':'rowan';if(source===relay&&!text.includes(`frames through the ${engine} engine`))throw Error('The registered relay version no longer states its shipping engine.');
        const reply:GraphExtractionReply=source===beacon?{entities:[{name:'Beacon',type:'TECHNOLOGY',description:'Beacon provides an independent transport specification.'}],relations:[],contentKeywords:['transport']}:
            {entities:[{name:'Harbor Relay',type:'TECHNOLOGY',description:'Harbor Relay queues outbound frames.'},{name:engine,type:'TECHNOLOGY',description:`The ${engine} engine provides the current outbound queue.`}],relations:[{source:'Harbor Relay',target:engine,description:`Harbor Relay queues outbound frames through ${engine}.`,themes:['shipping queue engine'],strength:1}],contentKeywords:['shipping queue engine']};
        const raw=createScriptedExtractor(Object.fromEntries(document.bundle.chunks.map(chunk=>[chunk.id,reply])),{modelIdentity:LIGHTRAG_SCRIPTED_MODEL,promptRevision:prompts.extraction}),extractor=Object.assign(async(...args:Parameters<typeof raw>)=>{extracted.push(args[0].id);return raw(...args);},{modelIdentity:raw.modelIdentity,promptRevision:raw.promptRevision,budget:null});
        const profiler=createScriptedProfiler(input=>({profile:input.contexts.map(context=>context.description).join(' '),themes:[]}),{modelIdentity:LIGHTRAG_SCRIPTED_MODEL,promptRevision:prompts.profiling}),judge=createScriptedCoreferenceJudge(()=>{throw Error('This incremental fixture has no same-type homonym.');},{modelIdentity:LIGHTRAG_SCRIPTED_MODEL,promptRevision:prompts.deduplication});
        const prepared=lightragMust(await promotion.prepare({document,graph:{extractor,profiler,judge,embedder,budget:createBudgetAccount({turns:1000,tokens:100000},()=>0),clock:()=>0,identities:{extraction:'structured-graph/1',chunker:{version:document.bundle.version.chunkerVersion,config:document.bundle.version.chunkerConfig},embedder:document.bundle.version.embeddedBy,prompts,model:LIGHTRAG_SCRIPTED_MODEL}}}));
        if(prepared.status!=='prepared')throw Error('Expected a fresh incremental contribution.');lightragMust(await promotion.promote(prepared));
        if(active){const contribution=prepared.contribution,after=[...await graph.listEntities({status:'all'}),...await graph.listRelations({status:'all'})],byId=new Map(after.map(row=>[row.id,row])),touched=new Set([...contribution.plan.touchedEntityIds,...contribution.plan.touchedRelationIds]),unaffected=before.filter(row=>!touched.has(row.id)),incoming=new Set(document.bundle.chunks.map(chunk=>chunk.id)),withdrawn=new Set([...active.entityClaimIds,...active.relationClaimIds]);
            observation={fixtureId:loaded.fixtureId,source:source.key,previousVersion:source.versions[index-1].key,version:version.key,chunks:document.bundle.chunks.length,reextractedChunks:extracted.length,unrelatedChunksExtracted:extracted.filter(id=>!incoming.has(id)).length,canonicalsTouched:touched.size,unaffectedCanonicals:unaffected.length,unaffectedRevisionsChanged:unaffected.filter(row=>byId.get(row.id)?.revision!==row.revision).length,claimsWithdrawn:withdrawn.size,withdrawnSupportRemaining:after.filter(row=>row.status==='active').reduce((n,row)=>n+row.supportClaimIds.filter(id=>withdrawn.has(id)).length,0),localCalls:contribution.spend.calls,budgetTokens:contribution.spend.tokens,providerCalls:0};
            if(observation.unrelatedChunksExtracted||observation.unaffectedRevisionsChanged||observation.withdrawnSupportRemaining||!observation.unaffectedCanonicals||!(await documents.listChunks(active.versionId)).length||after.find(row=>'name'in row&&row.name==='cedar')?.status!=='retracted')throw Error('Incremental admission changed unrelated evidence, deleted history or retained withdrawn facts.');
        }
    }
    if(!observation)throw Error('The registered incremental replacement was not observed.');return observation;
    }finally{await db.close();}
}
