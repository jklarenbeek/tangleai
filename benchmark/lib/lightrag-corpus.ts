/** Private keyless corpus construction exposes evidence only after its complete build. */
import {createHash} from 'node:crypto';
import {SafeStaticFetcher,createDocumentIngester,type StoredDocumentBundle} from '@tangleai/documents';
import {createHashEmbedder} from '@tangleai/models/embed';
import {createBudgetAccount} from '@tangleai/agents';
import {EMPTY_HEAD} from '@tangleai/outcomes';
import {createDocumentStore,createLightRagStore,createCorpusPromotion,openTangleDb} from '@tangleai/store';
import {createMemoryLightRagStore,createScriptedExtractor,createScriptedProfiler,createScriptedCoreferenceJudge,createCandidateResolver,buildContribution,
    projectionForContribution,planProjectionWrites,lightRagPrompt,lightragMust,emptyGraphSpend,addGraphSpend,foldEntityName,foldThemes,
    type GraphExtractionReply,type GraphContribution,type LightRagStore} from '@tangleai/lightrag';
import type {LoadedLightRagFixture} from './lightrag.ts';
import type {GraphIncrementalObservation,GraphIndexingStage} from './lightrag.types.ts';
export const LIGHTRAG_SCRIPTED_MODEL={provider:'fixture',model:'scripted'};
export const graphFixturePrompts=()=>({extraction:lightRagPrompt('graph-extractor').revision,profiling:lightRagPrompt('graph-profiler').revision,deduplication:lightRagPrompt('graph-deduplicator').revision});
/** One ingestion owner serves the dense control and either graph reference backend. */
export async function createLightRagFixtureCorpus(loaded:LoadedLightRagFixture,options:{graph?:'memory'|'sqlite'}={}){
    const db=await openTangleDb(),store=createDocumentStore(db),embedder=createHashEmbedder(loaded.fixture.chunker.embeddedBy),keyById=new Map<string,string>(),idByKey=new Map<string,string>();
    const graph:LightRagStore|undefined=options.graph==='memory'?createMemoryLightRagStore():options.graph==='sqlite'?createLightRagStore(db):undefined;
    const promotion=options.graph==='sqlite'?createCorpusPromotion({db,documents:store,lightrag:graph!}):undefined,contributions:GraphContribution[]=[];
    const served=new Map<string,{bytes:Uint8Array;mime:string}>(),versionKeys=new Map<string,string>(),incremental:GraphIncrementalObservation[]=[],stages:GraphIndexingStage[]=[];
    const work={documentEmbeddingCalls:0,extractionPasses:0,profiledCanonicals:0,coreferenceCalls:0};let clock='1970-01-01T00:00:00.000Z',indexing=emptyGraphSpend();
    const fetcher=new SafeStaticFetcher({lookup:async()=>[{address:'93.184.216.34',family:4}],now:()=>clock,limits:{respectRobots:false,perHostDelayMs:0},fetch:async input=>{
        const body=served.get(String(input));if(!body)throw Error('No registered LightRAG fixture response.');return new Response(body.bytes.slice()as BodyInit,{headers:{'content-type':body.mime}});
    }}),ingester=createDocumentIngester({store,embedder,fetcher,now:()=>clock});
    function verifyChunks(key:string,bundle:StoredDocumentBundle){
        const actual=bundle.chunks,declared=loaded.fixture.chunks.filter(chunk=>chunk.version===key),elements=new Map(bundle.elements.map(row=>[row.id,row.order]));
        if(actual.length!==declared.length)throw Error('LightRAG fixture chunk count changed.');
        for(const chunk of actual){const expected=declared.find(row=>row.order===chunk.order),hash=createHash('sha256').update(chunk.text).digest('hex');
            if(!expected||hash!==expected.textSha256||JSON.stringify(chunk.elementIds.map(id=>elements.get(id)))!==JSON.stringify(expected.elementOrders))throw Error('LightRAG fixture chunk bytes or provenance changed.');
            keyById.set(chunk.id,expected.key);idByKey.set(expected.key,chunk.id);
        }
    }
    try{
        for(const source of loaded.fixture.sources)for(const version of source.versions){
            const workBefore={...work};clock=version.admittedAt;served.set(source.url,{bytes:loaded.bodies.get(version.key)!,mime:source.mimeType});
            const document=await ingester.prepare({url:source.url,strategy:'recursive',...loaded.fixture.chunker.config,force:true});
            if(document.status!=='prepared')throw Error('LightRAG fixture preparation did not complete: '+source.key);
            const bundle=document.bundle;if(bundle.version.chunkerVersion!==loaded.fixture.chunker.version)throw Error('LightRAG fixture chunker identity changed.');verifyChunks(version.key,bundle);
            versionKeys.set(bundle.version.id,version.key);work.documentEmbeddingCalls+=bundle.version.metrics.embeddingCalls;
            if(!graph){await store.activate(bundle);continue;}
            const active=await graph.activeProjectionFor(bundle.source.id),before=active?[...await graph.listEntities({status:'all'}),...await graph.listRelations({status:'all'})]:[],extracted:string[]=[];
            const prompts=graphFixturePrompts(),modelIdentity=LIGHTRAG_SCRIPTED_MODEL,replies:Record<string,GraphExtractionReply>={};
            for(const chunk of bundle.chunks){const declared=loaded.fixture.extraction.find(row=>row.chunk===keyById.get(chunk.id));if(!declared)throw Error('The fixture has no registered extraction for a real chunk.');
                replies[chunk.id]={entities:declared.entities.map(({key:_,...row})=>row),relations:declared.relations.map(({key:_,...row})=>row),contentKeywords:declared.contentKeywords};}
            const raw=createScriptedExtractor(replies,{modelIdentity,promptRevision:prompts.extraction});
            const extractor=Object.assign(async(...args:Parameters<typeof raw>)=>{extracted.push(args[0].id);const result=await raw(...args);work.extractionPasses+=result.attempts;return result;},{modelIdentity,promptRevision:prompts.extraction,budget:null});
            const profiler=createScriptedProfiler(input=>{work.profiledCanonicals++;return {profile:input.contexts.map(row=>row.description).join(' '),themes:[]};},{modelIdentity,promptRevision:prompts.profiling});
            const judge=createScriptedCoreferenceJudge(input=>{work.coreferenceCalls++;return {groups:[input.subjects.map(row=>row.id)],reasons:['The authored same-type claim descriptions identify one entity.']};},{modelIdentity,promptRevision:prompts.deduplication});
            const graphOptions={extractor,profiler,judge,embedder,budget:createBudgetAccount({turns:1000,tokens:1000000},()=>0),clock:()=>0,
                identities:{extraction:'structured-graph/1',chunker:{version:bundle.version.chunkerVersion,config:bundle.version.chunkerConfig},embedder:bundle.version.embeddedBy,prompts,model:modelIdentity}};
            let contribution:GraphContribution;
            if(promotion){const prepared=lightragMust(await promotion.prepare({document,graph:graphOptions}));if(prepared.status!=='prepared')throw Error('Expected a new fixture contribution.');contribution=prepared.contribution;lightragMust(await promotion.promote(prepared));}
            else{
                const resolver=createCandidateResolver({lookup:request=>graph.readContributionSnapshot(request),judge});
                contribution=lightragMust(await buildContribution({...graphOptions,chunks:bundle.chunks,sourceId:bundle.source.id,versionId:bundle.version.id,resolver,retiredClaimIds:active?[...active.entityClaimIds,...active.relationClaimIds]:[]}));
                const projection=lightragMust(await projectionForContribution(contribution)),head=active?.head??EMPTY_HEAD,plan=lightragMust(await planProjectionWrites({projection,contribution:contribution.plan,projections:await graph.listProjections({sourceId:bundle.source.id}),actualHead:head,expectedHead:head,at:clock}));
                // This private memory fixture has no observers during construction.
                // The SQLite variant exercises the joint transaction instead.
                await store.activate(bundle);lightragMust(await graph.apply(plan));
            }
            if(active){
                const after=new Map([...await graph.listEntities({status:'all'}),...await graph.listRelations({status:'all'})].map(row=>[row.id,row])),touched=new Set([...contribution.plan.touchedEntityIds,...contribution.plan.touchedRelationIds]);
                const unaffected=before.filter(row=>!touched.has(row.id)),retired=new Set(contribution.plan.input.retiredClaimIds),incoming=new Set(bundle.chunks.map(row=>row.id));
                const observation:GraphIncrementalObservation={fixtureId:loaded.fixtureId,source:source.key,previousVersion:versionKeys.get(active.versionId)!,version:version.key,chunks:bundle.chunks.length,reextractedChunks:extracted.length,
                    unrelatedChunksExtracted:extracted.filter(id=>!incoming.has(id)).length,canonicalsTouched:touched.size,unaffectedCanonicals:unaffected.length,unaffectedRevisionsChanged:unaffected.filter(row=>after.get(row.id)?.revision!==row.revision).length,
                    claimsWithdrawn:retired.size,withdrawnSupportRemaining:[...after.values()].filter(row=>row.status==='active').reduce((n,row)=>n+row.supportClaimIds.filter(id=>retired.has(id)).length,0),localCalls:contribution.spend.calls,budgetTokens:contribution.spend.tokens,providerCalls:0};
                if(observation.unrelatedChunksExtracted||observation.unaffectedRevisionsChanged||observation.withdrawnSupportRemaining)throw Error('Incremental fixture preparation changed unrelated evidence or retained withdrawn support.');
                incremental.push(observation);
            }
            stages.push({source:source.key,version:version.key,chunks:bundle.chunks.length,entityClaims:contribution.stats.entityClaims,relationClaims:contribution.stats.relationClaims,
                canonicalsTouched:contribution.plan.touchedEntityIds.length+contribution.plan.touchedRelationIds.length,profileUpdates:contribution.plan.input.profileUpdates.length,extractionPasses:work.extractionPasses-workBefore.extractionPasses,profileCalls:work.profiledCanonicals-workBefore.profiledCanonicals,
                coreferenceCalls:work.coreferenceCalls-workBefore.coreferenceCalls,documentEmbeddingCalls:work.documentEmbeddingCalls-workBefore.documentEmbeddingCalls,graphEmbeddingCalls:contribution.spend.calls,graphBudgetTokens:contribution.spend.tokens});
            contributions.push(contribution);indexing=addGraphSpend(indexing,contribution.spend);
        }
        const entityKeyById=new Map<string,string>(),relationKeyById=new Map<string,string>();
        if(graph){
            const entities=await graph.listEntities(),relations=await graph.listRelations();
            if(entities.length!==loaded.fixture.entities.length||relations.length!==loaded.fixture.relations.length)throw Error('The prepared fixture graph census changed.');
            for(const expected of loaded.fixture.entities){const found=entities.filter(row=>row.normalizedName===foldEntityName(expected.name)&&row.types[0]===expected.type);
                if(found.length!==1||JSON.stringify(found[0].supportChunkIds.map(id=>keyById.get(id)).sort())!==JSON.stringify([...expected.supportChunks].sort()))throw Error('The prepared fixture entity support changed: '+expected.key);
                entityKeyById.set(found[0].id,expected.key);
            }
            for(const expected of loaded.fixture.relations){const found=relations.filter(row=>entityKeyById.get(row.sourceEntityId)===expected.source&&entityKeyById.get(row.targetEntityId)===expected.target&&JSON.stringify(row.themes)===JSON.stringify(foldThemes(expected.themes)));
                if(found.length!==1||JSON.stringify(found[0].supportChunkIds.map(id=>keyById.get(id)).sort())!==JSON.stringify([...expected.supportChunks].sort()))throw Error('The prepared fixture relation support changed: '+expected.key);
                relationKeyById.set(found[0].id,expected.key);
            }
        }
        return {db,store,embedder,keyById,idByKey,graph,entityKeyById,relationKeyById,contributions,indexing,incremental,work,stages,close:()=>db.close()};
    }catch(cause){await db.close();throw cause;}
}
