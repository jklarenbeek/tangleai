/** Calls reserve the shared native account before asynchronous work can start. */
import type { createBudgetAccount } from '@tangleai/agents';
import type { LightRagSpend,LightRagIssue } from './contracts.gen.ts';
import { LightRagRefusal,lightragRefuse } from './errors.ts';
export type LightRagBudget=ReturnType<typeof createBudgetAccount>;
export type LightRagClock=()=>number;
export type LightRagStageOutcome<T>={valid:true;value:T;spend:LightRagSpend;attempts:number}
    |{valid:false;issues:LightRagIssue[];spend:LightRagSpend;attempts:number;stopReason:string};
export class LightRagBudgetStop extends Error {
    readonly dimension:string;
    constructor(dimension:string){super(dimension);this.dimension=dimension;}
}
export const emptyGraphSpend=():LightRagSpend=>({calls:0,tokens:0,ms:0});
export function addGraphSpend(a:LightRagSpend,b:LightRagSpend):LightRagSpend{return {calls:a.calls+b.calls,tokens:a.tokens+b.tokens,ms:a.ms+b.ms};}
export function graphStageFailure(cause:unknown,spend:LightRagSpend,attempts:number,fallback:LightRagIssue['code']='TLRAG1010'):LightRagStageOutcome<never>{
    const result=cause instanceof LightRagRefusal?{valid:false as const,issues:cause.issues}
        :lightragRefuse(cause instanceof LightRagBudgetStop?'TLRAG1005':fallback,'',cause instanceof LightRagBudgetStop?cause.dimension:'Graph stage could not complete.',cause);
    if(result.valid)throw new TypeError('Refusal factory returned a success.');
    return {...result,spend,attempts,stopReason:cause instanceof LightRagBudgetStop?cause.dimension:result.issues[0].code};
}
export function createLightRagMeter(budget:LightRagBudget,clock:LightRagClock){
    const spend=emptyGraphSpend();
    if(typeof clock!=='function')throw new TypeError('Graph work requires an injected clock.');
    const settle=(usage:unknown,text:string)=>{const before=budget.spent().tokens;budget.settle(usage,text);spend.tokens+=budget.spent().tokens-before;};
    const checkedUsage=(usage:unknown):Record<string,number>|undefined=>{
        if(usage===undefined||usage===null)return undefined;
        if(typeof usage!=='object'||Array.isArray(usage))throw new TypeError('Graph usage must contain finite token counts.');
        const checked:Record<string,number>={};
        for(const key of ['total_tokens','prompt_tokens','completion_tokens']){
            const value=(usage as Record<string,unknown>)[key];
            if(value===undefined||value===null)continue;
            if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new TypeError('Graph usage must contain finite token counts.');
            checked[key]=value;
        }
        if(!Number.isSafeInteger((checked.prompt_tokens??0)+(checked.completion_tokens??0)))throw new TypeError('Graph token usage exceeds the supported range.');
        return checked;
    };
    return {
        spent:():LightRagSpend=>({...spend}),
        async run<T>(task:()=>Promise<T>,input:string,account:(result:T)=>{usage?:unknown;text?:string}=()=>({})):Promise<T>{
            const stop=budget.stop();if(stop!==null)throw new LightRagBudgetStop(stop);
            const started=clock();if(!Number.isFinite(started))throw new TypeError('Graph clock must return finite milliseconds.');
            budget.reserve();spend.calls++;
            try{
                let result:T;
                try{result=await task();}catch(cause){settle(undefined,input);throw cause;}
                let accountedText=input,usage:Record<string,number>|undefined;
                try{
                    const charge=account(result);
                    if(charge.text!==undefined&&typeof charge.text!=='string')throw new TypeError('Graph usage text must be a string.');
                    accountedText+=charge.text??'';usage=checkedUsage(charge.usage);
                }catch(cause){settle(undefined,accountedText);throw cause;}
                settle(usage,accountedText);return result;
            }finally{const elapsed=clock()-started;if(!Number.isFinite(elapsed)||elapsed<0)throw new TypeError('Graph clock must be monotonic.');spend.ms+=elapsed;}
        },
    };
}
