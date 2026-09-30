import type {HeraGroupHost,HeraGroupRequest,HeraPlanOutput} from '@tangleai/hera';
import {executorFixture,type ExecutorFixtureOptions} from './executor-fixture.ts';
export const serialPlan:HeraPlanOutput={nodes:[{id:'a',agentId:'query-decomposer',dependsOn:[]},{id:'b',agentId:'retriever',dependsOn:['a']},{id:'c',agentId:'conclude-agent',dependsOn:['b']}],appliedExperienceIds:[]};
export const parallelPlan:HeraPlanOutput={nodes:[{id:'p-a',agentId:'query-decomposer',dependsOn:[]},{id:'p-b',agentId:'retriever',dependsOn:['p-a']},{id:'p-c',agentId:'evidence-selector',dependsOn:['p-a']},{id:'p-d',agentId:'conclude-agent',dependsOn:['p-b','p-c']}],appliedExperienceIds:[]};
export const budget={calls:24,tokens:65536,ms:120000,turns:6,nodes:15,depth:15,fanOut:12,concurrency:4};
export async function groupFixture(options:ExecutorFixtureOptions&{plans?:unknown[];control?:(stage:string,attempt:number,request:unknown)=>unknown|Promise<unknown>}={}){
  const base=await executorFixture(options);let controls=0,embeddings=0;const controlRequests:Array<{stage:string;request:unknown}>=[],attempts=new Map<string,number>();
  const build=()=>{
    const host:HeraGroupHost={...base.runtime.host,embedder:{...base.runtime.host.embedder,embed:async texts=>{embeddings++;return texts.map(()=>new Float32Array([1,0]));}},controlClientFor(_profile,_identity,stage){return {endpoint:{provider:'ollama'},async complete(request){
      controls++;base.clock.value++;controlRequests.push({stage,request});const attempt=attempts.get(stage)??0;attempts.set(stage,attempt+1);
      const value=options.control?await options.control(stage,attempt,request):stage==='profile'?{text:'Identify the director and their school.',tags:['two-hop']}:(options.plans??[serialPlan,parallelPlan,serialPlan])[Number(stage.split('/')[1])];
      return {message:{content:typeof value==='string'?value:JSON.stringify(value)},usage:{prompt_tokens:7,completion_tokens:3}};
    }};}};
    const request:HeraGroupRequest={task:base.runtime.request.task,snapshot:base.runtime.request.snapshot,mode:'evaluate',groupIndex:0,budget,groupConcurrency:2};
    return {host,request};
  };
  return {base,build,controlRequests,counters:()=>({...base.counters(),controls,embeddings}),close:base.close};
}
