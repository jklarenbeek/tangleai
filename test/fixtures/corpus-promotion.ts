import assert from 'node:assert/strict';
import {createHashEmbedder} from '@tangleai/models';
import {createBudgetAccount} from '@tangleai/agents';
import {SafeStaticFetcher,createDocumentIngester,type PreparedOutcome} from '@tangleai/documents';
import {openTangleDb,createDocumentStore,createLightRagStore,createCorpusPromotion,type CorpusGraphPreparationOptions} from '@tangleai/store';
import {createScriptedExtractor,createScriptedProfiler,createScriptedCoreferenceJudge,lightRagPrompt,lightragMust,type GraphExtractionReply} from '@tangleai/lightrag';
import {asRows} from '../../packages/store/src/memory-store.ts';
export async function corpusFixture(options:{probe?:(step:string)=>void|Promise<void>;dims?:number}={}){
    const db=await openTangleDb(),documents=createDocumentStore(db),graph=createLightRagStore(db),hash=createHashEmbedder({dims:options.dims??16}),modelIdentity={provider:'fixture',model:'scripted'},now=()=> '2026-06-01T00:00:00.000Z';
    const counts={documentEmbedding:0,extraction:0,profiling:0,judging:0,graphEmbedding:0},bodies=new Map<string,{body:string;mimeType:string}>();
    const embedder={...hash,embed:async(texts:string[])=>{counts.documentEmbedding++;return hash.embed(texts);}},graphEmbedder={...hash,embed:async(texts:string[])=>{counts.graphEmbedding++;return hash.embed(texts);}};
    const ingester=createDocumentIngester({store:documents,embedder,now,fetcher:new SafeStaticFetcher({now,lookup:async()=>[{address:'93.184.216.34',family:4}],limits:{respectRobots:false,perHostDelayMs:0},fetch:async input=>{const found=bodies.get(String(input));return new Response(found?.body??'',{headers:{'content-type':found?.mimeType??'text/html'}});}})});
    const promotion=createCorpusPromotion({db,documents,lightrag:graph,applyProbe:options.probe});
    const source=(name:string,version=1)=>{const url=`https://docs.example/${name}`;bodies.set(url,{body:`<html><body><main><h1>${name}</h1><p>Source ${name} policy ${version} records the equipment authority and its evidenced civic role in the local registry.</p></main></body></html>`,mimeType:'text/html'});return url;};
    function reply(name:string,version:number):GraphExtractionReply{
        const cedar={name:'Cedar',type:'ORGANIZATION' as const,description:name==='c'?'Cedar coordinates the regional equipment register.':'Cedar has an evidenced civic role.'};
        const entity=(name:string)=>({name,type:'CONCEPT' as const,description:name+' has an evidenced civic role.'});
        if(name==='a')return {entities:[cedar,entity('Archive')],relations:[],contentKeywords:['registry']};
        if(name==='c')return {entities:[cedar],relations:[],contentKeywords:['regional']};
        const fact=version===1?'OldPolicy':'NewPolicy';return {entities:[cedar,entity('Willow'),entity(fact)],relations:[{source:'Cedar',target:'Willow',description:'Cedar shares equipment with Willow.',themes:['equipment'],strength:1},{source:'Willow',target:fact,description:`Willow follows ${fact}.`,themes:['policy'],strength:1}],contentKeywords:['equipment','policy']};
    }
    async function prepare(name:string,version=1){
        const url=source(name,version),document=await ingester.prepare({url,maxTokens:80,overlapTokens:16});if(document.status==='failed')throw Error(document.error.message);
        const result=await prepareDocument(document,()=>reply(name,version));assert.equal(result.valid,true,JSON.stringify(result));return lightragMust(result);
    }
    async function prepareDocument(document:PreparedOutcome,extractionReply:()=>unknown,configure?:(graph:CorpusGraphPreparationOptions)=>CorpusGraphPreparationOptions){
        if(document.status==='failed')throw Error(document.error.message);
        const record=document.status==='prepared'?document.bundle.version:document.version,chunks=document.status==='prepared'?document.bundle.chunks:await documents.listChunks(record.id);assert.equal(chunks.length,1);
        const prompts={extraction:lightRagPrompt('graph-extractor').revision,profiling:lightRagPrompt('graph-profiler').revision,deduplication:lightRagPrompt('graph-deduplicator').revision};
        const scripted=createScriptedExtractor(Object.fromEntries(chunks.map(chunk=>[chunk.id,extractionReply()])),{modelIdentity,promptRevision:prompts.extraction});
        const extractor=Object.assign(async(...args:Parameters<typeof scripted>)=>{counts.extraction++;return scripted(...args);},{modelIdentity:scripted.modelIdentity,promptRevision:scripted.promptRevision,budget:null});
        const profiler=createScriptedProfiler(input=>{counts.profiling++;return {profile:input.contexts.map(row=>row.description).join(' '),themes:[]};},{modelIdentity,promptRevision:prompts.profiling});
        const judge=createScriptedCoreferenceJudge(input=>{counts.judging++;return {groups:[input.subjects.map(row=>row.id)],reasons:['The source descriptions name the same register organization.']};},{modelIdentity,promptRevision:prompts.deduplication});
        const graphOptions:CorpusGraphPreparationOptions={extractor,profiler,judge,embedder:graphEmbedder,budget:createBudgetAccount({turns:100,tokens:100000},()=>0),clock:()=>0,
            identities:{extraction:'structured-graph/1',chunker:{version:record.chunkerVersion,config:record.chunkerConfig},embedder:record.embeddedBy,prompts,model:modelIdentity}};
        return promotion.prepare({document,graph:configure?configure(graphOptions):graphOptions});
    }
    async function activate(name:string,version=1){const prepared=await prepare(name,version);assert.equal(prepared.status,'prepared');if(prepared.status!=='prepared')throw Error('Expected prepared source.');const receipt=lightragMust(await promotion.promote(prepared));return {prepared,receipt};}
    async function snapshot(){const tables=['sources','document_versions','document_elements','document_chunks','document_parents','lightrag_projections','lightrag_entity_claims','lightrag_relation_claims','lightrag_chunk_profiles','lightrag_entities','lightrag_relations'];return db.transaction(async scope=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,asRows(await scope.collection(table).execute({$for:{row:'$[*]'},$orderby:'$row.id',$return:'$row'}))]))),{mode:'deferred'});}
    async function citations(){
        for(const row of [...await graph.listEntities(),...await graph.listRelations()])for(const id of row.supportChunkIds){const chunk=await db.collection<{id:string;sourceId:string;versionId:string}>('document_chunks').get(id);assert.ok(chunk);assert.equal((await documents.getSource(chunk.sourceId))?.activeVersionId,chunk.versionId);assert.equal((await documents.getVersion(chunk.versionId))?.status,'active');}
    }
    return {db,documents,graph,ingester,promotion,source,prepare,prepareDocument,activate,counts,snapshot,citations,setBody:(url:string,body:string,mimeType='text/markdown')=>bodies.set(url,{body,mimeType})};
}
