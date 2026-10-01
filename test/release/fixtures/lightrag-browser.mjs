/** Browser and installed runtimes exercise the same public zero-provider graph transaction. */
import { createMemoryLightRagStore, claimIdOf, canonicalEntityIdOf, canonicalGraphRevisionOf, contributionRevisionOf, projectionIdOf,
    planContribution, planProjectionWrites, lightragMust, foldEntityName, validateLightRagShape } from '@tangleai/lightrag';
import { EMPTY_HEAD } from '@tangleai/outcomes';
export async function qualifyLightRagBrowser(store=createMemoryLightRagStore()) {
    const sourceId='consumer-source',versionId='consumer-version',chunkId='consumer-chunk',embeddedBy={model:'fixture-names',dims:2},modelIdentity={provider:'fixture',model:'scripted'};
    const body={sourceId,versionId,chunkId,ordinal:0,name:'Ｃｅｄａｒ',normalizedName:foldEntityName('Ｃｅｄａｒ'),type:'ORGANIZATION',description:'Cedar maintains the workshop register.',promptRevision:'a'.repeat(64),modelIdentity,extractedAt:null};
    const claim={...body,id:await claimIdOf(body)};
    const entityBody={id:await canonicalEntityIdOf(body.name,body.type),name:body.name,normalizedName:body.normalizedName,aliases:[],types:[body.type],profile:body.description,
        supportClaimIds:[claim.id],supportChunkIds:[chunkId],embedding:[1,0],embeddedBy,status:'active'};
    const entity={...entityBody,revision:await canonicalGraphRevisionOf(entityBody)};
    const claims={entities:[claim],relations:[]},profiles=[{chunkId,versionId,keywords:['workshop'],promptRevision:claim.promptRevision}];
    const contribution=lightragMust(await planContribution({claims,profiles,chunks:[{id:chunkId,sourceId,versionId}],existing:{claims:{entities:[],relations:[]},canonicals:{entities:[],relations:[]}},
        candidates:{entities:[entity],relations:[]},retiredClaimIds:[],merges:[],reviews:[],profileUpdates:[],embeddedBy}));
    const identities={extraction:'fixture/1',chunker:{version:'fixture/1',config:{maxTokens:100,overlapTokens:32}},embedder:embeddedBy,prompts:{extraction:claim.promptRevision},model:modelIdentity};
    const contributionRevision=await contributionRevisionOf({sourceId,versionId,claims,profiles,identities});
    const projection={id:await projectionIdOf(sourceId,versionId,contributionRevision),sourceId,versionId,contributionRevision,head:{...EMPTY_HEAD},status:'staged',identities,
        counts:{claims:1,entities:1,relations:0,canonicalsTouched:1,chunks:1},spend:{calls:0,tokens:0,ms:0},entityClaimIds:[claim.id],relationClaimIds:[],chunkIds:[chunkId]};
    const plan=lightragMust(await planProjectionWrites({projection,contribution,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null}));
    const applied=lightragMust(await store.apply(plan)),replay=lightragMust(await store.apply(plan)),active=await store.activeProjectionFor(sourceId),entities=await store.listEntities();
    if(!active||entities.length!==1)throw Error('The graph activation did not retain its entity.');
    return {writes:applied.writes,replayWrites:replay.writes,newClaims:applied.newClaims,revision:active.head.revision,entities:entities.length,
        support:entities[0].supportChunkIds,fold:foldEntityName('Ｃｅｄａｒ'),shape:validateLightRagShape('graphProjection',active).valid};
}

import { buildContribution,validateGraphContribution,createScriptedExtractor,createScriptedProfiler,createCandidateResolver,createScriptedCoreferenceJudge,lightRagPrompt } from '@tangleai/lightrag';
import { createBudgetAccount } from '@tangleai/agents';
import { createHashEmbedder } from '@tangleai/models';
import promptArtifacts from '@tangleai/lightrag/artifacts' with {type:'json'};
export async function qualifyLightRagPreparation(){
    const modelIdentity={provider:'fixture',model:'scripted'},embedder=createHashEmbedder({dims:8}),budget=createBudgetAccount({turns:4},()=>0);
    const prompts={extraction:lightRagPrompt('graph-extractor').revision,profiling:lightRagPrompt('graph-profiler').revision,deduplication:lightRagPrompt('graph-deduplicator').revision};
    const chunk={id:'prepared-chunk',sourceId:'prepared-source',versionId:'prepared-version',text:'Cedar shares equipment with Willow.',elementIds:['prepared-element'],order:0,tokenCount:8,headingPath:[],embedding:[1,0],embeddedBy:{model:'document-fixture',dims:2}};
    const reply={entities:[{name:'Cedar',type:'ORGANIZATION',description:'Cedar maintains the equipment.'},{name:'Willow',type:'ORGANIZATION',description:'Willow uses the equipment.'}],relations:[{source:'Cedar',target:'Willow',description:'Cedar shares equipment with Willow.',themes:['equipment sharing'],strength:1}],contentKeywords:['equipment']};
    let lookups=0;
    const extractor=createScriptedExtractor({[chunk.id]:reply},{modelIdentity,promptRevision:prompts.extraction});
    const profiler=createScriptedProfiler(input=>({profile:input.contexts.map(row=>row.description).join(' '),themes:[]}),{modelIdentity,promptRevision:prompts.profiling});
    const judge=createScriptedCoreferenceJudge(()=>{throw Error('Distinct graph names cannot request co-reference.');},{modelIdentity,promptRevision:prompts.deduplication});
    const resolver=createCandidateResolver({lookup:async()=>{lookups++;return {claims:{entities:[],relations:[]},canonicals:{entities:[],relations:[]}};},judge});
    const bundle=lightragMust(await buildContribution({chunks:[chunk],extractor,profiler,resolver,embedder,budget,clock:()=>0,identities:{extraction:'structured-graph/1',chunker:{version:'fixture/1',config:{maxTokens:100,overlapTokens:32}},embedder:{model:embedder.model,dims:8},prompts,model:modelIdentity}}));
    return {entities:bundle.stats.entities,relations:bundle.stats.relations,claims:bundle.stats.entityClaims+bundle.stats.relationClaims,embeddingCalls:bundle.stats.embeddingCalls,
        calls:bundle.spend.calls,decisions:bundle.stats.decisions,partial:bundle.partial,lookups,packs:promptArtifacts.packs.length,valid:(await validateGraphContribution(bundle)).valid};
}

import {createScriptedPlanner,retrieveLightRag,serializeLightRagContext} from '@tangleai/lightrag';
export async function qualifyLightRagRetrieval(){
    const store=createMemoryLightRagStore();await qualifyLightRagBrowser(store);
    const source={id:'consumer-source',status:'ready',activeVersionId:'consumer-version',canonicalUrl:'https://docs.example/cedar',title:'Cedar register'},version={id:'consumer-version',sourceId:source.id,status:'active'};
    const chunk={id:'consumer-chunk',sourceId:source.id,versionId:version.id,text:'Cedar maintains the workshop register.',headingPath:[],elementIds:['consumer-element']};
    const documents={getSource:async id=>id===source.id?source:undefined,getVersion:async id=>id===version.id?version:undefined,listChunks:async id=>id===version.id?[chunk]:[]};
    const planner=createScriptedPlanner(()=>({lowLevelKeywords:['Cedar'],highLevelKeywords:['workshop']})),embedder={model:'fixture-names',dims:2,embed:async texts=>texts.map(()=>new Float32Array([1,0]))};
    async function run(mode){const plan=lightragMust(await planner('Who maintains the register?',{mode}));return lightragMust(await retrieveLightRag({store,documents,embedder,plan,budget:createBudgetAccount({turns:2,tokens:1000},()=>0),clock:()=>0,includeTimings:false}));}
    const low=await run('low'),hybrid=await run('hybrid'),noOriginal=await run('hybrid-no-original');
    if(JSON.stringify(serializeLightRagContext(low))!==JSON.stringify(low.bundle))throw Error('The public serializer changed retrieval bytes.');
    return {entities:low.entities.length,citations:low.citations.length,localCalls:low.spend.calls,withinBudget:low.bundle.tokenCount<=low.limits.contextTokens,
        noOriginal:noOriginal.bundle.sections.chunks==='',sameCitations:JSON.stringify(hybrid.citations)===JSON.stringify(noOriginal.citations),timingsOmitted:low.timings===undefined};
}
