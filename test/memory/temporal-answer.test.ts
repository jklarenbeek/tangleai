import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalMemoryStore, answerTemporal, temporalValue, renderTemporalAnswer, type TemporalQuery } from '@tangleai/memory/temporal';
import { buildTemporalFixture, completeTemporalFixtureInput } from '../../benchmark/lib/temporal-runtime-fixtures.ts';
import { TEMPORAL_FIXTURES } from '../fixtures/temporal.ts';
import { runTemporalConformance } from '../../benchmark/lib/temporal-conformance.ts';
import { temporalRuntimeAdapters } from '../../benchmark/lib/temporal-runtime.ts';
test('every independent fixture executes and passes on memory and both actual SQLite runtimes', async () => {
  const report = await runTemporalConformance({ sourceHash: 'a'.repeat(64), registrationHash: null,
    lme: { status: 'unavailable', qa: null, retrieval: null, futureGoldQuestions: null }, locomo: { status: 'unavailable', scorable: null, adversarial: null, anchoredQuestions: null } }, await temporalRuntimeAdapters());
  assert.deepEqual(report.counts, { planned: 138, passed: 138, failed: 0, notImplemented: 0, unavailable: 0 });
  assert.equal(report.gate.implementationComplete, true); assert.ok(report.wrongControls.every(c => c.rejected));
});
test('strict elapsed answers contain both exact citations and code-derived clamped calendar results', async () => {
  for (const id of ['T24', 'T25', 'T27', 'T28', 'T41']) {
    const fixture = TEMPORAL_FIXTURES.find(f => f.id === id)!, { expected, ...input } = fixture;
    const s = completeTemporalFixtureInput(input), built = temporalValue(await buildTemporalFixture(s)), store = createTemporalMemoryStore();
    const head = temporalValue(await store.apply(built.bundle, { key: 'apply', expectedHead: null })).head;
    const query: TemporalQuery = { scope: built.bundle.projection.scope, text: 'Elapsed time', anchor: null, knowledge: built.bundle.projection.knowledge,
      subject: 'alex', series: null, embeddedBy: built.bundle.projection.embeddedBy, embedding: [1, 0], candidatePool: 100, k: 10, minScore: 0, expectedHead: head,
      operation: { kind: 'elapsed', fromSeries: { subject: 'alex', key: 'recovery' }, toSeries: { subject: 'alex', key: 'jog' }, unit: input.input.unit as 'day' | 'week' | 'month' } };
    const answer = await answerTemporal(store, query);
    assert.equal(answer.status, expected.status, id);
    if (answer.status === 'success') {
      assert.deepEqual(answer.value.value, expected.value, id); assert.equal(answer.value.citations.length, 2);
      assert.ok(answer.value.citations.every(c => answer.value.recall.sources.some(s => s.id === c.sourceId && s.text.slice(c.start, c.end) === c.quote)));
      assert.match(answer.value.rule, /Jaren anchored calendar clamping/); assert.match(renderTemporalAnswer(answer.value), /\[/);
    } else assert.equal(answer.reason, expected.reason);
  }
});
test('exact event ordering uses event instants and keeps stable ties independent of source observation order', async () => {
  const fixture = TEMPORAL_FIXTURES.find(f => f.id === 'T25')!, { expected: _, ...s } = fixture;
  const built = temporalValue(await buildTemporalFixture({ ...s, claims: s.claims.map(c => ({ ...c, precision: 'millisecond' })) }));
  const store = createTemporalMemoryStore(), head = temporalValue(await store.apply(built.bundle, { key: 'apply', expectedHead: null })).head;
  const answer = temporalValue(await answerTemporal(store, { scope: built.bundle.projection.scope, text: 'Order events', anchor: null, knowledge: built.bundle.projection.knowledge,
    subject: 'alex', series: null, embeddedBy: built.bundle.projection.embeddedBy, embedding: [1, 0], candidatePool: 100, k: 10, minScore: 0, expectedHead: head, operation: { kind: 'order' } }));
  assert.deepEqual((answer.value as { value: string }[]).map(v => v.value), ['recovery', 'jog']); assert.equal(answer.citations.length, 2);
});
