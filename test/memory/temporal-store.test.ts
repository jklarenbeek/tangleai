import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalMemoryStore, createTemporalMemoryPersistence, createTemporalStoreAdapter, legacyTemporalProjection,
  temporalIdentity, type TemporalResult, type TemporalBundle, type TemporalOperation } from '@tangleai/memory/temporal';
import { createMemoryUnit, createMemoryUnitStore, recallByEmbedding } from '@tangleai/memory';
import { TEMPORAL_FIXTURES } from '../fixtures/temporal.ts';
import { buildTemporalFixture, rebuildTemporalFixture } from '../../benchmark/lib/temporal-runtime-fixtures.ts';

function must<T>(r: TemporalResult<T>): T { if (r.status !== 'success') throw Error(`${r.reason}: ${r.detail}`); return r.value; }
async function bundle(): Promise<TemporalBundle> { const { expected: _, ...fixture } = TEMPORAL_FIXTURES[0]; return must(await buildTemporalFixture(fixture)).bundle; }
test('projection activation is atomic, scoped, cloned and idempotent across memory reopen', async () => {
  const persistence = createTemporalMemoryPersistence(), store = createTemporalStoreAdapter(persistence), b = await bundle();
  assert.equal((await store.snapshot('absent')).status, 'refused');
  const receipt = must(await store.apply(b, { key: 'apply', expectedHead: null }));
  assert.equal(receipt.head.revision, 1); assert.equal(receipt.writes, 5);
  const snapshot = must(await store.snapshot(b.projection.scope)); snapshot.sources[0].text = 'tampered';
  assert.notEqual(must(await store.snapshot(b.projection.scope)).sources[0].text, 'tampered');
  assert.equal((await store.occurrence('foreign', b.sources[0].id)).status, 'refused');
  const before = store.stats();
  const replay = must(await store.apply(b, { key: 'apply', expectedHead: null }));
  assert.equal(replay.replayed, true); assert.equal(replay.writes, 0); assert.equal(store.stats().writes, before.writes);
  const reopened = createTemporalMemoryStore({ state: persistence.exportState() });
  assert.equal(must(await reopened.apply(b, { key: 'apply', expectedHead: null })).writes, 0);
  assert.equal(reopened.stats().writes, 0);
  const changed = must(await rebuildTemporalFixture(b, { policyIdentity: 'different' }));
  assert.equal((await store.apply(changed, { key: 'apply', expectedHead: null })).status, 'refused');
});
test('same-revision contenders have one winner and head revisions prevent ABA', async () => {
  const store = createTemporalMemoryStore(), a = await bundle(), b = must(await rebuildTemporalFixture(a, { policyIdentity: 'b' }));
  const outcomes = await Promise.all([store.apply(a, { key: 'a', expectedHead: null }), store.apply(b, { key: 'b', expectedHead: null })]);
  assert.equal(outcomes.filter(r => r.status === 'success').length, 1);
  assert.equal(outcomes.find(r => r.status !== 'success')?.reason, 'stale-projection');
  const first = must(await store.head(a.projection.scope))!;
  const second = must(await store.apply(b, { key: 'second', expectedHead: first })).head;
  const third = must(await store.apply(a, { key: 'third', expectedHead: second })).head;
  assert.equal(third.versionId, a.projection.versionId); assert.equal(third.revision, 3);
  const stale = await store.snapshot(a.projection.scope, first);
  assert.equal(stale.status !== 'success' && stale.reason, 'stale-projection');
});
test('failures at occurrence, claim, head and commit writes leave the prior projection intact', async () => {
  for (const step of ['put:occurrences', 'put:claims', 'put:heads', 'commit']) {
    let failing = false;
    const persistence = createTemporalMemoryPersistence({ applyProbe: current => { if (failing && current === step) throw Error('injected storage failure'); } });
    const store = createTemporalStoreAdapter(persistence), initial = await bundle();
    const prior = must(await store.apply(initial, { key: 'initial', expectedHead: null })).head;
    const { expected: _, ...fixture } = TEMPORAL_FIXTURES.find(f => f.id === 'T13')!;
    const changed = must(await buildTemporalFixture({ ...fixture, claims: TEMPORAL_FIXTURES[0].claims })).bundle;
    failing = true; const result = await store.apply(changed, { key: 'failed', expectedHead: prior }); failing = false;
    assert.equal(result.status !== 'success' && result.reason, 'storage-failure', step);
    assert.deepEqual(must(await store.head(initial.projection.scope)), prior);
    assert.equal(must(await store.snapshot(initial.projection.scope)).sources.length, 1);
  }
});
test('incomplete activation and mid-write cancellation never replace a head', async () => {
  const abort = new AbortController();
  const store = createTemporalMemoryStore({ applyProbe: step => { if (step === 'put:claims') abort.abort(); } });
  const b = await bundle(), incomplete = must(await rebuildTemporalFixture(b, { complete: false }));
  assert.equal((await store.apply(incomplete, { key: 'incomplete', expectedHead: null })).status, 'refused');
  assert.equal((await store.apply(b, { key: 'cancel', expectedHead: null, signal: abort.signal })).status, 'refused');
  assert.equal(must(await store.head(b.projection.scope)), null);
  assert.equal(store.stats().writes, 0);
});
test('durable operation reservations retain identity and reject stale or excessive attempts', async () => {
  const store = createTemporalMemoryStore(), input = { scope: 'scope', key: 'work', requestIdentity: await temporalIdentity('work'), maxPhysicalRequests: 1 };
  const first = must(await store.reserveOperation(input)), before = store.stats().writes;
  assert.equal(must(await store.reserveOperation(input)).replayed, true); assert.equal(store.stats().writes, before);
  assert.equal((await store.reserveOperation({ ...input, maxPhysicalRequests: 2 })).status, 'refused');
  const next: TemporalOperation = { ...first.operation, phase: 'in-flight', revision: 1,
    attempts: [{ role: 'extract', phase: 'in-flight', inputTokens: 3, outputTokens: null, requestHash: await temporalIdentity('request'), reply: null }] };
  must(await store.updateOperation(next, 0));
  assert.equal((await store.updateOperation({ ...next, revision: 2 }, 0)).status, 'refused');
  const tooMany = await store.updateOperation({ ...next, revision: 2, attempts: [...next.attempts, ...next.attempts] }, 1);
  assert.equal(tooMany.status !== 'success' && tooMany.reason, 'budget-exhausted');
});
test('explicit legacy backfill preserves existing text identity, supersession and ordinary recall', async () => {
  const unit = createMemoryUnit({ text: 'An observed historical note.', evidence: 'host:evidence', at: '2024-03-01T00:00:00Z', embedding: [1, 0], embeddedBy: { model: 'fixture-2', dims: 2 } });
  unit.supersededBy = 'another'; unit.supersededAt = '2024-04-01T00:00:00Z';
  const ordinary = createMemoryUnitStore(); await ordinary.put(unit);
  const before = recallByEmbedding(await ordinary.list(), [1, 0]);
  const projected = must(await legacyTemporalProjection(await ordinary.list(), { scope: 'legacy', subject: 'alex', embeddedBy: { model: 'fixture-2', dims: 2 } }));
  assert.equal(projected.unrecoverableHistory, true); assert.equal(projected.unknownValidity, 1);
  assert.equal(projected.bundle.sources[0].legacyMemoryId, unit.id);
  assert.deepEqual(projected.bundle.claims[0].time, { kind: 'unknown' });
  const temporal = createTemporalMemoryStore(); must(await temporal.apply(projected.bundle, { key: 'backfill', expectedHead: null }));
  assert.deepEqual(await ordinary.list(), [unit]); assert.deepEqual(recallByEmbedding(await ordinary.list(), [1, 0]), before);
  assert.equal(before.ranked.length, 0); assert.equal(must(await temporal.snapshot('legacy')).sources.length, 1);
});
