import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallPlace, recallPlaceWithFallback, type PlaceQuery } from '@tangleai/memory/place';
import { createMemoryUnit, recallByEmbedding } from '@tangleai/memory';
import { rebuildTemporalFixture } from '../../benchmark/lib/temporal-runtime-fixtures.ts';
import { placeValue } from './place-fixture.ts';
import { placeHistory, exactPlaceTime } from './place-history.ts';

test('place queries require a subject, exact knowledge and embedding identities, and the captured head', async () => {
  const h = await placeHistory([{ time: exactPlaceTime(0) }]), stores = { temporal: h.store, gazetteer: h.gazetteer };
  const { subject: _, ...noSubject } = h.query;
  const missing = await recallPlace(stores, noSubject as PlaceQuery);
  assert.equal(missing.status === 'refused' && missing.code, 'TPLC1001');
  for (const patch of [{ knowledge: { mode: 'strict-as-of' as const, cutoff: '2026-10-01T00:00:00Z' } },
    { embeddedBy: { ...h.query.embeddedBy, model: 'foreign' } }, { embedding: [1] }]) {
    const result = await recallPlace(stores, { ...h.query, ...patch });
    assert.equal(result.status === 'refused' && result.code, 'TPLC1009'); assert.equal(result.status === 'refused' && result.cause, 'identity-mismatch');
    if (result.status === 'refused') { assert.equal(result.coverage?.occurrences, 1); assert.equal(result.coverage?.complete, false); }
  }
  const stale = await recallPlace(stores, { ...h.query, expectedHead: { ...h.receipt.head, revision: h.receipt.head.revision + 1 } });
  assert.equal(stale.status === 'refused' && stale.cause, 'stale-projection');
});

test('event and position evidence share one source pool and final k without hidden widening', async () => {
  const h = await placeHistory([{ time: exactPlaceTime(0) }, { time: exactPlaceTime(0), series: 'event' }]);
  const stores = { temporal: h.store, gazetteer: h.gazetteer }, query: PlaceQuery = { ...h.query, operation: { kind: 'location-at-event', eventClaimId: h.claims[1].id } };
  const small = await recallPlace(stores, { ...query, candidatePool: 1, k: 1 });
  assert.equal(small.status === 'refused' && small.code, 'TPLC1011');
  if (small.status === 'refused') assert.deepEqual(small.coverage, { occurrences: 2, comparable: 2, semanticCandidates: 1, positions: 1, unplaceable: 0, poolTruncated: true, complete: false });
  const finalK = await recallPlace(stores, { ...query, candidatePool: 2, k: 1 });
  assert.equal(finalK.status === 'refused' && finalK.code, 'TPLC1011');
  const success = placeValue(await recallPlace(stores, { ...query, candidatePool: 2, k: 2 }));
  assert.equal(success.sources.length, 2); assert.equal(success.claims.length, 2); assert.equal(success.coverage.complete, true);
  assert.deepEqual(success.answer.sourceIds, h.sources.map(source => source.id).sort());
  const noScore = await recallPlace(stores, { ...query, embedding: [-1, 0], minScore: 1 });
  assert.equal(noScore.status === 'refused' && noScore.code, 'TPLC1011');
});

test('missing vectors and foreign events stay explicit rather than being replaced by a current position', async () => {
  const h = await placeHistory([{ time: exactPlaceTime(0) }, { time: exactPlaceTime(0), subject: 'blair', series: 'event' }]);
  const stores = { temporal: h.store, gazetteer: h.gazetteer };
  const foreign = await recallPlace(stores, { ...h.query, operation: { kind: 'location-at-event', eventClaimId: h.claims[1].id } });
  assert.equal(foreign.status === 'refused' && foreign.cause, 'identity-mismatch');
  const missing = await recallPlace(stores, { ...h.query, operation: { kind: 'location-at-event', eventClaimId: '0'.repeat(64) } });
  assert.equal(missing.status === 'refused' && missing.cause, 'incomplete-index');
  const bundle = placeValue(await rebuildTemporalFixture(h.bundle, { embeddings: [] }));
  const receipt = placeValue(await h.store.apply(bundle, { key: 'unembedded', expectedHead: h.receipt.head }));
  const unembedded = await recallPlace(stores, { ...h.query, expectedHead: receipt.head });
  assert.equal(unembedded.status === 'refused' && unembedded.code, 'TPLC1011');
  if (unembedded.status === 'refused') { assert.equal(unembedded.coverage?.comparable, 0); assert.equal(unembedded.coverage?.positions, 1); }
});

test('fallback preserves the refusal and returns independently ranked ordinary memory', async () => {
  const h = await placeHistory([{ time: exactPlaceTime(0) }]), stores = { temporal: h.store, gazetteer: h.gazetteer };
  const unit = createMemoryUnit({ text: 'Ordinary host memory', evidence: 'host', at: '2026-09-01T00:00:00Z', embedding: [1, 0], embeddedBy: h.query.embeddedBy });
  const query: PlaceQuery = { ...h.query, operation: { kind: 'location-at', at: new Date(1).toISOString() } };
  const result = await recallPlaceWithFallback(stores, query, { units: [unit] });
  assert.equal(result.place.status === 'refused' && result.place.code, 'TPLC1008');
  assert.deepEqual(result.ordinary, recallByEmbedding([unit], query.embedding, { identity: query.embeddedBy }));
  assert.equal(result.ordinary?.ranked[0].unit.id, unit.id);
  const success = await recallPlaceWithFallback(stores, h.query, { units: [unit] }); assert.equal(success.ordinary, null);
});

test('uncertain position coverage is retained in a failed answer', async () => {
  const h = await placeHistory([{ time: { kind: 'unknown' }, status: 'unknown' }, { time: exactPlaceTime(0) }]);
  const result = await recallPlace({ temporal: h.store, gazetteer: h.gazetteer }, h.query);
  assert.equal(result.status === 'refused' && result.cause, 'unknown-validity');
  if (result.status === 'refused') { assert.equal(result.coverage?.positions, 2); assert.equal(result.coverage?.unplaceable, 1); }
});
