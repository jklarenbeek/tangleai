import {openTangleDb,createHeraStore,createMasStore,type TangleDb} from '@tangleai/store';
import {MasUncertainEffect,type MasRuntimeObserver} from '@tangleai/mas';
import {gmplTextDigest} from '@tangleai/gmpl';
import {createHeraExecutor,heraRevisionOf,type HeraTask,type HeraExecuteRequest,type HeraEvidenceProvider,type HeraExecutorHost} from '@tangleai/hera';
import {createHeraExampleState,createHeraExampleSegments} from '../../examples/hera.ts';
export interface ExecutorFixtureOptions {path?:string;unknownUsage?:boolean;failNode?:string;repairNode?:string;unsupported?:boolean;uncertain?:boolean;overlap?:boolean;observer?:MasRuntimeObserver;}
export async function executorFixture(options:ExecutorFixtureOptions={}) {
  let calls=0,toolCalls=0,active=0,maxActive=0,tick=0,currentRevision='',normalizations=new Map<string,number>();
  const clock={value:1000000},now=()=>`tick-${String(tick++).padStart(6,'0')}`;
  const units=await Promise.all(['Lumen was directed by Ivo.','Ivo studied in Eastmere.'].map(async(text,index)=>({id:'e'+index,text,digest:await gmplTextDigest(text),address:'document:fixture/v1/e'+index})));
  const corpusRevision=await heraRevisionOf(units);currentRevision=corpusRevision;
  const evidence:HeraEvidenceProvider={revision:await heraRevisionOf({kind:'fixture',corpusRevision}),currentCorpusRevision:()=>currentRevision,
    recall:async(_query,context)=>{if('idempotencyKey' in context){toolCalls++;if(options.uncertain)throw new MasUncertainEffect('hera-evidence','Scripted durable outcome lost');}return structuredClone(units);}};
  let db:TangleDb=await openTangleDb({...(options.path?{path:options.path}:{}),jobs:{now:()=>clock.value,random:()=>0.5}});
  let enter!:()=>void;const both=new Promise<void>(r=>{enter=r;}),entered=new Set<string>();
  const requests:Array<{node:string;phase:string;request:unknown}>=[];
  const build=async()=>{
    const store=createHeraStore(db,{scope:'execution-fixture'}),masStore=createMasStore(db,{now});
    const state=await createHeraExampleState(store,{corpusRevision,embeddedBy:{model:'fixture',dims:2}});
    const task:HeraTask={id:'q',scope:store.scope,query:'Where did the first Lumen director study?',split:'held-out',corpusRevision,evaluator:state.snapshot.identities.evaluator,goldAddress:'fixture:q'};
    const host:HeraExecutorHost={store,masStore,segments:createHeraExampleSegments(db,masStore),profiles:state.profiles,evidence,embedder:{model:'fixture',dims:2,embed:async text=>text.map(()=>new Float32Array([1,0]))},
      evaluator:{identity:state.snapshot.identities.evaluator,score:async(_task,answer)=>({primaryScore:answer==='Eastmere'?1:0,success:answer==='Eastmere',metrics:{answerExact:answer==='Eastmere'?1:0}})},now,clock:()=>clock.value,concurrency:4,observer:options.observer,
      clientFor:(_profile,_identity,node)=>({endpoint:{provider:'ollama'},complete:async raw=>{
        calls++;clock.value++;const request=raw as {responseFormat?:unknown;messages:Array<{role:string;content:string}>};
        const normalization=request.responseFormat!==undefined;
        const count=normalizations.get(node.id)??0;
        requests.push({node:node.id,phase:normalization?(count?'repair':'normalization'):'completion',request});
        if(options.failNode===node.id)throw Error('Scripted node failed');
        const first=node.role==='retriever'&&!request.messages.some(m=>m.role==='tool')&&!normalization;
        if(first && options.overlap){active++;maxActive=Math.max(maxActive,active);entered.add(node.id);if(entered.size===2)enter();await both;active--;}
        const usage=options.unknownUsage?{}:{usage:{prompt_tokens:7,completion_tokens:3}};
        if(first)return {...usage,message:{role:'assistant',content:'',toolCalls:[{id:'call-'+node.id,name:'hera-evidence',arguments:JSON.stringify({query:task.query,k:2})}]},finishReason:'tool_calls'};
        if(normalization){normalizations.set(node.id,count+1);if(options.repairNode===node.id&&count===0)return {...usage,message:{role:'assistant',content:'not-json'},finishReason:'stop'};}
        const citations=options.unsupported&&node.role==='conclude-agent'?[{id:'invented',digest:'f'.repeat(64)}]:units.map(({id,digest})=>({id,digest}));
        const result={answer:'Eastmere',disposition:'completed',claims:[{text:'The director studied in Eastmere.',citations}],findings:[],
          ...(node.role==='query-decomposer'?{queries:['Who directed Lumen?','Where did Ivo study?']}:['retriever','evidence-selector'].includes(node.role)?{selectedEvidenceIds:units.map(e=>e.id)}:{})};
        return {...usage,message:{role:'assistant',content:JSON.stringify(result)},finishReason:'stop'};
      }})};
    const request:HeraExecuteRequest={task,snapshot:state.snapshot,topology:'fixed',mode:'evaluate',groupIndex:0,candidateIndex:0,configRevision:await heraRevisionOf({kind:'fixed-fixture'})};
    return {host,store,masStore,executor:createHeraExecutor(host),request,initialWrites:store.counters().learningWrites};
  };
  let runtime=await build();
  return {get runtime(){return runtime;},requests,units,clock,counters:()=>({calls,toolCalls,maxActive}),supersede:()=>{currentRevision='f'.repeat(64);},
    async reopen(){if(!options.path)throw Error('Reopen requires a file');await db.close();clock.value+=300000;db=await openTangleDb({path:options.path,jobs:{now:()=>clock.value,random:()=>0.5}});runtime=await build();},close:()=>db.close()};
}
