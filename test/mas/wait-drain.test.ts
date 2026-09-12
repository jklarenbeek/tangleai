import {it} from 'node:test';
import assert from 'node:assert/strict';
import {defineDag,edge,input,output,task} from '@jarenjs/linq/flow';
import {executeDagRegion} from '../../packages/mas/src/dag-runtime.ts';
import {MasInteractionWait,MasNodeFailure} from '../../packages/mas/src/node-lifecycle.ts';
import type {} from '../../packages/mas/src/jaren-flow.d.ts';
it('a nested human pause drains a started sibling without cancelling it; real failures still win',async()=>{
  const document=defineDag({nodes:{scope:input(),'t:human':task('human'),'t:paid':task('paid'),expose:output()},edges:[edge('scope','t:human'),edge('scope','t:paid'),edge('t:human','expose',{port:'human'}),edge('t:paid','expose',{port:'paid'})]});
  for(const fail of [false,true]){
    let entered:()=>void=()=>{};const started=new Promise<void>(resolve=>{entered=resolve;});let settled=false;
    const d=await executeDagRegion({document,taskVersion:'wait/1',executableRevision:'wait-test',scope:{input:null,nodes:{}},segmentJobId:'wait-test',signal:new AbortController().signal,region:{branch:'',iteration:0},checkpoints:{load:()=>null,save:()=>{},complete:()=>{}},handlers:{
      human:async()=>{await started;throw new MasInteractionWait('durable wait');},
      paid:async(_props,signal)=>{entered();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(signal.aborted,false);settled=true;if(fail)throw new MasNodeFailure('paid',{code:'TMAS2004',path:'',detail:'real failure'});return {result:'committed'};},
    }});
    assert.ok(settled);assert.ok(!d.ok);if(fail){assert.ok('failure' in d);assert.equal(d.failure.node,'paid');}else assert.ok('waiting' in d);
  }
});
