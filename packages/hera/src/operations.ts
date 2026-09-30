/** Durable receipts for orchestration calls outside candidate MAS executions. */
import {createBudgetAccount} from '@tangleai/agents';
import {createSharedBudgetClient,MasBudgetStop,type MasChatClient,type MasChatCompletion} from '@tangleai/mas';
import type {RunIdentity} from '@tangleai/config';
import type {HeraStore} from './store.ts';
import type {HeraAuthority} from './modes.ts';
import type {HeraBudget,HeraOperation,HeraUsage} from './contracts.gen.ts';
import {heraRevisionOf} from './identity.ts';
import {HeraRefusal,heraIssue,type HeraOutcome} from './errors.ts';
import {HERA_DEFAULT_LIMITS} from './scaffold.ts';

export const emptyHeraUsage=():HeraUsage=>({calls:0,promptTokens:0,completionTokens:0,unknownTokenRequests:0,estimatedTokens:0,ms:0,unknownMsRequests:0,embeddingRequests:0});
const must=<T>(r:HeraOutcome<T>):T=>{if(!r.valid)throw new HeraRefusal(r.issues);return r.value;};
const pending=()=>new HeraRefusal([heraIssue('THERA1007','/operation','A dispatched operation has no durable response; replay cannot purchase it again.')]);
interface ResponseValue {completion?:MasChatCompletion;vector?:number[];chargedTokens:number;}
export interface HeraControlReceipts {
  client(stage:string,client:MasChatClient):MasChatClient&{endpoint:{provider:string}};
  embed(stage:string,text:string,invoke:(signal:AbortSignal)=>Promise<number[]>):Promise<number[]>;
  /** Admit completed MAS spend into the same bounded learning account. */
  chargeExecution(id:string,spent:{calls:number;tokens:number;ms:number}):void;
  remaining():{calls:number;tokens:number;ms:number};
  usage():HeraUsage;
  spent():{calls:number;tokens:number;ms:number};
  replay(ids:readonly string[]):Promise<void>;
  operationIds():string[];
}
/** A missing response is uncertain, including a crash before the physical dispatch. */
export function createHeraControlReceipts(options:{store:HeraStore;authority:HeraAuthority;taskId:string;snapshotId:string;groupId:string;
  binding:string;identity:RunIdentity;budget:HeraBudget;clock:()=>number}):HeraControlReceipts {
  const {store,authority,identity,budget}=options;
  const started=options.clock();
  let account=createBudgetAccount({turns:budget.calls,tokens:budget.tokens,ms:budget.ms},options.clock);
  const receipts=new Map<string,HeraOperation>(),executions=new Map<string,{calls:number;tokens:number;ms:number}>();
  const external=(key:"calls"|"tokens"|"ms")=>[...executions.values()].reduce((n,e)=>n+e[key],0);
  const spent=()=>({calls:external("calls")+[...receipts.values()].reduce((n,r)=>n+r.usage.calls+(r.usage.embeddingRequests??0),0),
    tokens:external("tokens")+[...receipts.values()].reduce((n,r)=>n+(r.value as ResponseValue).chargedTokens,0),
    ms:Math.max(0,Math.floor(options.clock()-started),external("ms")+[...receipts.values()].reduce((n,r)=>n+r.usage.ms,0))});
  const synchronize=()=>{const used=spent();account=createBudgetAccount({turns:budget.calls,tokens:budget.tokens,ms:budget.ms,spent:{turns:used.calls,tokens:used.tokens,ms:used.ms}},options.clock);};
  const base={scope:authority.scope,taskId:options.taskId,snapshotId:options.snapshotId,groupId:options.groupId};
  const read=async(stage:string,input:unknown)=>{
    const id=await heraRevisionOf([base.scope,base.groupId,stage]),binding=await heraRevisionOf([options.binding,stage,input]);
    const response=await store.getOperation(id+':response');
    if(response&&response.binding!==binding)throw new HeraRefusal([heraIssue('THERA1007','/operation/binding','An operation key already binds different input.')]);
    if(response)receipts.set(response.id,response);
    return {id,binding,response};
  };
  const claim=async(stage:string,key:{id:string;binding:string})=>{
    const record:HeraOperation={...base,id:key.id+':dispatch',binding:key.binding,stage,phase:'dispatch',status:'pending',value:null,usage:emptyHeraUsage(),issues:[]};
    const written=must(await store.transaction(authority,async tx=>{
      if(await tx.get('operation',record.id))return false;
      await tx.put('operation',record);return true;
    }));
    if(!written)throw pending();
  };
  const save=async(stage:string,key:{id:string;binding:string},value:ResponseValue,usage:HeraUsage,error?:unknown)=>{
    const issues=error===undefined?[]:error instanceof HeraRefusal?error.issues:[heraIssue(error instanceof MasBudgetStop?'THERA1007':'THERA1009','/operation/'+stage,
      error instanceof Error?error.message:String(error))];
    const record:HeraOperation={...base,id:key.id+':response',binding:key.binding,stage,phase:'response',status:issues.length?'failed':'completed',value,usage,issues};
    must(await store.putOperation(record,authority));receipts.set(record.id,record);
    if(issues.length)throw new HeraRefusal(issues);
  };
  const signal=()=>AbortSignal.timeout(Math.max(1,Math.min(2147483647,Math.floor(account.remaining().ms??budget.ms))));
  return {
    client(stage,client){
      let ordinal=0;
      return {endpoint:client.endpoint??{provider:identity.roles.chat.provider},async complete(raw){
        const request:Record<string,unknown>={...(raw as Record<string,unknown>),...Object.fromEntries(Object.entries(identity.roles.chat.inference).filter(([,v])=>v!==null)),model:identity.roles.chat.model};
        delete request.signal;
        const name=stage+'/request/'+ordinal++,key=await read(name,request);
        if(key.response){
          const value=key.response.value as ResponseValue;
          if(key.response.status!=='completed')throw new HeraRefusal(key.response.issues);
          return structuredClone(value.completion!);
        }
        synchronize();
        let dispatched=false,usage=emptyHeraUsage(),chargedTokens=0,completion:MasChatCompletion|undefined,error:unknown;
        const started=options.clock();
        const bounded=createSharedBudgetClient({endpoint:client.endpoint,async complete(input){await claim(name,key);dispatched=true;return client.complete(input);}},account,{
          maxContextChars:HERA_DEFAULT_LIMITS.contextChars,
          onCall(record){
            if(!dispatched)return;
            const parts=record.usage as {prompt_tokens?:number;completion_tokens?:number;total_tokens?:number}|undefined;
            const known=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
            usage.calls=1;usage.promptTokens=known(parts?.prompt_tokens)?parts.prompt_tokens:0;usage.completionTokens=known(parts?.completion_tokens)?parts.completion_tokens:0;
            usage.unknownTokenRequests=Number(!known(parts?.prompt_tokens)||!known(parts?.completion_tokens));
            chargedTokens=record.chargedTokens;
            usage.estimatedTokens=(parts?.total_tokens??0)>0||usage.promptTokens+usage.completionTokens>0?0:chargedTokens;
          },
        });
        try{
          completion=await bounded.complete({...request,signal:signal()});
          if(JSON.stringify(completion).length>HERA_DEFAULT_LIMITS.traceBytes)throw new HeraRefusal([heraIssue('THERA1007','/response','The control response exceeds its retention bound.')]);
        }catch(cause){error=cause;}
        if(!dispatched)throw error;
        usage.ms=Math.max(0,Math.floor(options.clock()-started));usage.unknownMsRequests=usage.ms===0?1:0;
        // Sanitize optional undefined provider fields without inventing usage.
        const value:ResponseValue=JSON.parse(JSON.stringify({...(error===undefined?{completion}:{}),chargedTokens}));
        await save(name,key,value,usage,error);
        return completion!;
      }};
    },
    async embed(stage,text,invoke){
      const key=await read(stage,{text,embeddedBy:identity.embedding}),remote=identity.embedding?.provider!=='builtin';
      if(key.response){if(key.response.status!=='completed')throw new HeraRefusal(key.response.issues);return structuredClone((key.response.value as ResponseValue).vector!);}
      synchronize();
      if(account.stop()!==null)throw new HeraRefusal([heraIssue('THERA1007','/embedding','The group budget is exhausted.')]);
      await claim(stage,key);if(remote)account.reserve();
      const usage=emptyHeraUsage(),started=options.clock();usage.embeddingRequests=Number(remote);usage.unknownTokenRequests=Number(remote);
      let vector:number[]|undefined,error:unknown;
      try{vector=await invoke(signal());}catch(cause){error=cause;}
      usage.ms=Math.max(0,Math.floor(options.clock()-started));usage.unknownMsRequests=remote&&usage.ms===0?1:0;
      if(remote){account.settle(undefined,text);usage.estimatedTokens=account.spent().tokens-spent().tokens;}
      await save(stage,key,{...(vector?{vector}:{}),chargedTokens:usage.estimatedTokens},usage,error);return vector!;
    },
    chargeExecution(id,value){if(!Object.values(value).every(n=>Number.isSafeInteger(n)&&n>=0))throw new TypeError("Execution spend must be nonnegative safe integers.");
      const old=executions.get(id);if(old&&(['calls','tokens','ms'] as const).some(key=>old[key]!==value[key]))throw new HeraRefusal([heraIssue("THERA1007","/execution/spend","The same execution has different retained spend.")]);executions.set(id,{...value});synchronize();},
    remaining(){const used=spent();return {calls:Math.max(0,budget.calls-used.calls),tokens:Math.max(0,budget.tokens-used.tokens),ms:Math.max(0,budget.ms-used.ms)};},
    usage(){const total=emptyHeraUsage();for(const receipt of receipts.values())for(const k of Object.keys(total) as Array<keyof HeraUsage>)total[k]=(total[k]??0)+(receipt.usage[k]??0);return total;},
    spent,
    async replay(ids){for(const id of ids){const receipt=await store.getOperation(id);
      if(!receipt||receipt.scope!==base.scope||receipt.taskId!==base.taskId||receipt.snapshotId!==base.snapshotId||receipt.groupId!==base.groupId)throw new HeraRefusal([heraIssue('THERA1007','/operation/evidence','Retained control evidence is missing or crosses the operation binding.')]);
      if(receipt.phase==='response'){const dispatch=await store.getOperation(id.replace(/:response$/,':dispatch'));
        if(!dispatch||dispatch.binding!==receipt.binding)throw pending();receipts.set(receipt.id,receipt);}
    }synchronize();},
    operationIds:()=>[...receipts.keys()],
  };
}
