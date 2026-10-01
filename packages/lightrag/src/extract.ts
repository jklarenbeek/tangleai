/** Extraction binds validated observations to immutable document provenance. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import type { DocumentChunk } from '@tangleai/documents/contracts';
import type { GraphExtractionReply,GraphClaimSet,GraphChunkProfile,GraphEntityClaim,LightRagModelIdentity } from './contracts.gen.ts';
import { validateLightRagShape } from './schema.ts';
import { claimIdOf,immutableLightRagJson } from './identity.ts';
import { foldEntityName,foldThemes } from './normalize.ts';
import { lightragMust,lightragReject } from './errors.ts';
import { emptyGraphSpend,addGraphSpend,graphStageFailure,type LightRagBudget,type LightRagStageOutcome } from './meter.ts';
import { runStructuredGraph,graphClientIdentity,type StructuredGraphOptions } from './structured.ts';
export const GRAPH_ENTITY_TYPES=Object.freeze(['PERSON','ORGANIZATION','CONCEPT','LOCATION','EVENT','TECHNOLOGY','OTHER'] as const);
export interface GraphExtractionOptions {gleaning?:number;entityTypes?:readonly GraphEntityClaim['type'][];}
export interface GraphExtractionValue {claims:GraphClaimSet;profile:GraphChunkProfile;warnings:string[];}
export interface Extractor {
    (chunk:DocumentChunk,options?:GraphExtractionOptions):Promise<LightRagStageOutcome<GraphExtractionValue>>;
    readonly modelIdentity:LightRagModelIdentity;readonly promptRevision:string;readonly budget:LightRagBudget|null;
}
const emptyReply=():GraphExtractionReply=>({entities:[],relations:[],contentKeywords:[]});
function mergeReplies(prior:GraphExtractionReply,next:GraphExtractionReply):GraphExtractionReply {
    const unique=<T>(rows:T[]):T[]=>[...new Map(rows.map(row=>[canonicalizeJson(row),row])).values()];
    return {entities:unique([...prior.entities,...next.entities]),relations:unique([...prior.relations,...next.relations]),contentKeywords:foldThemes([...prior.contentKeywords,...next.contentKeywords])};
}
function extractionGate(value:unknown,previous:GraphExtractionReply,types:readonly string[]){
    const shape=validateLightRagShape('graphExtractionReply',value);if(!shape.valid)return {valid:false,errors:shape.issues.map(issue=>({instancePath:issue.path,message:issue.detail}))};
    const result=mergeReplies(previous,shape.value),names=new Set(result.entities.map(row=>foldEntityName(row.name)));
    const invalid=result.entities.some(row=>!foldEntityName(row.name)||!row.description.trim()||!types.includes(row.type))
        ||result.relations.some(row=>!names.has(foldEntityName(row.source))||!names.has(foldEntityName(row.target))||!row.description.trim()||foldThemes(row.themes).length===0);
    return invalid?{valid:false,errors:[{instancePath:'/entities',message:'Every typed entity and directed relation must have nonblank content and endpoints extracted from this chunk.'}]}:{valid:true};
}
async function claimsFrom(chunk:DocumentChunk,reply:GraphExtractionReply,promptRevision:string,modelIdentity:LightRagModelIdentity,at:string|null):Promise<GraphExtractionValue>{
    const claims:GraphClaimSet={entities:[],relations:[]};
    const base={sourceId:chunk.sourceId,versionId:chunk.versionId,chunkId:chunk.id,promptRevision,modelIdentity,extractedAt:at};
    for(const [ordinal,entity]of reply.entities.entries()){
        const body={...base,...entity,normalizedName:foldEntityName(entity.name),ordinal};
        claims.entities.push(lightragMust(validateLightRagShape('graphEntityClaim',{...body,id:await claimIdOf(body)})));
    }
    for(const [ordinal,relation]of reply.relations.entries()){
        const body={...base,ordinal,sourceName:relation.source,targetName:relation.target,normalizedSource:foldEntityName(relation.source),normalizedTarget:foldEntityName(relation.target),themes:foldThemes(relation.themes),strength:relation.strength,description:relation.description};
        claims.relations.push(lightragMust(validateLightRagShape('graphRelationClaim',{...body,id:await claimIdOf(body)})));
    }
    return immutableLightRagJson({claims,profile:{chunkId:chunk.id,versionId:chunk.versionId,keywords:foldThemes(reply.contentKeywords),promptRevision},warnings:[]});
}
function extractionOptions(options:GraphExtractionOptions){
    const gleaning=options.gleaning??1,entityTypes=options.entityTypes??GRAPH_ENTITY_TYPES;
    if(!Number.isInteger(gleaning)||gleaning<0||gleaning>16||!entityTypes.length||new Set(entityTypes).size!==entityTypes.length||entityTypes.some(type=>!GRAPH_ENTITY_TYPES.includes(type)))
        throw new TypeError('Graph extraction needs zero to sixteen gleaning passes and distinct allowed entity types.');
    return {gleaning,entityTypes};
}
export function createStructuredExtractor(options:StructuredGraphOptions&{now?:()=>string|null}):Extractor {
    if(options.artifact.role!=='graph-extractor')throw new TypeError('An extractor requires the extraction artifact.');
    const modelIdentity=graphClientIdentity(options.client),promptRevision=options.artifact.revision;
    const extract=async(chunk:DocumentChunk,settings:GraphExtractionOptions={}):Promise<LightRagStageOutcome<GraphExtractionValue>>=>{
        const {gleaning,entityTypes}=extractionOptions(settings);let reply=emptyReply(),spend=emptyGraphSpend(),attempts=0;
        try{
            for(let pass=0;pass<=gleaning;pass++){
                const input={chunk:{id:chunk.id,sourceId:chunk.sourceId,versionId:chunk.versionId,text:chunk.text,order:chunk.order},entityTypes:[...entityTypes],pass,previous:reply};
                const result=await runStructuredGraph(options,input,value=>extractionGate(value,reply,entityTypes));spend=addGraphSpend(spend,result.spend);attempts+=result.attempts;
                if(!result.valid)return {...result,spend,attempts};
                reply=mergeReplies(reply,lightragMust(validateLightRagShape('graphExtractionReply',result.value)));
            }
            return {valid:true,value:await claimsFrom(chunk,reply,promptRevision,modelIdentity,options.now?.()??null),spend,attempts};
        }catch(cause){return graphStageFailure(cause,spend,attempts);}
    };
    return Object.assign(extract,{modelIdentity,promptRevision,budget:options.budget});
}
export function createScriptedExtractor(replies:Readonly<Record<string,unknown>>,options:{promptRevision:string;modelIdentity:LightRagModelIdentity;now?:()=>string|null}):Extractor {
    const modelIdentity=immutableLightRagJson(options.modelIdentity),promptRevision=options.promptRevision;
    const extract=async(chunk:DocumentChunk,settings:GraphExtractionOptions={}):Promise<LightRagStageOutcome<GraphExtractionValue>>=>{
        const {gleaning,entityTypes}=extractionOptions(settings);let attempts=0;
        try{
            if(!Object.hasOwn(replies,chunk.id))lightragReject('TLRAG1003','/chunkId','No scripted extraction is registered for this chunk.');
            const declared=replies[chunk.id],passes=Array.isArray(declared)?declared:[declared];let reply=emptyReply();
            for(let pass=0;pass<=gleaning;pass++){
                const value=pass<passes.length?passes[pass]:emptyReply();attempts++;
                const gate=extractionGate(value,reply,entityTypes);if(!gate.valid)lightragReject('TLRAG1004','/reply','The scripted extraction reply is incomplete or invalid.');
                reply=mergeReplies(reply,lightragMust(validateLightRagShape('graphExtractionReply',value)));
            }
            return {valid:true,value:await claimsFrom(chunk,reply,promptRevision,modelIdentity,options.now?.()??null),spend:emptyGraphSpend(),attempts};
        }catch(cause){return graphStageFailure(cause,emptyGraphSpend(),attempts);}
    };
    return Object.assign(extract,{modelIdentity,promptRevision,budget:null});
}
