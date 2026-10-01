/** Keyless public corpus lifecycle; the fetch and model seams are deterministic fixtures. */
import {createBudgetAccount} from '@tangleai/agents';
import {createDocumentIngester,SafeStaticFetcher} from '@tangleai/documents';
import {createHashEmbedder} from '@tangleai/models/embed';
import {createScriptedExtractor,createScriptedProfiler,createScriptedCoreferenceJudge,lightRagPrompt,lightragMust} from '@tangleai/lightrag';
import {createDocumentStore,createLightRagStore,createCorpusPromotion,collectDocumentGarbage,type TangleDb} from '@tangleai/store';
export async function runLightRagExample(db:TangleDb){
    const documents=createDocumentStore(db),lightrag=createLightRagStore(db),promotion=createCorpusPromotion({db,documents,lightrag});
    const embedder=createHashEmbedder({dims:32}),now=()=> '2026-06-01T00:00:00.000Z',url='https://docs.example/graph-example';
    let edition=1,extractions=0;
    const ingester=createDocumentIngester({store:documents,embedder,now,fetcher:new SafeStaticFetcher({now,lookup:async()=>[{address:'93.184.216.34',family:4}],limits:{respectRobots:false,perHostDelayMs:0},
        fetch:async()=>new Response(`<html><main><h1>Cedar Guild</h1><p>Cedar Guild maintains the ${edition===1?'Archive':'Registry'} equipment store.</p></main></html>`,{headers:{'content-type':'text/html'}})})});
    const modelIdentity={provider:'fixture',model:'scripted'},prompts={extraction:lightRagPrompt('graph-extractor').revision,profiling:lightRagPrompt('graph-profiler').revision,deduplication:lightRagPrompt('graph-deduplicator').revision};
    async function prepare(){
        const document=await ingester.prepare({url,maxTokens:100,overlapTokens:16});if(document.status==='failed')throw Error(document.error.message);
        const version=document.status==='prepared'?document.bundle.version:document.version,chunks=document.status==='prepared'?document.bundle.chunks:await documents.listChunks(version.id),place=edition===1?'Archive':'Registry';
        const scripted=createScriptedExtractor(Object.fromEntries(chunks.map(chunk=>[chunk.id,{entities:[{name:'Cedar Guild',type:'ORGANIZATION',description:'Cedar Guild maintains the equipment store.'},{name:place,type:'LOCATION',description:`The ${place} holds equipment.`}],
            relations:[{source:'Cedar Guild',target:place,description:`Cedar Guild maintains the ${place}.`,strength:1,themes:['equipment']}],contentKeywords:['equipment']} ])),{modelIdentity,promptRevision:prompts.extraction});
        const extractor=Object.assign(async(...args:Parameters<typeof scripted>)=>{extractions++;return scripted(...args);},{modelIdentity,promptRevision:prompts.extraction,budget:null});
        const profiler=createScriptedProfiler(input=>({profile:input.contexts.map(row=>row.description).join(' '),themes:[]}),{modelIdentity,promptRevision:prompts.profiling});
        const judge=createScriptedCoreferenceJudge(input=>({groups:[input.subjects.map(row=>row.id)],reasons:['The supplied descriptions identify one organization.']}),{modelIdentity,promptRevision:prompts.deduplication});
        return lightragMust(await promotion.prepare({document,graph:{extractor,profiler,judge,embedder,budget:createBudgetAccount({turns:32,tokens:20000},()=>0),clock:()=>0,
            identities:{extraction:'structured-graph/1',chunker:{version:version.chunkerVersion,config:version.chunkerConfig},embedder:version.embeddedBy,prompts,model:modelIdentity}}}));
    }
    const first=await prepare();if(first.status!=='prepared')throw Error('Expected a new source.');const activated=lightragMust(await promotion.promote(first));
    const replay=lightragMust(await promotion.promote(first)),unchanged=await prepare();
    edition=2;const second=await prepare();if(second.status!=='prepared')throw Error('Expected a replacement.');lightragMust(await promotion.promote(second));
    const removed=lightragMust(await promotion.retract(activated.sourceId));edition=1;
    const before=extractions,retained=await prepare();if(retained.status!=='prepared')throw Error('Expected a retained version.');const restored=lightragMust(await promotion.promote(retained));
    // Collection is explicit and conservative. Referenced superseded graph evidence remains addressable.
    const garbage=await collectDocumentGarbage(db,{dryRun:true});
    return {unchanged:unchanged.status,replayWrites:replay.documentWrites+replay.graph.writes,removedDocumentWrites:removed.documentWrites,
        reactivated:restored.graph.reactivation,reactivationClaims:restored.graph.newClaims,reactivationCalls:restored.spend.calls,reactivationExtractions:extractions-before,
        head:restored.graph.head.revision,retainedVersions:garbage.retained.length,activeEntities:(await lightrag.listEntities()).length,activeRelations:(await lightrag.listRelations()).length};
}
