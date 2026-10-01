/** Experimental graph reads resolve settings without persisting run or identity records. */
import {createBudgetAccount} from '@tangleai/agents';
import {createKeywordPlanner,createLightRagRetriever,lightRagPrompt,lightRagGraphRevisionOf,lightragMust,lightragReject,lightragFailure,emptyGraphSpend,type KeywordPlanner,type LightRagStore,type LightRagMode,type LightRagClock,type LightRagBudget} from '@tangleai/lightrag';
import type {DocumentCorpusStore} from '@tangleai/documents';
import type {SettingsStore,Settings} from './settings.ts';
import type {HostStack,StackOptions} from './ai-host.ts';
export type LightRagPlannerFactory=(stack:Exclude<HostStack,{state:'refused'}>,budget:LightRagBudget,clock:LightRagClock)=>KeywordPlanner|null;
export interface DesktopLightRagOptions {plannerFor?:LightRagPlannerFactory;}
export const LIGHTRAG_DESKTOP_BUDGET=Object.freeze({turns:4,tokens:16000,ms:30000});
export function createDesktopLightRag(options:{store:LightRagStore;documents:DocumentCorpusStore;settings:SettingsStore;stackFor:(settings:Settings,options:StackOptions)=>Promise<HostStack>;clock:LightRagClock;fetch?:typeof globalThis.fetch;plannerFor?:LightRagPlannerFactory}){
    return {
        async status(){
            try{
                const projections=await options.store.listProjections(),graphRevision=await lightRagGraphRevisionOf(projections),active=projections.filter(row=>row.status==='active'),entities=await options.store.listEntities(),relations=await options.store.listRelations();
                if(graphRevision!==await lightRagGraphRevisionOf(await options.store.listProjections()))lightragReject('TLRAG1008','/graphRevision','The graph changed during status inspection; retry.');
                const identities=new Map(active.map(row=>[JSON.stringify(row.identities.embedder),row.identities.embedder])),prompts:Record<string,string[]>={};
                for(const row of active)for(const [role,revision]of Object.entries(row.identities.prompts)){const values=prompts[role]??=[];if(!values.includes(revision))values.push(revision);}
                for(const values of Object.values(prompts))values.sort();
                return {experimental:true as const,status:'ok' as const,graphRevision,projections:projections.map(row=>({sourceId:row.sourceId,versionId:row.versionId,graphRevision:row.contributionRevision,status:row.status,counts:row.counts})),
                    graph:{entities:entities.length,relations:relations.length,claims:new Set(active.flatMap(row=>[...row.entityClaimIds,...row.relationClaimIds])).size},embeddedBy:[...identities].sort(([a],[b])=>a<b?-1:1).map(([,value])=>value),promptRevisions:prompts};
            }catch(cause){const failure=lightragFailure(cause);if(failure.valid)throw Error('Expected refusal.');return {experimental:true as const,status:'refused' as const,issues:failure.issues};}
        },
        async retrieve(input:{q:string;mode:LightRagMode;limit?:number}){
            let graphRevision=await lightRagGraphRevisionOf([]),spend=emptyGraphSpend();
            const refused=(issues:unknown[])=>({experimental:true as const,status:'refused' as const,mode:input.mode,graphRevision,spend,issues});
            try{
                graphRevision=await lightRagGraphRevisionOf(await options.store.listProjections({status:'active'}));
                // Ordinary resolution makes no probes and receives no persistence callback.
                const stack=await options.stackFor(await options.settings.read(),{fetch:options.fetch});if(stack.state==='refused')return refused(stack.issues);
                const budget=createBudgetAccount(LIGHTRAG_DESKTOP_BUDGET,options.clock),planner=options.plannerFor?options.plannerFor(stack,budget,options.clock):stack.chat&&stack.chat.endpoint.model?
                    createKeywordPlanner({client:{endpoint:{provider:stack.chat.endpoint.provider,model:stack.chat.endpoint.model},complete:request=>stack.chat!.complete(request)},budget,clock:options.clock,artifact:lightRagPrompt('graph-planner')}):null;
                if(!planner)lightragReject('TLRAG1008','/planner','Select a configured language model for graph keyword planning.');
                const retrieve=createLightRagRetriever({store:options.store,documents:options.documents,planner}),result=await retrieve(input.q,{mode:input.mode,limits:input.limit===undefined?{}:{candidatesPerKeyword:input.limit},budget,embedder:stack.embedder,clock:options.clock});spend=result.spend;
                if(!result.valid)return refused(result.issues);
                const value=lightragMust(result);return {experimental:true as const,status:'ok' as const,mode:value.mode,graphRevision:value.graphRevision,plan:value.plan,sections:value.bundle.sections,citations:value.citations,skipped:value.skipped,prune:value.pruned,spend};
            }catch(cause){const failure=lightragFailure(cause);if(failure.valid)throw Error('Expected refusal.');return refused(failure.issues);}
        },
    };
}
