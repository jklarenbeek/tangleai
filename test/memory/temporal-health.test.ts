import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalMemoryStore, temporalValue, temporalIdentity, validateTemporalBundle, claimContains, claimOverlaps,
  temporalClaimsConflict, answerTemporal, renderTemporalAnswer, type TemporalQuery, type TemporalClaim, type TemporalOperation } from '@tangleai/memory/temporal';
import { TEMPORAL_FIXTURES } from '../fixtures/temporal.ts';
import { buildTemporalFixture } from '../../benchmark/lib/temporal-runtime-fixtures.ts';

async function events() {
  const { expected: _, ...fixture } = TEMPORAL_FIXTURES.find(f => f.id === 'T25')!;
  const built = temporalValue(await buildTemporalFixture({ ...fixture, claims: fixture.claims.map(c => ({ ...c, precision: 'millisecond' })) }));
  const store = createTemporalMemoryStore();
  const head = temporalValue(await store.apply(built.bundle, { key: 'events', expectedHead: null })).head;
  const query: TemporalQuery = { scope: head.scope, text: 'Order events', anchor: null, knowledge: built.bundle.projection.knowledge,
    subject: 'alex', series: null, embeddedBy: built.bundle.projection.embeddedBy, embedding: [1, 0], candidatePool: 100, k: 10,
    minScore: 0, expectedHead: head, operation: { kind: 'order' } };
  return { built, store, query };
}
test('closed bundle validation rejects extra authority before any store write', async () => {
  const { built } = await events(), bundle = { ...built.bundle, privileged: true };
  assert.equal((await validateTemporalBundle(bundle)).status, 'refused');
  const store = createTemporalMemoryStore();
  assert.equal((await store.apply(bundle, { key: 'bad', expectedHead: null })).status, 'refused');
  assert.equal(store.stats().writes, 0); assert.equal(temporalValue(await store.head(bundle.projection.scope)), null);
});
test('uncertainty refuses inside support and excludes instants outside definite bounds', () => {
  const start = Date.UTC(2024, 1, 1), end = Date.UTC(2024, 2, 1);
  const period = { kind: 'period' as const, from: '2024-02-01T00:00:00Z', until: '2024-03-01T00:00:00Z', precision: 'month' as const };
  const point = { kind: 'point' as const, at: period.from, precision: 'day' as const };
  const state = { kind: 'state' as const, from: period.from, until: { kind: 'unknown' as const }, precision: 'day' as const };
  for (const time of [period, point, state]) {
    assert.deepEqual(claimContains(time, start - 1), { status: 'success', value: false });
    assert.equal(claimContains(time, start).status, 'refused');
  }
  assert.deepEqual(claimContains(period, end), { status: 'success', value: false });
  assert.deepEqual(claimContains(point, start + 86400000), { status: 'success', value: false });
  assert.deepEqual(claimOverlaps(state, start - 86400000, start), { status: 'success', value: false });
  assert.equal(claimOverlaps(state, start, end).status, 'refused');
});
test('state assertions conflict with incompatible events wholly inside their validity', async () => {
  const { built } = await events(), base = built.bundle.claims[0];
  const state: TemporalClaim = { ...base, value: 'Elm', time: { kind: 'state', from: '2024-01-01T00:00:00Z', until: { kind: 'at', at: '2024-03-01T00:00:00Z' }, precision: 'day' } };
  for (const time of [
    { kind: 'point', at: '2024-02-01T00:00:00Z', precision: 'millisecond' },
    { kind: 'point', at: '2024-02-01T00:00:00Z', precision: 'day' },
    { kind: 'period', from: '2024-02-01T00:00:00Z', until: '2024-03-01T00:00:00Z', precision: 'month' },
  ] as TemporalClaim['time'][]) {
    const event = { ...base, value: 'Oak', time };
    assert.equal(temporalClaimsConflict([state, event]), true);
    assert.equal(temporalClaimsConflict([event, state]), true);
    assert.equal(temporalClaimsConflict([state, { ...event, series: { subject: 'other', key: base.series.key } }]), false);
  }
  assert.equal(temporalClaimsConflict([state, { ...base, value: 'Oak', time: { kind: 'point', at: '2024-03-01T00:00:00Z', precision: 'millisecond' } }]), false);
});
test('a bounded missing elapsed operand counts its actual incomplete-index refusal', async () => {
  const { store, query } = await events();
  const answer = await answerTemporal(store, { ...query, candidatePool: 1, k: 1,
    operation: { kind: 'elapsed', fromSeries: { subject: 'alex', key: 'recovery' }, toSeries: { subject: 'alex', key: 'jog' }, unit: 'week' } });
  assert.equal(answer.status, 'refused');
  assert.equal(answer.reason, 'incomplete-index'); assert.deepEqual(answer.coverage?.refusals, { 'incomplete-index': 1 });
});
test('rendering preserves kernel event order even when recall claim IDs sort differently', async () => {
  const { store, query } = await events(), answer = temporalValue(await answerTemporal(store, query));
  const ordered = (answer.value as { claimId: string }[]).map(row => answer.recall.claims.find(c => c.id === row.claimId)!);
  const rendered = renderTemporalAnswer({ ...answer, recall: { ...answer.recall, claims: [...ordered].reverse() } });
  assert.ok(rendered.indexOf(`: ${ordered[0].value} (`) < rendered.indexOf(`: ${ordered[1].value} (`), rendered);
  for (const cite of answer.citations) assert.ok(rendered.includes(`[${cite.sourceId}:${cite.start}-${cite.end}]`));
});
test('durable attempts cannot carry a response before transport or hide an uncertain terminal outcome', async () => {
  const store = createTemporalMemoryStore();
  const prior = temporalValue(await store.reserveOperation({ scope: 'scope', key: 'health', requestIdentity: await temporalIdentity('health'), maxPhysicalRequests: 1 })).operation;
  const next: TemporalOperation = { ...prior, phase: 'in-flight', revision: 1,
    attempts: [{ role: 'extract', phase: 'in-flight', inputTokens: 1, outputTokens: null, requestHash: await temporalIdentity('wire'), reply: null }] };
  for (const extra of [{ reply: 'prewritten' }, { outputTokens: 1 }]) {
    assert.equal((await store.updateOperation({ ...next, attempts: [{ ...next.attempts[0], ...extra }] }, 0)).status, 'refused');
    assert.equal(temporalValue(await store.operation('scope', 'health'))!.revision, 0);
  }
  temporalValue(await store.updateOperation(next, 0));
  assert.equal((await store.updateOperation({ ...next, revision: 2, phase: 'failed', receipt: { reason: 'error' } }, 1)).status, 'refused');
  assert.equal((await store.updateOperation({ ...next, revision: 2, attempts: [{ ...next.attempts[0], reply: 'too early' }] }, 1)).status, 'refused');
  const recovered = temporalValue(await store.updateOperation({ ...next, revision: 2, phase: 'unknown',
    attempts: [{ ...next.attempts[0], phase: 'unknown' }], receipt: { reason: 'owner-stopped' } }, 1));
  assert.equal(recovered.phase, 'unknown');
});
