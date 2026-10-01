/** Profiles read deterministic bounded evidence; every omitted context stays observable. */
import type { GraphEntityClaim,GraphRelationClaim,GraphProfileInput,GraphProfileReply,LightRagModelIdentity } from './contracts.gen.ts';
import { validateLightRagShape } from './schema.ts';
import { lightragMust,lightragReject } from './errors.ts';
import { foldThemes } from './normalize.ts';
import { immutableLightRagJson } from './identity.ts';
import { emptyGraphSpend,graphStageFailure,type LightRagBudget,type LightRagStageOutcome } from './meter.ts';
import { runStructuredGraph,graphClientIdentity,type StructuredGraphOptions } from './structured.ts';
export interface GraphProfileRequest {kind:'entity'|'relation';name:string;claims:readonly(GraphEntityClaim|GraphRelationClaim)[];}
export interface GraphProfileValue extends GraphProfileReply {basisClaimIds:string[];usedClaimIds:string[];omittedClaimIds:string[];}
export interface Profiler {
    (request:GraphProfileRequest):Promise<LightRagStageOutcome<GraphProfileValue>>;
    readonly modelIdentity:LightRagModelIdentity;readonly promptRevision:string;readonly budget:LightRagBudget|null;
}
export function graphProfileInput(request:GraphProfileRequest,maxContexts:number=32):{input:GraphProfileInput;basisClaimIds:string[];usedClaimIds:string[];omittedClaimIds:string[]}{
    if(!Number.isInteger(maxContexts)||maxContexts<1||maxContexts>128)throw new TypeError('Graph profiling requires one to 128 contexts.');
    if(!request.claims.length||new Set(request.claims.map(row=>row.id)).size!==request.claims.length)lightragReject('TLRAG1003','/claims','A profile needs distinct evidenced claim contexts.');
    const ordered=[...request.claims].sort((a,b)=>a.ordinal-b.ordinal||(a.chunkId<b.chunkId?-1:a.chunkId>b.chunkId?1:0)||(a.id<b.id?-1:1));
    const used=ordered.slice(0,maxContexts),input=lightragMust(validateLightRagShape('graphProfileInput',{kind:request.kind,name:request.name,contexts:used.map(row=>({claimId:row.id,chunkId:row.chunkId,ordinal:row.ordinal,description:row.description}))}));
    return {input,basisClaimIds:request.claims.map(row=>row.id).sort(),usedClaimIds:used.map(row=>row.id),omittedClaimIds:ordered.slice(maxContexts).map(row=>row.id)};
}
function checkedProfile(value:unknown):GraphProfileReply{
    const checked=validateLightRagShape('graphProfileReply',value);
    if(!checked.valid||!checked.value.profile.trim())lightragReject('TLRAG1004','/profile','The profile reply is incomplete or invalid.');
    return {...checked.value,themes:foldThemes(checked.value.themes)};
}
export function createStructuredProfiler(options:StructuredGraphOptions&{maxContexts?:number}):Profiler{
    if(options.artifact.role!=='graph-profiler')throw new TypeError('A profiler requires the profiling artifact.');
    const modelIdentity=graphClientIdentity(options.client),promptRevision=options.artifact.revision;
    const profile=async(request:GraphProfileRequest):Promise<LightRagStageOutcome<GraphProfileValue>>=>{
        let spend=emptyGraphSpend(),attempts=0;
        try{
            const {input,...basis}=graphProfileInput(request,options.maxContexts);
            const result=await runStructuredGraph(options,input,value=>{const checked=validateLightRagShape('graphProfileReply',value);return checked.valid&&checked.value.profile.trim()?{valid:true}:{valid:false,errors:[{instancePath:'/profile',message:'A nonblank profile is required.'}]};});
            spend=result.spend;attempts=result.attempts;
            if(!result.valid)return result;
            return {...result,value:immutableLightRagJson({...checkedProfile(result.value),...basis})};
        }catch(cause){return graphStageFailure(cause,spend,attempts);}
    };
    return Object.assign(profile,{modelIdentity,promptRevision,budget:options.budget});
}
export function createScriptedProfiler(reply:(input:GraphProfileInput)=>unknown|Promise<unknown>,options:{promptRevision:string;modelIdentity:LightRagModelIdentity;maxContexts?:number}):Profiler{
    const modelIdentity=immutableLightRagJson(options.modelIdentity),promptRevision=options.promptRevision;
    const profile=async(request:GraphProfileRequest):Promise<LightRagStageOutcome<GraphProfileValue>>=>{
        try{const {input,...basis}=graphProfileInput(request,options.maxContexts);const value=checkedProfile(await reply(input));return {valid:true,value:immutableLightRagJson({...value,...basis}),spend:emptyGraphSpend(),attempts:1};}
        catch(cause){return graphStageFailure(cause,emptyGraphSpend(),1);}
    };
    return Object.assign(profile,{modelIdentity,promptRevision,budget:null});
}
