/** One structured keyword planner; an empty required level never becomes a whole-query vector. */
import {equalsJson} from '@jarenjs/core/object';
import type {GraphKeywordReply,LightRagQueryPlan,LightRagMode,LightRagLimits,LightRagModelIdentity} from './contracts.gen.ts';
import {foldThemes} from './normalize.ts';
import {lightRagPrompt} from './catalog.ts';
import {lightRagLimits} from './limits.ts';
import {validateLightRagShape} from './schema.ts';
import {immutableLightRagJson} from './identity.ts';
import {runStructuredGraph,graphClientIdentity,type StructuredGraphOptions} from './structured.ts';
import {emptyGraphSpend,graphStageFailure,type LightRagBudget,type LightRagStageOutcome} from './meter.ts';
import {lightragMust,lightragReject,lightragFailure,type LightRagOutcome} from './errors.ts';
export interface LightRagQueryOptions {mode:LightRagMode;limits?:Partial<LightRagLimits>;}
export interface KeywordPlanner {
    (query:string,options:LightRagQueryOptions):Promise<LightRagStageOutcome<LightRagQueryPlan>>;
    readonly promptRevision:string;readonly modelIdentity:LightRagModelIdentity;readonly budget:LightRagBudget|null;
}
export const lightRagLevels=(mode:LightRagMode)=>({low:mode!=='high',high:mode!=='low'});
function keywords(reply:GraphKeywordReply,limit:number):GraphKeywordReply{return {lowLevelKeywords:foldThemes(reply.lowLevelKeywords).slice(0,limit),highLevelKeywords:foldThemes(reply.highLevelKeywords).slice(0,limit)};}
function missing(reply:GraphKeywordReply,mode:LightRagMode):boolean{const levels=lightRagLevels(mode);return levels.low&&!reply.lowLevelKeywords.length||levels.high&&!reply.highLevelKeywords.length;}
function queryInput(query:string,options:LightRagQueryOptions){
    const limits=lightRagLimits(options.limits),input=lightragMust(validateLightRagShape('graphKeywordInput',{query,mode:options.mode,maxKeywords:limits.keywordsPerLevel}));
    if(!query.trim())lightragReject('TLRAG1001','/query','The graph query must contain text.');return {input,limits};
}
export function validateLightRagQueryPlan(value:unknown):LightRagOutcome<LightRagQueryPlan>{
    try{
        const plan=lightragMust(validateLightRagShape('lightRagQueryPlan',value)),{limits}=queryInput(plan.query,{mode:plan.mode,limits:plan.limits}),folded=keywords(plan,limits.keywordsPerLevel);
        if(!equalsJson(folded.lowLevelKeywords,plan.lowLevelKeywords)||!equalsJson(folded.highLevelKeywords,plan.highLevelKeywords))lightragReject('TLRAG1001','/keywords','A query plan must carry folded, distinct keywords inside its recorded limit.');
        if(missing(folded,plan.mode))lightragReject('TLRAG1008','/keywords','The requested mode has an empty required keyword level.');return {valid:true,value:plan};
    }catch(cause){return lightragFailure(cause);}
}
export function createKeywordPlanner(options:StructuredGraphOptions):KeywordPlanner{
    if(options.artifact.role!=='graph-planner')throw new TypeError('Keyword planning requires a graph-planner artifact.');
    const modelIdentity=graphClientIdentity(options.client),promptRevision=options.artifact.revision;
    const plan:KeywordPlanner=Object.assign(async(query:string,request:LightRagQueryOptions):Promise<LightRagStageOutcome<LightRagQueryPlan>>=>{
        let observedEmpty=false,spend=emptyGraphSpend(),attempts=0;
        try{
            const {input,limits}=queryInput(query,request),result=await runStructuredGraph(options,input,value=>{
                const reply=lightragMust(validateLightRagShape('graphKeywordReply',value));observedEmpty=missing(keywords(reply,limits.keywordsPerLevel),input.mode);
                return observedEmpty?{valid:false,errors:[{instancePath:'/keywords',message:'Provide nonempty keywords for every level required by this mode.'}]}:{valid:true};
            });
            spend=result.spend;attempts=result.attempts;
            if(!result.valid)return observedEmpty&&result.issues[0].code==='TLRAG1004'?{...result,issues:[{code:'TLRAG1008',path:'/keywords',detail:'A required keyword level remains empty after bounded repair.'}],stopReason:'TLRAG1008'}:result;
            const reply=keywords(lightragMust(validateLightRagShape('graphKeywordReply',result.value)),limits.keywordsPerLevel);
            const value=lightragMust(validateLightRagQueryPlan({query,mode:input.mode,...reply,promptRevision,modelIdentity,limits,spend:result.spend}));
            return {...result,value};
        }catch(cause){return graphStageFailure(cause,spend,attempts);}
    },{modelIdentity,promptRevision,budget:options.budget});
    return plan;
}
export interface ScriptedKeywordQuestion {text:string;lowKeywords:readonly string[];highKeywords:readonly string[];}
export function createScriptedPlanner(replies:readonly ScriptedKeywordQuestion[]|((query:string,mode:LightRagMode)=>unknown|Promise<unknown>),options:{modelIdentity?:LightRagModelIdentity;promptRevision?:string}={}):KeywordPlanner{
    const modelIdentity=immutableLightRagJson(options.modelIdentity??{provider:'fixture',model:'scripted'}),promptRevision=options.promptRevision??lightRagPrompt('graph-planner').revision;
    const rows=typeof replies==='function'?null:new Map(replies.map(row=>[row.text,row]));if(rows&&rows.size!==(replies as readonly ScriptedKeywordQuestion[]).length)throw new TypeError('Scripted keyword queries must be distinct.');
    return Object.assign(async(query:string,request:LightRagQueryOptions):Promise<LightRagStageOutcome<LightRagQueryPlan>>=>{
        try{
            const {input,limits}=queryInput(query,request),row=rows?.get(query),raw=typeof replies==='function'?await replies(query,input.mode):row?{lowLevelKeywords:row.lowKeywords,highLevelKeywords:row.highKeywords}:undefined;
            if(raw===undefined)lightragReject('TLRAG1008','/query','No registered keyword plan exists for this query.');
            const checked=validateLightRagShape('graphKeywordReply',raw);if(!checked.valid)lightragReject('TLRAG1004','/keywords','The scripted keyword reply is invalid.');
            const spend=emptyGraphSpend(),value=lightragMust(validateLightRagQueryPlan({query,mode:input.mode,...keywords(checked.value,limits.keywordsPerLevel),promptRevision,modelIdentity,limits,spend}));
            return {valid:true,value,spend,attempts:1};
        }catch(cause){return graphStageFailure(cause,emptyGraphSpend(),1);}
    },{modelIdentity,promptRevision,budget:null});
}
