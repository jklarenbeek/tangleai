import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createInternalFeedbackEditor, createVolatileFactClassifier, forecastRevisionCommit, forecastMust, forecastQuery, forecastResolutionRecord, sealForecastRecord, createEditorToolbox, forecastTransaction, forecastQuestionCreate, forecastCheckpointPlan } from '@tangleai/forecast';
import { scriptedClient } from './runtime-fixture.ts';
import { feedbackFixture, feedbackAnswer } from './feedback-fixture.ts';
import { makeForecastFixture } from './fixtures.ts';
const proposal = (item: any) => ({ provisionalDiagnoses: [],committedGuidance: [item],deferredFeedback: [] });
it('checkpoint one and a resolved question are refused as TFCT1004 before any model call',async () => {
  const f = await feedbackFixture(); let calls = 0;
  const client = scriptedClient(async () => { calls++; return feedbackAnswer(proposal(f.item)); });
  await assert.rejects(() => createInternalFeedbackEditor({ ...f,client }).run({ question: f.question,checkpoint: f.checkpoints[0] },f.budget),{ code: 'TFCT1004' });
  const sample = await makeForecastFixture(), resolution = await sealForecastRecord('resolutions',{ ...sample.resolutions,questionId: f.question.id });
  forecastMust(await forecastResolutionRecord(f.store,resolution));
  await assert.rejects(() => createInternalFeedbackEditor({ ...f,client }).run(f,f.budget),{ code: 'TFCT1004' }); assert.equal(calls,0);
});
it('the editor repairs volatile guidance once, retains the refusal and publishes only reusable procedure',async () => {
  const f = await feedbackFixture(); let calls = 0;
  const client = scriptedClient(async () => feedbackAnswer(proposal({ ...f.item,text: calls++ ? f.item.text : 'Remember Tidewater at checkpoint 2.' })));
  const result = await createInternalFeedbackEditor({ ...f,client }).run(f,f.budget);
  assert.equal(result.status,'staged',JSON.stringify(result.revision.validation)); assert.equal(calls,2); assert.equal(result.candidate!.digest,f.corpus.candidates[0].digest);
  assert.equal(result.revision.gate.volatileFact.refused,1); assert.ok(result.revision.deferredFeedback.some(d => d.reason.startsWith('TFCT1008:')));
  assert.ok(!JSON.stringify(result.candidate!.document).includes('Tidewater')); assert.equal(result.revision.receipt!.spend.calls,2);
  assert.equal(forecastMust(await forecastRevisionCommit(f.store,result)).status,'staged');
});
it('the editor dispatches only its closed read tools and counts exhausted trace reads',async () => {
  const f = await feedbackFixture(); let calls = 0;
  const client = scriptedClient(async request => {
    calls++; assert.deepEqual(request.tools?.map((t: any) => t.function.name).sort(),['harness_read','notes_read','revisions_read','trace_read']);
    if (calls === 1) return { message: { role: 'assistant',content: '',toolCalls: [{ id: 'read',name: 'trace_read',arguments: JSON.stringify({ traceId: f.checkpoint.traceId,limit: 64 }) },{ id: 'exhaust',name: 'trace_read',arguments: JSON.stringify({ traceId: f.checkpoint.traceId }) }] },finishReason: 'tool_calls',usage: { total_tokens: 3 } };
    assert.ok(JSON.stringify(request.messages).includes('exhausted')); return feedbackAnswer(proposal(f.item));
  });
  const result = await createInternalFeedbackEditor({ ...f,client,limits: { maxTraceReads: 1 } }).run(f,f.budget);
  assert.equal(result.status,'staged',JSON.stringify(result.revision.validation)); assert.equal(result.revision.traceReads,1); assert.equal(result.revision.editorRefusals!.traceBudget,1); assert.equal(calls,2);
});
it('repeated bad guidance and semantic refusal stage no harness and keep all purchases',async () => {
  const f = await feedbackFixture();
  const bad = await createInternalFeedbackEditor({ ...f,client: scriptedClient(async () => feedbackAnswer(proposal({ ...f.item,text: 'Always use 2025-02-01.' }))) }).run(f,f.budget);
  assert.equal(bad.status,'refused'); assert.equal(bad.candidate,null); assert.equal(bad.revision.receipt!.spend.calls,2); assert.equal(bad.revision.deferredFeedback.length,1);
  const classifier = createVolatileFactClassifier({ client: scriptedClient(async () => feedbackAnswer({ verdicts: [{ index: 0,verdict: 'question-specific',reason: 'An implied question fact.' }] },null)),now: f.clock });
  const semantic = await createInternalFeedbackEditor({ ...f,classifier,client: scriptedClient(async () => feedbackAnswer(proposal(f.item))) }).run(f,f.budget);
  assert.equal(semantic.status,'refused'); assert.equal(semantic.candidate,null); assert.equal(semantic.revision.receipt!.spend.calls,2); assert.equal(semantic.revision.receipt!.spend.tokens,null);
  assert.equal(semantic.revision.validation.issues[0].code,'TFCT1008');
  const saved = forecastMust(await forecastRevisionCommit(f.store,semantic)); assert.equal(saved.checkpoint.spend.calls,4); assert.equal(saved.checkpoint.spend.tokens,null);
  assert.equal(forecastMust(await forecastQuery(f.store,'harnesses')).length,1);
});
it('a note, revision or trace of another question is TFCT1003 without exposing its content',async () => {
  const f = await feedbackFixture(), other = await makeForecastFixture(' unrelated');
  forecastMust(await forecastQuestionCreate(f.store,other.questions)); forecastMust(await forecastCheckpointPlan(f.store,other.checkpoints));
  forecastMust(await forecastTransaction(f.store,async tx => { await tx.put('traces',other.traces); await tx.put('notes',other.notes); await tx.put('revisions',other.revisions); }));
  for (const source of ['note:' + other.notes.id,'revision:' + other.revisions.id,'trace:' + other.traces.id]) {
    const client = scriptedClient(async request => { assert.ok(!JSON.stringify(request.messages).includes('unrelated')); return feedbackAnswer(proposal({ ...f.item,sources: [source] })); });
    const result = await createInternalFeedbackEditor({ ...f,client }).run(f,f.budget);
    assert.equal(result.status,'refused'); assert.equal(result.revision.validation.issues[0].code,'TFCT1003'); assert.deepEqual(result.revision.committedGuidance,[]);
  }
});
it('editor and classifier clocks share cumulative allowance without double-counting elapsed time',async () => {
  const f = await feedbackFixture(); let time = 0;
  const classifier = createVolatileFactClassifier({ client: scriptedClient(async () => { time += 7; return feedbackAnswer({ verdicts: [{ index: 0,verdict: 'reusable',reason: 'A reusable procedure.' }] }); }),now: () => time });
  const result = await createInternalFeedbackEditor({ ...f,clock: () => time,classifier,client: scriptedClient(async request => {
    assert.ok(!JSON.stringify(request.messages).includes('unreachable outcome')); time += 5; return feedbackAnswer(proposal(f.item));
  }) }).run({ ...f,resolution: 'unreachable outcome' } as typeof f,f.budget);
  assert.equal(result.status,'staged'); assert.equal(result.revision.receipt!.spend.ms,12); assert.equal(result.revision.receipt!.budgetSpent.ms,12);
  assert.equal(result.revision.receipt!.budgetSpent.turns,f.budget.spent.turns + 2);
  assert.deepEqual(result.revision.receipt!.calls.map((c: any) => c.stage),['feedback','revision.gate']);
  forecastMust(await forecastRevisionCommit(f.store,result));
});
