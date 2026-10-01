/** Graph observations supplement the existing chunk relevance scorer. */
import {mean} from '@jarenjs/core/stats';
import type {LightRagRetrieval} from '@tangleai/lightrag';
import type {Case,GraphCase,GraphMetrics,RowGraph,Question,PruneCounts} from './lightrag.types.ts';
export const graphPrunes=():PruneCounts=>({identity:0,width:0,unresolvable:0,'expansion-limit':0,'source-limit':0,'context-budget':0,'no-original':0,'candidate-limit':0});
export function graphMetrics(cases:Case[]):GraphMetrics{
    const entities=cases.flatMap(row=>row.graph?.entityRecall==null?[]:[row.graph.entityRecall]),relations=cases.flatMap(row=>row.graph?.relationRecall==null?[]:[row.graph.relationRecall]);
    return {entityRecall:mean(entities)??null,relationRecall:mean(relations)??null,entityQuestions:entities.length,relationQuestions:relations.length};
}
export function observeGraphCase(question:Question,value:LightRagRetrieval,maps:{keyById:Map<string,string>;entityKeyById:Map<string,string>;relationKeyById:Map<string,string>}){
    const key=(map:Map<string,string>,id:string)=>{const found=map.get(id);if(!found)throw Error('A graph result has an unregistered identity: '+id);return found;};
    const entities=value.entities.map(row=>key(maps.entityKeyById,row.id)),relations=value.relations.map(row=>key(maps.relationKeyById,row.id)),scores=new Map<string,number>();
    for(const candidate of value.trace)if(candidate.kind==='chunk')scores.set(candidate.id,Math.max(scores.get(candidate.id)??-Infinity,candidate.score));
    const ranked=[...value.bundle.suppliedChunkIds].sort((a,b)=>(scores.get(b)!-scores.get(a)!)||(a<b?-1:a>b?1:0)).map(id=>key(maps.keyById,id));
    const recall=(gold:string[],selected:string[])=>gold.length?gold.filter(id=>selected.includes(id)).length/gold.length:null,prune=graphPrunes();
    for(const candidate of value.trace)if(candidate.prune)prune[candidate.prune]++;
    const graph:GraphCase={entities,relations,goldEntities:question.goldEntities,goldRelations:question.goldRelations,entityRecall:recall(question.goldEntities,entities),relationRecall:recall(question.goldRelations,relations),
        candidates:{entityKeywords:value.trace.filter(row=>row.reason==='low').length,relationKeywords:value.trace.filter(row=>row.reason==='high').length,endpoints:value.trace.filter(row=>row.reason==='endpoint').length,oneHop:value.trace.filter(row=>row.reason==='one-hop').length},
        prune,skipped:value.skipped,localCalls:value.spend.calls,budgetTokens:value.spend.tokens,contextTokens:value.bundle.tokenCount,originalChunks:value.chunks.length};
    return {ranked,graph,skipped:Object.values(value.skipped).reduce((n,value)=>n+value,0)};
}
export function observeGraphRow(mode:LightRagRetrieval['mode'],cases:Case[]):RowGraph{
    const row:RowGraph={candidateSources:{entityKeywords:mode!=='high',relationKeywords:mode!=='low',originalChunks:mode!=='hybrid-no-original'},candidates:{entityKeywords:0,relationKeywords:0,endpoints:0,oneHop:0},prune:graphPrunes(),skipped:{identity:0,width:0,unresolvable:0},localCalls:0,budgetTokens:0};
    for(const {graph}of cases){if(!graph)throw Error('A graph row cannot omit a measured case.');
        for(const key of Object.keys(row.candidates)as Array<keyof RowGraph['candidates']>)row.candidates[key]+=graph.candidates[key];
        for(const key of Object.keys(row.prune)as Array<keyof RowGraph['prune']>)row.prune[key]+=graph.prune[key];
        for(const key of Object.keys(row.skipped)as Array<keyof RowGraph['skipped']>)row.skipped[key]+=graph.skipped[key];
        row.localCalls+=graph.localCalls;row.budgetTokens+=graph.budgetTokens;
    }return row;
}
