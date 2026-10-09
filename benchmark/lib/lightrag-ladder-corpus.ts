/** The registered graph ladder corpus, shared without changing its inputs or build. */
import {mulberry32} from '@jarenjs/core/random';
import {createBudgetAccount} from '@tangleai/agents';
import {SafeStaticFetcher,createDocumentIngester} from '@tangleai/documents';
import {createHashEmbedder} from '@tangleai/models/embed';
import type {Embedder} from '@tangleai/models/embed';
import type {DocumentCorpusStore,StoredDocumentBundle} from '@tangleai/documents/contracts';
import {createDocumentStore,createLightRagStore,createCorpusPromotion,type TangleDb} from '@tangleai/store';
import {createScriptedExtractor,createScriptedProfiler,createScriptedCoreferenceJudge,lightragMust,type GraphExtractionReply} from '@tangleai/lightrag';
import {graphFixturePrompts,LIGHTRAG_SCRIPTED_MODEL} from './lightrag-corpus.ts';
import type {LoadedLightRagFixture} from './lightrag.ts';
import registered from '../fixtures/lightrag/ladder-registration.json' with {type:'json'};
export function syntheticGraphLadderCorpus(loaded:LoadedLightRagFixture,size:number){
    const random=mulberry32(registered.seed),entities=new Map(loaded.fixture.entities.map(row=>[row.key,row])),replies:GraphExtractionReply[]=[],sections:string[]=[];
    for(let index=0;index<size;index++){
        const relation=loaded.fixture.relations[Math.floor(random()*loaded.fixture.relations.length)]!,from=entities.get(relation.source)!,to=entities.get(relation.target)!,ordinal=String(index).padStart(5,'0');
        const source=from.name+' sample '+ordinal+' source',target=to.name+' sample '+ordinal+' target';
        let description=`${source} links to ${target} through ${relation.themes.join(' and ')}.`;
        while(description.length<registered.minParagraphCharacters)description+=registered.paddingSentence;
        sections.push(`# Sample ${ordinal}\n\n${description}`);
        replies.push({entities:[{name:source,type:from.type,description},{name:target,type:to.type,description}],relations:[{source,target,description,strength:1,themes:relation.themes}],contentKeywords:relation.themes});
    }
    return {text:sections.join('\n\n'),replies};
}
export async function prepareGraphLadderDocument(corpus:{text:string},size:number,documents:DocumentCorpusStore,embedder:Embedder){
    const at=()=> '2026-06-01T00:00:00.000Z',url='https://scale.example/registered-graph';
    const ingester=createDocumentIngester({store:documents,embedder,now:at,fetcher:new SafeStaticFetcher({now:at,lookup:async()=>[{address:'93.184.216.34',family:4}],
        limits:{respectRobots:false,perHostDelayMs:0},fetch:async()=>new Response(corpus.text,{headers:{'content-type':'text/markdown'}})})});
    const document=await ingester.prepare({url,maxTokens:registered.chunker.maxTokens,overlapTokens:registered.chunker.overlapTokens,extractLimits:{maxElements:size*registered.extract.maxElementsPerChunk,minUsefulChars:registered.extract.minUsefulChars,allowPartial:registered.extract.allowPartial}});
    if(document.status!=='prepared')throw Error('The synthetic graph document did not prepare: '+JSON.stringify(document));
    if(document.bundle.chunks.length!==size)throw Error(`Registered ${size} chunks but the native chunker produced ${document.bundle.chunks.length}.`);
    return document;
}
export function graphLadderPreparation(document:StoredDocumentBundle,corpus:{replies:GraphExtractionReply[]},embedder:Embedder,
    work:{extracted:number;profiled:number;reviewed:number}={extracted:0,profiled:0,reviewed:0}){
    const prompts=graphFixturePrompts(),raw=createScriptedExtractor(Object.fromEntries(document.chunks.map((chunk,index)=>{
        if(chunk.order!==index||!chunk.text.includes(corpus.replies[index].entities[0].name))throw Error('Synthetic chunk order or source evidence differs.');return [chunk.id,corpus.replies[index]];
    })),{modelIdentity:LIGHTRAG_SCRIPTED_MODEL,promptRevision:prompts.extraction});
    const extractor=Object.assign(async(...args:Parameters<typeof raw>)=>{work.extracted++;return raw(...args);},{modelIdentity:raw.modelIdentity,promptRevision:raw.promptRevision,budget:null});
    const profiler=createScriptedProfiler(input=>{work.profiled++;return {profile:input.contexts.map(row=>row.description).join(' '),themes:[]};},{modelIdentity:LIGHTRAG_SCRIPTED_MODEL,promptRevision:prompts.profiling});
    const judge=createScriptedCoreferenceJudge(()=>{work.reviewed++;throw Error('Distinct synthetic names must not invoke co-reference review.');},{modelIdentity:LIGHTRAG_SCRIPTED_MODEL,promptRevision:prompts.deduplication});
    return {extractor,profiler,judge,embedder,budget:createBudgetAccount({turns:document.chunks.length*3,tokens:document.chunks.length*1000},()=>0),clock:()=>0,
        identities:{extraction:'structured-graph/1',chunker:{version:document.version.chunkerVersion,config:document.version.chunkerConfig},embedder:document.version.embeddedBy,prompts,model:LIGHTRAG_SCRIPTED_MODEL}};
}
export async function createLightRagLadderCorpus(loaded:LoadedLightRagFixture,size:number,db:TangleDb,timer:()=>number){
        const documents=createDocumentStore(db),graph=createLightRagStore(db),promotion=createCorpusPromotion({db,documents,lightrag:graph}),hash=createHashEmbedder({dims:registered.embeddedBy.dims});
        const work={embeddingCalls:0,embeddingTexts:0,extracted:0,profiled:0,reviewed:0},embedder={...hash,embed:async(texts:string[])=>{work.embeddingCalls++;work.embeddingTexts+=texts.length;return hash.embed(texts);}};
        const corpus=syntheticGraphLadderCorpus(loaded,size),started=timer(),document=await prepareGraphLadderDocument(corpus,size,documents,embedder);
        const prepared=lightragMust(await promotion.prepare({document,graph:graphLadderPreparation(document.bundle,corpus,embedder,work)}));
        if(prepared.status!=='prepared')throw Error('Expected a new synthetic contribution.');
        const preparedAt=timer();lightragMust(await promotion.promote(prepared));const promotedAt=timer(),indexing={...work};
        const canonicals={entities:(await graph.listEntities()).length,relations:(await graph.listRelations()).length},claims=prepared.contribution.stats.entityClaims+prepared.contribution.stats.relationClaims;
        return {documents,graph,promotion,embedder,prepared,document,corpus,canonicals,claims,indexing,
            indexingMs:preparedAt-started,promotionMs:promotedAt-preparedAt};
}
