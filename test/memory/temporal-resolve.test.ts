import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { resolveTemporalWindow, resolveTemporalProposal, temporalStamp, temporalValue, temporalEnglishNames, proposeTemporalQuery,
  createTemporalMemoryStore, createTemporalSessionIndex } from '@tangleai/memory/temporal';
import { temporalTestBundle, chatResponse, TEMPORAL_TEST_MODEL, TEMPORAL_TEST_LIMITS } from '../fixtures/temporal-provider.ts';
import { rebuildTemporalFixture } from '../../benchmark/lib/temporal-runtime-fixtures.ts';
test('symbolic calendar windows use explicit anchors, Jaren locale names and an explicitly injected DST clock', () => {
  assert.equal(temporalEnglishNames.months[1], 'February');
  assert.equal(resolveTemporalWindow('yesterday').status, 'refused');
  const anchor = temporalValue(temporalStamp('2024-03-15T12:00:00Z'));
  assert.deepEqual(temporalValue(resolveTemporalWindow('previous-month', anchor)), { from: '2024-02-01T00:00:00.000Z', until: '2024-03-01T00:00:00.000Z', precision: 'month' });
  assert.equal(resolveTemporalWindow('summer', anchor).status, 'refused');
  assert.equal(resolveTemporalWindow('yesterday', anchor, { zone: 'Europe/Amsterdam' }).status, 'refused');
  const dst = temporalValue(resolveTemporalWindow('yesterday', temporalValue(temporalStamp('2024-04-01T12:00:00Z')), { zone: 'Europe/Amsterdam', provider: createIntlZoneProvider() }));
  assert.deepEqual(dst, { from: '2024-03-30T23:00:00.000Z', until: '2024-03-31T22:00:00.000Z', precision: 'day' });
});
test('query proposals validate exact spans, bypass ordinary questions and refuse ambiguous numeric dates', () => {
  const text = 'Where yesterday?', proposal = { subject: 'alex', series: 'address', operation: { kind: 'relative', operand: 'yesterday' }, citations: [{ start: 6, end: 15, quote: 'yesterday' }] };
  assert.equal(resolveTemporalProposal(proposal, text).status, 'refused');
  assert.equal(resolveTemporalProposal({ ...proposal, citations: [{ start: 1, end: 3, quote: 'xx' }] }, text).status, 'refused');
  assert.equal(resolveTemporalProposal({ ...proposal, operation: { kind: 'at', at: '03/04/2024' } }, text).status, 'refused');
  const ordinary = resolveTemporalProposal({ ...proposal, operation: { kind: 'none' } }, text);
  assert.equal(ordinary.status, 'fallback'); assert.equal(ordinary.reason, 'ordinary-query');
});
test('scripted query proposal is persisted and resolves by code on replay without a second purchase', async () => {
  const store = createTemporalMemoryStore(), input = { scope: 's', key: 'resolve', text: 'yesterday', anchor: temporalValue(temporalStamp('2024-03-01T12:00:00Z')), limits: TEMPORAL_TEST_LIMITS, clockIdentity: 'explicit-offset-v1' }; let calls = 0;
  const options = { store, model: TEMPORAL_TEST_MODEL, fetch: async () => { calls++; return chatResponse({ subject: null, series: null, operation: { kind: 'relative', operand: 'yesterday' }, citations: [{ start: 0, end: 9, quote: 'yesterday' }] }); } };
  const first = temporalValue(await proposeTemporalQuery(input, options)), writes = store.stats().writes;
  assert.deepEqual(first.operation, { kind: 'overlaps', from: '2024-02-29T00:00:00.000Z', until: '2024-03-01T00:00:00.000Z' });
  assert.deepEqual(temporalValue(await proposeTemporalQuery(input, options)), first); assert.equal(calls, 1); assert.equal(store.stats().writes, writes);
});
test('observation caches build once per version and never span gaps between exact session stamps', async () => {
  const store = createTemporalMemoryStore(), bundle = await temporalTestBundle(), cache = createTemporalSessionIndex(store);
  const head = temporalValue(await store.apply(bundle, { key: 'a', expectedHead: null })).head;
  const first = temporalValue(await cache.get(bundle.projection.scope));
  assert.deepEqual(first.at(0), [bundle.sources[0].id]); assert.deepEqual(first.at(1), []);
  assert.equal(temporalValue(await cache.get(bundle.projection.scope)), first); assert.equal(cache.stats().constructions, 1);
  const changed = temporalValue(await rebuildTemporalFixture(bundle, { policyIdentity: 'changed' }));
  temporalValue(await store.apply(changed, { key: 'b', expectedHead: head })); temporalValue(await cache.get(bundle.projection.scope));
  assert.equal(cache.stats().constructions, 2);
  const reopenedCache = createTemporalSessionIndex(store); temporalValue(await reopenedCache.get(bundle.projection.scope)); assert.equal(reopenedCache.stats().constructions, 1);
});
test('declared minute precision creates only its own observation bucket, not a session duration', async () => {
  const { createSourceOccurrence, createTemporalProjection } = await import('@tangleai/memory/temporal');
  const store = createTemporalMemoryStore();
  const source = temporalValue(await createSourceOccurrence({ scope: 'minute', sessionOrdinal: 0, turnOrdinal: 0, role: 'host', text: 'Seen during a minute.', sourceLocator: 'host',
    observedAt: temporalValue(temporalStamp('2024-01-01T00:00:00Z', { precision: 'minute' })), knownAt: '2024-01-01T00:00:00Z' }));
  const bundle = temporalValue(await createTemporalProjection({ scope: 'minute', sources: [source], claims: [], sourceIdentity: 'host', viewIdentity: 'minute', policyIdentity: 'host', modelIdentity: 'host', promptIdentity: 'none',
    knowledge: { mode: 'provided-history' }, embeddedBy: { model: 'none', dims: 1 }, embeddings: [], complete: true }));
  temporalValue(await store.apply(bundle, { key: 'minute', expectedHead: null }));
  const index = temporalValue(await createTemporalSessionIndex(store).get('minute'));
  assert.deepEqual(index.at(1704067259999), [source.id]); assert.deepEqual(index.at(1704067260000), []);
});
