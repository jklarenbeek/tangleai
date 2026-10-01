/** A separately registered topology control gives one-hop and two-hop facts distinct evidence. */
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {SafeStaticFetcher,createDocumentIngester} from '@tangleai/documents';
import {createHashEmbedder} from '@tangleai/models/embed';
import {createBudgetAccount} from '@tangleai/agents';
import {openTangleDb,createDocumentStore,createLightRagStore,createCorpusPromotion} from '@tangleai/store';
import {createScriptedExtractor,createScriptedProfiler,createScriptedCoreferenceJudge,createScriptedPlanner,retrieveLightRag,lightragMust,type LightRagRetrieval} from '@tangleai/lightrag';
import {graphFixturePrompts,LIGHTRAG_SCRIPTED_MODEL} from './lightrag-corpus.ts';
import type {OneHopFixture,OneHopControl,ControlObservation} from './lightrag.types.ts';
export const LIGHTRAG_ONE_HOP_PATH='benchmark/fixtures/lightrag/one-hop-control.json';
export const LIGHTRAG_ONE_HOP_SHA256='9787cac71bdb0bf652fdbab5c161f1120d49ba40c5f70b50e7c0fddac0df2dc3';
export async function measureLightRagOneHop(root:string):Promise<OneHopControl>{
    const bytes=await readFile(join(root,LIGHTRAG_ONE_HOP_PATH)),sha256=createHash('sha256').update(bytes).digest('hex');
    if(sha256!==LIGHTRAG_ONE_HOP_SHA256)throw Error('The registered one-hop control bytes changed.');
    const fixture=JSON.parse(bytes.toString())as OneHopFixture,db=await openTangleDb(),documents=createDocumentStore(db),graph=createLightRagStore(db),embedder=createHashEmbedder({dims:64});
    const now=()=> '2026-06-01T00:00:00.000Z',bodies=new Map<string,string>(),keyByChunk=new Map<string,string>();
    const ingester=createDocumentIngester({store:documents,embedder,now,fetcher:new SafeStaticFetcher({now,lookup:async()=>[{address:'93.184.216.34',family:4}],limits:{respectRobots:false,perHostDelayMs:0},fetch:async input=>{
        const body=bodies.get(String(input));if(body===undefined)throw Error('Unregistered control fetch.');return new Response(body,{headers:{'content-type':'text/markdown'}});
    }})}),promotion=createCorpusPromotion({db,documents,lightrag:graph});
    try{
        for(const source of fixture.sources){
            const url='https://graph.example/'+source.key;bodies.set(url,'# '+source.key+'\n\n'+source.text);
            const document=await ingester.prepare({url,maxTokens:100,overlapTokens:16});if(document.status!=='prepared'||document.bundle.chunks.length!==1)throw Error('The one-hop evidence must occupy separate single-chunk sources.');
            const prompts=graphFixturePrompts(),modelIdentity=LIGHTRAG_SCRIPTED_MODEL,reply={entities:source.entities.map(name=>({name,type:'CONCEPT',description:source.entities.length===1?source.text:name+' participates in the depot connection.'})),
                relations:source.relations.map(([from,to])=>({source:from,target:to,description:source.text,themes:['connections'],strength:1})),contentKeywords:['connections']};
            const extractor=createScriptedExtractor({[document.bundle.chunks[0].id]:reply},{modelIdentity,promptRevision:prompts.extraction});
            const profiler=createScriptedProfiler(input=>({profile:input.contexts.map(row=>row.description).join(' '),themes:[]}),{modelIdentity,promptRevision:prompts.profiling});
            const judge=createScriptedCoreferenceJudge(input=>({groups:[input.subjects.map(row=>row.id)],reasons:['The source descriptions name the same register organization.']}),{modelIdentity,promptRevision:prompts.deduplication});
            const result=lightragMust(await promotion.prepare({document,graph:{extractor,profiler,judge,embedder,budget:createBudgetAccount({turns:100,tokens:100000},()=>0),clock:()=>0,
                identities:{extraction:'structured-graph/1',chunker:{version:document.bundle.version.chunkerVersion,config:document.bundle.version.chunkerConfig},embedder:document.bundle.version.embeddedBy,prompts,model:modelIdentity}}}));
            if(result.status!=='prepared')throw Error('The registered control source must be prepared.');lightragMust(await promotion.promote(result));keyByChunk.set(document.bundle.chunks[0].id,source.key);
        }
        const planner=createScriptedPlanner(()=>({lowLevelKeywords:fixture.lowLevelKeywords,highLevelKeywords:fixture.highLevelKeywords}));
        const observe=(value:LightRagRetrieval):ControlObservation=>{const names=new Map(value.entities.map(row=>[row.id,row.name]));return {
            entityNames:value.entities.map(row=>row.name).sort(),relationPairs:value.relations.map(row=>(names.get(row.sourceEntityId)??row.sourceEntityId)+' → '+(names.get(row.targetEntityId)??row.targetEntityId)).sort(),
            chunkKeys:value.bundle.suppliedChunkIds.map(id=>{const key=keyByChunk.get(id);if(!key)throw Error('Unregistered control citation.');return key;}).sort(),localCalls:value.spend.calls,budgetTokens:value.spend.tokens,contextTokens:value.bundle.tokenCount,pruned:value.pruned};};
        async function run(expansionRelations:number){const plan=lightragMust(await planner(fixture.query,{mode:fixture.mode,limits:{...fixture.limits,expansionRelations}}));
            return observe(lightragMust(await retrieveLightRag({store:graph,documents,embedder,plan,budget:createBudgetAccount({turns:8,tokens:10000},()=>0),clock:()=>0,includeTimings:false})));}
        const withExpansion=await run(fixture.limits.expansionRelations),withoutExpansion=await run(0),oneHopFound=withExpansion.chunkKeys.includes(fixture.expected.oneHopChunk),twoHopFound=withExpansion.chunkKeys.includes(fixture.expected.twoHopChunk),withoutExpansionOneHopFound=withoutExpansion.chunkKeys.includes(fixture.expected.oneHopChunk);
        return {fixture,sha256:LIGHTRAG_ONE_HOP_SHA256,embeddedBy:{model:'hash-trigram-64',dims:64},chunker:{version:'heading-recursive/1',config:{maxTokens:100,overlapTokens:16}},withExpansion,withoutExpansion,oneHopFound,twoHopFound,withoutExpansionOneHopFound,passed:oneHopFound&&!twoHopFound&&!withoutExpansionOneHopFound};
    }finally{await db.close();}
}
