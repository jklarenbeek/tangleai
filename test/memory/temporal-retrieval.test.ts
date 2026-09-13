import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalMemoryStore, recallTemporal, recallTemporalWithFallback, temporalValue, type TemporalQuery } from '@tangleai/memory/temporal';
import { createMemoryUnit, recallByEmbedding } from '@tangleai/memory';
import { temporalTestBundle } from '../fixtures/temporal-provider.ts';
import { buildTemporalFixture, rebuildTemporalFixture } from '../../benchmark/lib/temporal-runtime-fixtures.ts';
import { TEMPORAL_FIXTURES } from '../fixtures/temporal.ts';
export async function temporalQueryFixture(id = 'T01') {
  const { expected: _, ...s } = TEMPORAL_FIXTURES.find(f => f.id === id)!;
  const built = temporalValue(await buildTemporalFixture(s)), store = createTemporalMemoryStore();
  const head = temporalValue(await store.apply(built.bundle, { key: 'prepare', expectedHead: null })).head;
  const query: TemporalQuery = { scope: built.bundle.projection.scope, text: 'Alex address at time', anchor: null, knowledge: built.bundle.projection.knowledge,
    operation: { kind: 'at', at: '1970-01-01T00:00:00.005Z' }, subject: 'alex', series: 'address', embeddedBy: built.bundle.projection.embeddedBy,
    embedding: [1, 0], candidatePool: 100, k: 10, minScore: 0, expectedHead: head };
  return { ...built, store, query };
}
test('temporal results report scope, semantic pool and eligibility while ordinary supersession stays unchanged', async () => {
  const { store, query } = await temporalQueryFixture();
  const recall = temporalValue(await recallTemporal(store, query));
  assert.deepEqual(recall.coverage, { occurrences: 1, comparable: 1, semanticCandidates: 1, eligibleClaims: 1, selected: 1, poolTruncated: false, complete: true, refusals: {} });
  const unit = createMemoryUnit({ text: 'ordinary', evidence: 'host', at: '1970-01-01T00:00:00Z', embedding: [1, 0], embeddedBy: query.embeddedBy });
  unit.supersededBy = 'replacement'; unit.supersededAt = '1970-01-02T00:00:00Z';
  const baseline = recallByEmbedding([unit], query.embedding, { identity: query.embeddedBy });
  const fallback = await recallTemporalWithFallback(store, { ...query, operation: { kind: 'none' } }, { units: [unit] });
  assert.equal(fallback.temporal.status, 'fallback'); assert.deepEqual(fallback.ordinary, baseline); assert.equal(baseline.ranked.length, 0);
  assert.deepEqual(temporalValue(await recallTemporal(store, query)), recall);
});
test('missing vectors and invalid query bounds refuse without inventing a no-match or crossing knowledge views', async () => {
  const { store, query, bundle } = await temporalQueryFixture();
  const bare = temporalValue(await rebuildTemporalFixture(bundle, { embeddings: [] }));
  const head = temporalValue(await store.apply(bare, { key: 'bare', expectedHead: query.expectedHead })).head;
  const missing = await recallTemporal(store, { ...query, expectedHead: head });
  assert.equal(missing.status !== 'success' && missing.reason, 'incomplete-index');
  if (missing.status !== 'success') assert.equal(missing.coverage!.comparable, 0);
  const reversed = await recallTemporal(store, { ...query, expectedHead: head, operation: { kind: 'overlaps', from: '1970-01-01T00:00:01Z', until: '1970-01-01T00:00:00Z' } });
  assert.equal(reversed.status !== 'success' && reversed.reason, 'invalid-time');
  const wrongView = await recallTemporal(store, { ...query, expectedHead: head, knowledge: { mode: 'strict-as-of', cutoff: '1970-01-01T00:00:00Z' } });
  assert.equal(wrongView.status !== 'success' && wrongView.reason, 'identity-mismatch');
});
test('a bounded semantic miss is incomplete and cannot be repaired by a hidden larger timestamp pool', async () => {
  const base = await temporalTestBundle(), original = TEMPORAL_FIXTURES[0];
  const fixture = { ...original, sources: [original.sources[0], { ...original.sources[0], id: 's2', text: 'Alex still lives on Oak later.', observed: 20 }],
    claims: [original.claims[0], { ...original.claims[0], id: 'c2', source: 's2', from: 20, until: 30, value: 'Oak' }] };
  const built = temporalValue(await buildTemporalFixture(fixture));
  const firstSource = built.bundle.sources.find(s => built.sourceNames[s.id] === 's1')!, secondSource = built.bundle.sources.find(s => built.sourceNames[s.id] === 's2')!;
  const prepared = temporalValue(await rebuildTemporalFixture(built.bundle, { embeddings: [{ sourceId: firstSource.id, vector: [1, 0] }, { sourceId: secondSource.id, vector: [.5, .5] }] }));
  const store = createTemporalMemoryStore(), head = temporalValue(await store.apply(prepared, { key: 'pool', expectedHead: null })).head;
  const { query } = await temporalQueryFixture();
  const miss = await recallTemporal(store, { ...query, expectedHead: head, operation: { kind: 'as-of', at: '1970-01-01T00:00:00.025Z' }, candidatePool: 1, k: 1 });
  assert.equal(miss.status !== 'success' && miss.reason, 'incomplete-index');
  if (miss.status !== 'success') { assert.equal(miss.coverage!.semanticCandidates, 1); assert.equal(miss.coverage!.poolTruncated, true); }
  const wider = temporalValue(await recallTemporal(store, { ...query, expectedHead: head, operation: { kind: 'as-of', at: '1970-01-01T00:00:00.025Z' }, candidatePool: 2, k: 1 }));
  assert.deepEqual(wider.sourceIds, [secondSource.id]); assert.equal(wider.coverage.semanticCandidates, 2); assert.equal(base.sources.length, 1);
});
test('duplicate compatible claims retain every citation and conflicting claims cannot be dropped to fit k', async () => {
  const original = TEMPORAL_FIXTURES[0];
  const built = temporalValue(await buildTemporalFixture({ ...original, sources: [original.sources[0], { ...original.sources[0], id: 's2', observed: 20 }],
    claims: [original.claims[0], { ...original.claims[0], id: 'c2', source: 's2' }] }));
  const store = createTemporalMemoryStore(), head = temporalValue(await store.apply(built.bundle, { key: 'duplicates', expectedHead: null })).head;
  const { query } = await temporalQueryFixture();
  assert.equal(temporalValue(await recallTemporal(store, { ...query, expectedHead: head })).sources.length, 2);
  const limited = await recallTemporal(store, { ...query, expectedHead: head, k: 1 });
  assert.equal(limited.status !== 'success' && limited.reason, 'incomplete-index');
  const conflict = await temporalQueryFixture('T09');
  const result = await recallTemporal(conflict.store, { ...conflict.query, k: 1 });
  assert.equal(result.status !== 'success' && result.reason, 'conflicting-claims');
});
test('subject qualification cannot expand the original semantic pool past better ranked unrelated sources', async () => {
  const original = TEMPORAL_FIXTURES[0];
  const built = temporalValue(await buildTemporalFixture({ ...original,
    sources: [original.sources[0], { ...original.sources[0], id: 's2', text: 'Bea lives on Oak.' }],
    claims: [original.claims[0], { ...original.claims[0], id: 'c2', source: 's2', subject: 'bea', value: 'Oak' }] }));
  const prepared = temporalValue(await rebuildTemporalFixture(built.bundle, { embeddings: built.bundle.sources.map(s => ({ sourceId: s.id, vector: built.sourceNames[s.id] === 's1' ? [.5, .5] : [1, 0] })) }));
  const store = createTemporalMemoryStore(), head = temporalValue(await store.apply(prepared, { key: 'pool', expectedHead: null })).head;
  const { query } = await temporalQueryFixture();
  const result = await recallTemporal(store, { ...query, expectedHead: head, candidatePool: 1, k: 1 });
  assert.equal(result.status !== 'success' && result.reason, 'incomplete-index');
  const wider = temporalValue(await recallTemporal(store, { ...query, expectedHead: head, candidatePool: 2, k: 1 }));
  assert.deepEqual(wider.claims.map(c => c.series.subject), ['alex']);
});
