/** Exact name/theme ranking, one explicit adjacency pass, and evidenced bounded context. */
import {equalsJson} from '@jarenjs/core/object';
import {cosineSimilarity,isVector} from '@jarenjs/core/vector';
import {sameIdentity} from '@tangleai/context/ledger';
import type {Embedder} from '@tangleai/models/embed';
import type {DocumentCorpusStore,DocumentChunk,DocumentSource} from '@tangleai/documents/contracts';
import type {DocumentCitation} from '@tangleai/documents';
import type {GraphEntity,GraphRelation,GraphProjection,LightRagCandidate,LightRagChunkContext,LightRagQueryPlan,LightRagLimits,LightRagRetrieval,LightRagEmbeddedBy} from './contracts.gen.ts';
import type {LightRagStore} from './store.ts';
import {embedGraphText} from './embed.ts';
import {validateLightRagQueryPlan,lightRagLevels} from './plan-query.ts';
import {lightRagLimits} from './limits.ts';
import {serializeLightRagContext} from './context.ts';
import {validateLightRagShape} from './schema.ts';
import {lightragRevisionOf,immutableLightRagJson} from './identity.ts';
import {emptyGraphSpend,addGraphSpend,graphStageFailure,type LightRagBudget,type LightRagClock,type LightRagStageOutcome} from './meter.ts';
import {lightragMust,lightragReject} from './errors.ts';
export interface LightRagRetrievalOptions {
    store:LightRagStore;documents:DocumentCorpusStore;embedder:Embedder;plan:LightRagQueryPlan;
    budget:LightRagBudget;clock:LightRagClock;limits?:Partial<LightRagLimits>;includeTimings?:boolean;
}
type GraphRow=GraphEntity|GraphRelation;
type Selection<T extends GraphRow>={row:T;score:number};
const compare=(a:{id:string;score:number},b:{id:string;score:number})=>b.score-a.score||(a.id<b.id?-1:a.id>b.id?1:0);
const ordered=<T extends GraphRow>(rows:Map<string,Selection<T>>)=>[...rows.values()].sort((a,b)=>compare({id:a.row.id,score:a.score},{id:b.row.id,score:b.score}));
const stamps=(projections:GraphProjection[])=>projections.map(row=>({id:row.id,sourceId:row.sourceId,versionId:row.versionId,contributionRevision:row.contributionRevision,head:row.head})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
/** Source heads determine the graph revision shown by retrieval and read surfaces. */
export const lightRagGraphRevisionOf=(projections:GraphProjection[])=>lightragRevisionOf(stamps(projections.filter(row=>row.status==='active')));
export async function retrieveLightRag(options:LightRagRetrievalOptions):Promise<LightRagStageOutcome<LightRagRetrieval>>{
    let spend=emptyGraphSpend();
    try{
        let last=-Infinity;const time=()=>{const now=options.clock();if(!Number.isFinite(now)||now<last)throw new TypeError('Retrieval requires a finite monotonic injected clock.');last=now;return now;};
        const started=time(),plan=lightragMust(validateLightRagQueryPlan(options.plan)),limits=lightRagLimits({...plan.limits,...options.limits});spend=plan.spend;
        if(plan.lowLevelKeywords.length>limits.keywordsPerLevel||plan.highLevelKeywords.length>limits.keywordsPerLevel)lightragReject('TLRAG1001','/limits/keywordsPerLevel','A smaller keyword bound requires a new keyword plan.');
        const levels=lightRagLevels(plan.mode),trace:LightRagCandidate[]=[],skipped={identity:0,width:0,unresolvable:0},skipIds=new Set<string>();
        const skip=(kind:LightRagCandidate['kind'],id:string,reason:keyof typeof skipped)=>{const key=kind+':'+id+':'+reason;if(!skipIds.has(key)){skipIds.add(key);skipped[reason]++;}};
        let identity:LightRagEmbeddedBy|undefined,lowVectors:number[][]=[],highVectors:number[][]=[];
        for(const [level,keywords]of [['low',levels.low?plan.lowLevelKeywords:[]],['high',levels.high?plan.highLevelKeywords:[]]]as const){
            if(!keywords.length)continue;
            const embedded=await embedGraphText({embedder:options.embedder,texts:keywords,budget:options.budget,clock:options.clock,expectedEmbeddedBy:identity});spend=addGraphSpend(spend,embedded.spend);
            if(!embedded.valid)return {...embedded,spend};identity=embedded.value.embeddedBy;if(level==='low')lowVectors=embedded.value.vectors;else highVectors=embedded.value.vectors;
        }
        const afterEmbedding=time(),projections=await options.store.listProjections({status:'active'}),before=stamps(projections);
        const selectedEntities=new Map<string,Selection<GraphEntity>>(),selectedRelations=new Map<string,Selection<GraphRelation>>();
        const validVector=(kind:'entity'|'relation',row:GraphRow):'identity'|'width'|null=>{
            if(!sameIdentity(row.embeddedBy,identity!)){skip(kind,row.id,'identity');return 'identity';}
            if(!isVector(row.embedding,identity!.dims)){skip(kind,row.id,'width');return 'width';}return null;
        };
        function select<T extends GraphRow>(selected:Map<string,Selection<T>>,row:T,score:number){const old=selected.get(row.id);if(!old||score>old.score)selected.set(row.id,{row,score});}
        function rank<T extends GraphRow>(kind:'entity'|'relation',rows:T[],keywords:string[],vectors:number[][],selected:Map<string,Selection<T>>){
            for(const [index,keyword]of keywords.entries()){
                const ranked:Array<{row:T;id:string;score:number}>=[];
                for(const row of rows){if(row.status!=='active')continue;const prune=validVector(kind,row);
                    if(prune){trace.push({id:row.id,kind,keyword,score:0,reason:kind==='entity'?'low':'high',fromId:null,prune});continue;}
                    ranked.push({row,id:row.id,score:cosineSimilarity(row.embedding,vectors[index])});
                }
                ranked.sort(compare);
                for(const [position,candidate]of ranked.entries()){
                    const prune=position>=limits.candidatesPerKeyword?'candidate-limit':null;
                    trace.push({id:candidate.id,kind,keyword,score:candidate.score,reason:kind==='entity'?'low':'high',fromId:null,prune});if(!prune)select(selected,candidate.row,candidate.score);
                }
            }
        }
        if(levels.low)rank('entity',await options.store.listEntities(),plan.lowLevelKeywords,lowVectors,selectedEntities);
        if(levels.high)rank('relation',await options.store.listRelations(),plan.highLevelKeywords,highVectors,selectedRelations);
        const afterRanking=time(),roots=new Map([...selectedEntities].map(([id,value])=>[id,value.score]));let addedEntities=0,addedRelations=0;
        const expandEntities=async(requests:Array<{id:string;score:number;fromId:string;root:boolean}>)=>{
            requests.sort((a,b)=>compare(a,b)||(a.fromId<b.fromId?-1:a.fromId>b.fromId?1:0));
            const found=new Map((await options.store.listEntities({ids:[...new Set(requests.map(row=>row.id))]})).map(row=>[row.id,row]));
            for(const request of requests){const row=found.get(request.id);let prune:LightRagCandidate['prune']=null;
                if(!row||row.status!=='active'){prune='unresolvable';skip('entity',request.id,'unresolvable');}
                else prune=validVector('entity',row);
                if(!prune&&!selectedEntities.has(request.id)&&addedEntities>=limits.expansionEntities)prune='expansion-limit';
                trace.push({id:request.id,kind:'entity',keyword:null,score:request.score,reason:'endpoint',fromId:request.fromId,prune});
                if(!prune&&row){if(!selectedEntities.has(row.id))addedEntities++;select(selectedEntities,row,request.score);if(request.root)roots.set(row.id,Math.max(roots.get(row.id)??-Infinity,request.score));}
            }
        };
        await expandEntities(ordered(selectedRelations).flatMap(({row,score})=>[row.sourceEntityId,row.targetEntityId].map(id=>({id,score,fromId:row.id,root:true}))));
        // Capture roots once. Endpoints added by this adjacency pass never become another frontier.
        const adjacent=(await options.store.listRelations({entityIds:[...roots.keys()]})).filter(row=>row.status==='active').map(row=>{
            const origins=[row.sourceEntityId,row.targetEntityId].filter(id=>roots.has(id)).sort((a,b)=>(roots.get(b)!-roots.get(a)!)||(a<b?-1:1));
            return {row,id:row.id,score:roots.get(origins[0])??-Infinity,fromId:origins[0]};
        }).filter(row=>row.fromId!==undefined).sort(compare),endpoints:Array<{id:string;score:number;fromId:string;root:boolean}>=[];
        for(const candidate of adjacent){let prune:LightRagCandidate['prune']=validVector('relation',candidate.row);
            if(!prune&&!selectedRelations.has(candidate.id)&&addedRelations>=limits.expansionRelations)prune='expansion-limit';
            trace.push({id:candidate.id,kind:'relation',keyword:null,score:candidate.score,reason:'one-hop',fromId:candidate.fromId,prune});
            if(!prune){if(!selectedRelations.has(candidate.id))addedRelations++;select(selectedRelations,candidate.row,candidate.score);for(const id of [candidate.row.sourceEntityId,candidate.row.targetEntityId])endpoints.push({id,score:candidate.score,fromId:candidate.id,root:false});}
        }
        await expandEntities(endpoints);const afterExpansion=time();
        const wanted=new Set([...selectedEntities.values(),...selectedRelations.values()].flatMap(value=>value.row.supportChunkIds));
        const active=new Map<string,{source:DocumentSource;chunk:DocumentChunk}>(),observedSources=new Map<string,string>();
        for(const projection of projections){if(!projection.chunkIds.some(id=>wanted.has(id)))continue;
            const source=await options.documents.getSource(projection.sourceId),version=await options.documents.getVersion(projection.versionId);
            if(source?.status!=='ready'||source.activeVersionId!==projection.versionId||version?.status!=='active'||version.sourceId!==source.id)continue;
            observedSources.set(source.id,version.id);
            for(const chunk of await options.documents.listChunks(version.id))if(wanted.has(chunk.id)&&chunk.sourceId===source.id&&chunk.versionId===version.id&&projection.chunkIds.includes(chunk.id)){
                const prior=active.get(chunk.id);if(prior&&!equalsJson(prior.chunk,chunk))lightragReject('TLRAG1003','/chunks','One citation address has conflicting document bytes.');active.set(chunk.id,{source,chunk});
            }
        }
        const mark=(kind:LightRagCandidate['kind'],id:string,prune:NonNullable<LightRagCandidate['prune']>)=>{for(const row of trace)if(row.kind===kind&&row.id===id&&row.prune===null)row.prune=prune;};
        for(const [kind,selected]of [['entity',selectedEntities],['relation',selectedRelations]]as const)for(const [id,{row}]of selected){
            if(!row.supportChunkIds.length||row.supportChunkIds.some(chunk=>!active.has(chunk))){selected.delete(id);mark(kind,id,'unresolvable');skip(kind,id,'unresolvable');}
        }
        const chunkScores=new Map<string,number>();
        for(const [kind,selected]of [['entity',selectedEntities],['relation',selectedRelations]]as const)for(const {row,score}of selected.values())for(const id of row.supportChunkIds){
            chunkScores.set(id,Math.max(chunkScores.get(id)??-Infinity,score));trace.push({id,kind:'chunk',keyword:null,score,reason:'support',fromId:row.id,prune:null});void kind;
        }
        const sourceCounts=new Map<string,number>(),candidates:LightRagChunkContext[]=[],citations:DocumentCitation[]=[];
        for(const {id,score}of [...chunkScores].map(([id,score])=>({id,score})).sort(compare)){
            const {source,chunk}=active.get(id)!,count=sourceCounts.get(source.id)??0;
            if(count>=limits.chunksPerSource){mark('chunk',id,'source-limit');continue;}sourceCounts.set(source.id,count+1);
            candidates.push({id,sourceId:source.id,versionId:chunk.versionId,text:chunk.text,score});
            citations.push({chunkId:id,sourceId:source.id,url:source.canonicalUrl,title:source.title,...(chunk.pageStart===undefined?{}:{page:chunk.pageStart}),headingPath:chunk.headingPath,elementIds:chunk.elementIds});
        }
        const allowed=new Set(citations.map(row=>row.chunkId));
        for(const [kind,selected]of [['entity',selectedEntities],['relation',selectedRelations]]as const)for(const [id,{row}]of selected)if(!row.supportChunkIds.some(chunk=>allowed.has(chunk))){selected.delete(id);mark(kind,id,'source-limit');}
        const afterResolution=time(),entities=ordered(selectedEntities).map(value=>value.row),relations=ordered(selectedRelations).map(value=>value.row),chunks=[...candidates];
        // Both hybrid modes select under the same full-context budget. The ablation
        // removes original text afterwards, preserving its exact citation targets.
        const selectionMode=plan.mode==='hybrid-no-original'?'hybrid':plan.mode;
        const render=()=>serializeLightRagContext({mode:selectionMode,entities,relations,chunks,citations});let bundle=render();
        for(const [kind,rows]of [['chunk',chunks],['relation',relations],['entity',entities]]as const){
            while(bundle.tokenCount>limits.contextTokens&&rows.length){const row=rows.pop()!;mark(kind,row.id,'context-budget');bundle=render();}
        }
        if(bundle.tokenCount>limits.contextTokens)lightragReject('TLRAG1008','/contextTokens','The complete context cannot satisfy the registered token bound.');
        const supplied=new Set(bundle.suppliedChunkIds),finalCitations=citations.filter(row=>supplied.has(row.chunkId));
        if(plan.mode==='hybrid-no-original'){for(const row of chunks)mark('chunk',row.id,'no-original');chunks.length=0;bundle=serializeLightRagContext({mode:plan.mode,entities,relations,chunks,citations:finalCitations});}
        const afterContext=time();
        if(!equalsJson(before,stamps(await options.store.listProjections({status:'active'}))))lightragReject('TLRAG1008','/graphRevision','The graph changed during retrieval; retry against the current source heads.');
        for(const [sourceId,versionId]of observedSources){const source=await options.documents.getSource(sourceId),version=await options.documents.getVersion(versionId);
            if(source?.status!=='ready'||source.activeVersionId!==versionId||version?.status!=='active')lightragReject('TLRAG1008','/documentVersion','The document evidence changed during retrieval.');}
        const graphRevision=await lightragRevisionOf(before),totalMs=time()-started;
        const value=lightragMust(validateLightRagShape('lightRagRetrieval',{mode:plan.mode,graphRevision,projectionIds:before.map(row=>row.id),plan,entities,relations,chunks,bundle,citations:finalCitations,trace,skipped,
            pruned:trace.filter(row=>row.prune!==null).length,spend,limits,...(options.includeTimings===false?{}:{timings:{embeddingMs:afterEmbedding-started,rankingMs:afterRanking-afterEmbedding,expansionMs:afterExpansion-afterRanking,resolutionMs:afterResolution-afterExpansion,contextMs:afterContext-afterResolution,totalMs}})}));
        return {valid:true,value:immutableLightRagJson(value),spend,attempts:spend.calls};
    }catch(cause){
        if(cause&&typeof cause==='object'&&'code'in cause&&cause.code==='JD2073'){
            try{lightragReject('TLRAG1008','/expansion','The native adjacency include exceeded its explicit bound.',cause);}catch(refusal){return graphStageFailure(refusal,spend,spend.calls);}
        }
        return graphStageFailure(cause,spend,spend.calls);
    }
}
