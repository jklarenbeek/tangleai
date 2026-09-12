import {it} from 'node:test';
import assert from 'node:assert/strict';
import type {GmplPatternResult} from '@tangleai/gmpl';
import {prepareSingleAgent,driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {scriptedGmplResponse} from '../../benchmark/lib/gmpl-scripts.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/direct-fact-success.json' with {type:'json'};
for(const cap of ['contextChars','traceBytes'] as const)it(`MAS enforces ${cap} before dispatch beyond the lowered budget`,async()=>{
  const p=await prepareGmplPattern({pattern:'parallel-analysis',caps:{[cap]:1}});
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:scriptedGmplResponse(fixture.input,fixture.script.result as GmplPatternResult)});
  assert.equal(d.status,'failed');assert.equal(d.usage.physical,0);assert.equal(d.trace.run.failure!.error.code,'TMAS2009');
});
it('MAS persists the shared account token charge, including total_tokens and estimated usage',async()=>{
  for(const usage of [{prompt_tokens:7,completion_tokens:3,total_tokens:99},undefined]){
    const p=await prepareSingleAgent();
    const d=await driveGmplWorkflow(p,{input:{input:fixture.input},response:()=>fixture.script.result,complete:async()=>({message:{content:JSON.stringify(fixture.script.result)},usage})});
    assert.equal(d.status,'completed');if(usage)assert.equal(d.trace.run.budget.spent.tokens,198);else assert.ok(d.trace.run.budget.spent.tokens>0);
    assert.equal(d.trace.attempts.find(a=>a.kind==='agent')!.spend.tokens,d.trace.run.budget.spent.tokens);
  }
});
it('MAS saves active elapsed time and applies it to resumed segments',async()=>{
  const clock={value:1000},p=await prepareGmplPattern({pattern:'clarification',caps:{ms:150}});
  const response=scriptedGmplResponse(fixture.input,fixture.script.result as GmplPatternResult);
  const humanResponses=[{answers:{q1:'Scope'}},{answers:{q1:'Period'}}];
  // The inactive human wait advances wall time without consuming active budget.
  Object.defineProperty(humanResponses,0,{get(){clock.value+=1_000_000;return {answers:{q1:'Scope'}};}});
  const d=await driveGmplWorkflow(p,{clock,input:{input:fixture.input},bindings:p.bindings,humanResponses,response:(node,i,phase,messages)=>{
    clock.value+=25;
    if(node==='inspect'||node==='resolve')return {result:fixture.script.result,resolved:node==='resolve'&&i>=2,refinedQuery:fixture.input.query};
    return response(node,i,phase,messages);
  }});
  assert.equal(d.status,'failed');assert.equal(d.usage.physical,6);assert.equal(d.trace.run.budget.spent.ms,150);assert.equal(d.usage.activeMs,150);
});
it('MAS honors a narrower run context cap and refuses run caps that widen the compiled workflow',async()=>{
  const p=await prepareGmplPattern({pattern:'parallel-analysis',caps:{calls:8}});
  for(const runLimits of [{contextChars:1},{calls:9}] as Array<Record<string,number>>){
    const d=await driveGmplWorkflow(p,{runLimits,input:{input:fixture.input},bindings:p.bindings,response:scriptedGmplResponse(fixture.input,fixture.script.result as GmplPatternResult)});
    assert.equal(d.status,'failed');assert.equal(d.usage.physical,0);assert.equal(d.trace.run.failure!.error.code,'TMAS2009');
  }
});

it('trace quota rollback preserves the actual paid failure cost without committing result payloads',async()=>{
  const p=await prepareSingleAgent();
  const d=await driveGmplWorkflow(p,{runLimits:{traceBytes:3000},input:{input:fixture.input},response:()=>fixture.script.result});
  assert.equal(d.status,'failed');assert.equal(d.usage.physical,2);assert.equal(d.trace.run.budget.spent.turns,2);assert.equal(d.trace.run.budget.spent.tokens,20);
  assert.equal(d.trace.run.output,null);assert.equal(d.trace.messages.length,0);assert.equal(d.trace.artifacts.length,0);assert.equal(d.trace.run.failure!.error.code,'TMAS2009');
});
it('a reclaimed segment retains active time already committed by a role',async()=>{
  const clock={value:1000},p=await prepareGmplPattern({pattern:'peer-review',caps:{ms:75,concurrency:1}});
  const response=scriptedGmplResponse(fixture.input,fixture.script.result as GmplPatternResult);
  const d=await driveGmplWorkflow(p,{clock,crashBefore:'initialize',input:{input:fixture.input},bindings:p.bindings,response:(...args)=>{clock.value+=25;return response(...args);}});
  assert.equal(d.crashes,1);assert.equal(d.status,'failed');assert.equal(d.usage.physical,3);assert.equal(d.trace.run.budget.spent.ms,75);
});
