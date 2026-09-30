import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createVolatileFactClassifier, createHarnessRefiner, forecastSemanticStage } from '@tangleai/forecast';
import { scriptedClient } from './runtime-fixture.ts';
import { makeForecastFixture } from './fixtures.ts';
import { feedbackAnswer } from './feedback-fixture.ts';
const context = { questionPrompt: 'Will Tidewater approve the bill?',adapterOptions: ['approve','reject'],evidenceExcerpts: [],toolResultExcerpts: [],questionId: 'a'.repeat(64),checkpointIds: [] };
const item = { component: 'evidenceHandling' as const,text: 'Compare independent observations.',sources: ['note:' + 'b'.repeat(64)] };
it('the classifier repairs incomplete coverage once and records unknown usage without model calls in validation',async () => {
  let calls = 0;
  const classifier = createVolatileFactClassifier({ client: scriptedClient(async () => feedbackAnswer({ verdicts: calls++ ? [{ index: 0,verdict: 'reusable',reason: 'A procedure.' }] : [] },null)),now: () => 0 });
  const result = await classifier.classify([item],context,{ turns: 3,ms: 1000 });
  assert.equal(result.failure,null); assert.equal(calls,2); assert.equal(result.spend.tokens,null); assert.equal(result.budgetSpent.turns,2); assert.equal(result.semantic.stage,'revision.gate');
  const f = await makeForecastFixture(), refiner = await createHarnessRefiner({ parent: f.harnesses,context,sources: item.sources,semantic: result.semantic,now: () => f.questions.issuedAt });
  assert.equal((await refiner.prepareGuidance([item])).valid,true); assert.equal(calls,2);
  const empty = await classifier.classify([],context,{ turns: 0,ms: 1000 }); assert.equal(empty.spend.calls,0); assert.equal(empty.spend.tokens,0); assert.equal(calls,2);
});
it('a stopped or malformed classifier result fails closed and keeps its charged receipt',async () => {
  for (const finishReason of ['length',undefined,'stop']) {
    let calls = 0;
    const classifier = createVolatileFactClassifier({ client: scriptedClient(async () => { calls++; return { ...feedbackAnswer({ verdicts: [{ index: 1,verdict: 'reusable',reason: 'Wrong index.' }] },{ total_tokens: 0 }),finishReason }; }),now: () => 0 });
    const result = await classifier.classify([item],context,{ turns: 2,tokens: 0,ms: 1000 });
    // A zero token budget admits no purchase, while a known zero usage result
    // must remain zero when a purchase has a nonzero allowance.
    assert.ok(result.failure); assert.equal(result.spend.calls,0);
    const charged = await classifier.classify([item],context,{ turns: 2,tokens: 10000,ms: 1000 });
    assert.ok(charged.failure); assert.equal(charged.spend.tokens,0); assert.equal(charged.spend.calls,finishReason === 'stop' ? 2 : 1);
    assert.equal(calls,charged.spend.calls);
  }
  assert.deepEqual((await forecastSemanticStage({ result: 'not-run' })).result,{ result: 'not-run' });
});
