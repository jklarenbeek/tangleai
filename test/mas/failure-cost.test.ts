import {it} from 'node:test';
import assert from 'node:assert/strict';
import {prepareSingleAgent,driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/direct-fact-success.json' with {type:'json'};
it('MAS retains permanently invalid normalization cost in the failed attempt and run',async()=>{
  const p=await prepareSingleAgent();
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},response:(_n,_i,phase)=>phase==='completion'?fixture.script.result:{}});
  assert.equal(d.status,'failed');assert.equal(d.usage.physical,3);
  const attempt=d.trace.attempts.find(a=>a.kind==='agent')!;
  assert.equal(attempt.usage.calls,3);assert.equal(attempt.spend.turns,3);
  assert.equal(attempt.usage.promptTokens,21);assert.equal(attempt.usage.completionTokens,9);
  assert.deepEqual(d.trace.run.budget.spent,{turns:3,tokens:30,ms:0});
  assert.ok(attempt.transcript.size>0);assert.equal(attempt.status,'failed');
});
it('MAS records a rejected physical request without inventing returned token usage',async()=>{
  const p=await prepareSingleAgent();
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},response:()=>{throw Error('scripted transport failure');}});
  assert.equal(d.status,'failed');assert.equal(d.usage.physical,1);
  const attempt=d.trace.attempts.find(a=>a.kind==='agent')!;
  assert.equal(attempt.usage.calls,1);assert.equal(attempt.spend.turns,1);
  assert.equal(attempt.usage.promptTokens,0);assert.equal(attempt.usage.completionTokens,0);
  assert.equal(d.trace.run.budget.spent.turns,1);
  assert.equal(d.usage.unknownTokenRequests,1);assert.equal(d.usage.promptTokens,0);
});
