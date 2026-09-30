import {it} from 'node:test';import assert from 'node:assert/strict';
import {heraValue} from '../../examples/hera.ts';
import {executorFixture} from './executor-fixture.ts';
it('trajectory receipts preserve durable attempt order, tool purchases and bounded views',async()=>{
  const f=await executorFixture();try{
    const result=heraValue(await f.runtime.executor.execute(f.runtime.request)),trace=(await f.runtime.masStore.readTrace(result.trajectory.masRunId))!;
    const attempts=trace.attempts.filter(a=>a.kind==='agent').sort((a,b)=>a.seq-b.seq);
    assert.deepEqual(result.trajectory.invocationOrder,attempts.map(a=>a.invocationId));assert.deepEqual(result.steps.map(s=>s.masAttemptId),attempts.map(a=>a.id));
    assert.equal(result.steps.flatMap(s=>s.toolSteps).length,2);assert.ok(result.steps.flatMap(s=>s.toolSteps).every(t=>t.name==='hera-evidence'&&t.status==='completed'));
    assert.ok(result.steps.every(s=>s.inputView.text.length<=32768&&s.transcriptView.text.length<=32768));
    assert.ok(result.steps.every(s=>s.promptVersionId===f.runtime.request.snapshot.activePromptVersionIds[s.agentId]));
    assert.equal(result.trajectory.claimEnvelopeId,(trace.run.output as {result:{envelopeId:string}}).result.envelopeId);
    assert.equal(result.steps.reduce((n,s)=>n+s.spend.calls,0),result.trajectory.calls);
  }finally{await f.close();}
});
