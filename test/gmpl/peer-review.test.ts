import {it} from 'node:test';
import assert from 'node:assert/strict';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
for(const [acceptedCycle,reviews,revisions] of [[1,2,0],[2,4,1],[99,6,2]])it(`peer review stops at the reviewed revision: cycle ${acceptedCycle}`,async()=>{
  const p=await prepareGmplPattern({pattern:'peer-review'});
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:(node,i)=>node.startsWith('reviewer')?{result:fixture.script.result,assessment:i>=acceptedCycle?'accept':'minor-revision',issues:[],strengths:[]}:{result:fixture.script.result}});
  assert.equal(d.status,'completed',JSON.stringify(d.trace.run.failure));
  const calls=d.visibility.filter(v=>v.phase==='completion');assert.equal(calls.filter(v=>v.node.startsWith('reviewer')).length,reviews);assert.equal(calls.filter(v=>v.node==='revision').length,revisions);
  assert.equal((d.output as {result:{disposition:string}}).result.disposition,acceptedCycle===99?'no-consensus':'completed');
  assert.equal(calls.filter(v=>v.node==='author').length,1);
});
it('peer review never revises after its single final review and never widens a runtime request cap',async()=>{
  const p=await prepareGmplPattern({pattern:'peer-review',maxRounds:1});
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>node.startsWith('reviewer')?{result:fixture.script.result,assessment:'reject',issues:[],strengths:[]}:{result:fixture.script.result}});
  assert.equal(d.status,'completed');assert.equal(d.usage.roles,3);assert.equal((d.output as {result:{disposition:string}}).result.disposition,'no-consensus');
  const capped=await prepareGmplPattern({pattern:'peer-review',caps:{calls:1}});
  const failure=await driveGmplWorkflow(capped,{input:{input:fixture.input},bindings:capped.bindings,response:()=>({result:fixture.script.result})});
  assert.equal(failure.status,'failed');assert.equal(failure.trace.run.failure!.error.code,'TMAS2009');assert.equal(failure.usage.physical,1);
});
