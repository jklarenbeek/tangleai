import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetAccount } from '@tangleai/agents';
import { createHashEmbedder } from '@tangleai/models';
import { asRows } from '../../packages/store/src/memory-store.ts';
import { buildContribution,validateGraphContribution } from '../../packages/lightrag/src/contribution.ts';
import { createScriptedExtractor,createStructuredExtractor } from '../../packages/lightrag/src/extract.ts';
import { createScriptedProfiler } from '../../packages/lightrag/src/profile.ts';
import { createCandidateResolver,createScriptedCoreferenceJudge } from '../../packages/lightrag/src/resolve.ts';
import { lightRagPrompt } from '../../packages/lightrag/src/catalog.ts';
import { foldEntityName } from '../../packages/lightrag/src/normalize.ts';
import type { GraphContributionSnapshot,GraphContribution,LightRagIdentities } from '../../packages/lightrag/src/contracts.gen.ts';
import { graphFixture,graphTestChunk,extractionReply } from './fixture.ts';
const modelIdentity={provider:'fixture',model:'scripted'},prompts={extraction:lightRagPrompt('graph-extractor').revision,profiling:lightRagPrompt('graph-profiler').revision,deduplication:lightRagPrompt('graph-deduplicator').revision};
const empty=():GraphContributionSnapshot=>({claims:{entities:[],relations:[]},canonicals:{entities:[],relations:[]}});
function seams(replies:Record<string,unknown>,snapshot:()=>GraphContributionSnapshot=empty){
    const embedder=createHashEmbedder({dims:64}),budget=createBudgetAccount({turns:100,tokens:100000},()=>0),requests:string[][]=[];
    const identities:LightRagIdentities={extraction:'structured-graph/1',chunker:{version:'heading-recursive/1',config:{maxTokens:100,overlapTokens:32}},embedder:{model:embedder.model,dims:64},prompts,model:modelIdentity};
    const extractor=createScriptedExtractor(replies,{promptRevision:prompts.extraction,modelIdentity});
    const profiler=createScriptedProfiler(input=>({profile:input.contexts.map(row=>row.description).join(' '),themes:['fixture']}),{promptRevision:prompts.profiling,modelIdentity});
    const judge=createScriptedCoreferenceJudge(input=>({groups:[input.subjects.map(row=>row.id)],reasons:['The authored claim descriptions identify one entity.']}),{promptRevision:prompts.deduplication,modelIdentity});
    const resolver=createCandidateResolver({lookup:async()=>snapshot(),judge});
    return {extractor,profiler,resolver,embedder:{...embedder,embed:async(texts:string[])=>{requests.push(texts);return embedder.embed(texts);}},budget,clock:()=>0,identities,requests};
}
async function preparedFixture(){
    const fixture=await graphFixture();let snapshot=empty();const bundles:GraphContribution[]=[],last=new Map<string,GraphContribution>();const options=seams(fixture.replies,()=>snapshot);
    try{
        const allChunks=await fixture.store.listChunks();
        for(const source of fixture.loaded.fixture.sources)for(const version of source.versions){
            const chunks=allChunks.filter(chunk=>fixture.keyById.get(chunk.id)!.startsWith(version.key+':')),previous=last.get(chunks[0].sourceId);
            const result=await buildContribution({...options,chunks,retiredClaimIds:previous?[...previous.plan.input.claims.entities,...previous.plan.input.claims.relations].map(row=>row.id):[]});
            assert.equal(result.valid,true,JSON.stringify(result));if(!result.valid)throw Error('Preparation refused.');const bundle=result.value;bundles.push(bundle);last.set(bundle.sourceId,bundle);
            snapshot={claims:{entities:[...new Map([...snapshot.claims.entities,...bundle.plan.input.claims.entities].map(row=>[row.id,row])).values()],relations:[...new Map([...snapshot.claims.relations,...bundle.plan.input.claims.relations].map(row=>[row.id,row])).values()]},canonicals:bundle.plan.canonicals};
        }
        const entities=snapshot.canonicals.entities.filter(row=>row.status==='active'),relations=snapshot.canonicals.relations.filter(row=>row.status==='active');
        assert.equal(entities.length,20);assert.equal(relations.length,18);
        for(const expected of fixture.loaded.fixture.entities){const actual=entities.find(row=>row.normalizedName===foldEntityName(expected.name)&&row.types[0]===expected.type)!;assert.ok(actual,expected.key);assert.deepEqual(actual.supportChunkIds.map(id=>fixture.keyById.get(id)).sort(),[...expected.supportChunks].sort());}
        const entityId=new Map(fixture.loaded.fixture.entities.map(expected=>[expected.key,entities.find(row=>row.normalizedName===foldEntityName(expected.name)&&row.types[0]===expected.type)!.id]));
        for(const expected of fixture.loaded.fixture.relations){const actual=relations.find(row=>row.sourceEntityId===entityId.get(expected.source)&&row.targetEntityId===entityId.get(expected.target)&&JSON.stringify(row.themes)===JSON.stringify([...expected.themes].sort()))!;assert.ok(actual,expected.key);assert.deepEqual(actual.supportChunkIds.map(id=>fixture.keyById.get(id)).sort(),[...expected.supportChunks].sort());}
        assert.equal(asRows(await fixture.db.collection('lightrag_projections').execute({$for:{row:'$[*]'},$return:'$row'})).length,0);
        return {bundles,snapshot,requests:options.requests,counts:{entities:entities.length,relations:relations.length,entityClaims:snapshot.claims.entities.length,relationClaims:snapshot.claims.relations.length,decisions:bundles.reduce((sum,row)=>sum+row.stats.decisions,0),merges:bundles.reduce((sum,row)=>sum+row.stats.merges,0),calls:options.budget.spent().turns}};
    }finally{await fixture.close();}
}
it('the whole fixture prepares twice with exact canonical support, identity and no active graph write',async(t)=>{
    const first=await preparedFixture(),second=await preparedFixture();assert.deepEqual(first,second);
    t.diagnostic(JSON.stringify(first.counts));
    assert.equal(first.bundles.length,7);assert.equal(first.counts.entityClaims,62);assert.equal(first.counts.relationClaims,38);
    for(const bundle of first.bundles){assert.equal(bundle.partial,false);assert.equal((await validateGraphContribution(bundle)).valid,true);for(const row of [...bundle.plan.canonicals.entities,...bundle.plan.canonicals.relations])assert.deepEqual(row.embeddedBy,bundle.identities.embedder);}
    assert.deepEqual(first.counts,{entities:20,relations:18,entityClaims:62,relationClaims:38,decisions:4,merges:0,calls:14});assert.equal(first.requests.length,first.counts.calls);
});
it('malformed extraction remains a counted partial bundle while valid chunk claims stay evidenced',async()=>{
    const first=graphTestChunk(),second={...first,id:'second',order:1},options=seams({chunk:null,second:extractionReply});
    const result=await buildContribution({...options,chunks:[first,second]});assert.equal(result.valid,true,JSON.stringify(result));
    if(result.valid){assert.equal(result.value.partial,true);assert.equal(result.value.failures.length,1);assert.equal(result.value.failures[0].issues[0].code,'TLRAG1004');assert.deepEqual(result.value.completedChunkIds,['second']);assert.deepEqual(result.value.plan.input.claims.entities.map(row=>row.chunkId),['second']);assert.equal(result.value.stats.failedChunks,1);}
});
it('a budget stop preserves completed chunks and spend and never reaches resolution or activation',async()=>{
    const chunk=graphTestChunk(),chunks=[0,1,2].map(order=>({...chunk,id:'chunk-'+order,order})),options=seams({});let calls=0,lookups=0;
    const budget=createBudgetAccount({turns:2},()=>0),extractor=createStructuredExtractor({artifact:lightRagPrompt('graph-extractor'),budget,clock:()=>0,client:{endpoint:modelIdentity,complete:async()=>{calls++;return {message:{content:JSON.stringify(extractionReply)},usage:{total_tokens:3}};}}});
    const original=options.resolver, resolver=Object.assign(async(request:Parameters<typeof original>[0])=>{lookups++;return original(request);},{modelIdentity:original.modelIdentity,promptRevision:original.promptRevision,budget:original.budget});
    const result=await buildContribution({...options,chunks,budget,extractor,resolver,extraction:{gleaning:0}});assert.equal(result.valid,false);
    if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1005');assert.equal(result.stopReason,'budget-turns');assert.deepEqual(result.completedChunkIds,['chunk-0','chunk-1']);assert.deepEqual(result.spend,{calls:2,tokens:6,ms:0});assert.deepEqual(JSON.parse(JSON.stringify(result)),result);}
    assert.equal(calls,2);assert.equal(lookups,0);
});
it('graph names and relation themes are embedded as separate registered corpora',async()=>{
    const chunk=graphTestChunk(),reply={entities:[...extractionReply.entities,{name:'Willow',type:'ORGANIZATION',description:'Willow maintains the register.'}],relations:[{source:'Cedar',target:'Willow',description:'Cedar shares equipment with Willow.',themes:['equipment sharing'],strength:1}],contentKeywords:['equipment']},options=seams({chunk:reply});
    const result=await buildContribution({...options,chunks:[chunk]});assert.equal(result.valid,true,JSON.stringify(result));
    assert.equal(options.requests.length,2);assert.deepEqual([...options.requests[0]].sort(),['cedar','willow']);assert.deepEqual(options.requests[1],['equipment sharing']);
});
it('a graph stage bound to another shared account refuses before model work',async()=>{
    let calls=0;const options=seams({}),extractor=createStructuredExtractor({artifact:lightRagPrompt('graph-extractor'),budget:createBudgetAccount({turns:10},()=>0),clock:()=>0,client:{endpoint:modelIdentity,complete:async()=>{calls++;return {message:{content:JSON.stringify(extractionReply)}};}}});
    const result=await buildContribution({...options,extractor,chunks:[graphTestChunk()]});assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,'TLRAG1002');assert.equal(calls,0);
});
