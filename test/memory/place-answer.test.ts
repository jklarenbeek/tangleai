import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoDistance } from '@jarenjs/core/geo';
import { answerPlace, renderPlaceAnswer, checkPlace } from '@tangleai/memory/place';
import { validateSourceSpan, createTemporalClaim } from '@tangleai/memory/temporal';
import { rebuildTemporalFixture } from '../../benchmark/lib/temporal-runtime-fixtures.ts';
import { placeValue } from './place-fixture.ts';
import { placeHistory, exactPlaceTime } from './place-history.ts';

test('deterministic answers render exact gazetteer names, integer metres and every deduplicated source span', async () => {
  const h = await placeHistory([{ time: exactPlaceTime(0) }, { time: exactPlaceTime(10) }]), stores = { temporal: h.store, gazetteer: h.gazetteer };
  const result = placeValue(await answerPlace(stores, { ...h.query, operation: { kind: 'movement', fromClaimId: h.claims[0].id, toClaimId: h.claims[1].id } }));
  const a = placeValue(h.gazetteer.byId(h.claims[0].value)), b = placeValue(h.gazetteer.byId(h.claims[1].value));
  assert.equal(result.answer.kind === 'movement' && result.answer.metres, Math.round(geoDistance(a.geometry, b.geometry)!));
  assert.ok(result.text.startsWith(`${a.names[0]} to ${b.names[0]}:`)); assert.ok(result.text.includes(' metres.'));
  assert.equal(result.answer.claimIds.length, 2); assert.equal(result.answer.citations.length, 2);
  for (const span of result.answer.citations) {
    assert.equal(validateSourceSpan(span, result.sources.find(source => source.id === span.sourceId)!, h.query.scope).status, 'success');
    assert.ok(result.text.includes(`[${span.sourceId}:${span.start}-${span.end}]`));
  }
  assert.equal(checkPlace('placeAnswer', result.answer).status, 'success');
  assert.equal(placeValue(renderPlaceAnswer(result.answer, h.gazetteer)), result.text);
  const location = placeValue(await answerPlace(stores, { ...h.query, operation: { kind: 'location-at-event', eventClaimId: h.claims[0].id } }));
  assert.equal(location.answer.citations.length, 1); assert.equal(location.answer.claimIds.length, 1);
});

test('nearby answers concern sourced geometry without invented persona citations', async () => {
  const h = await placeHistory([]), stores = { temporal: h.store, gazetteer: h.gazetteer };
  const result = placeValue(await answerPlace(stores, { ...h.query, operation: { kind: 'nearby', entryId: 'shibuya-scramble-crossing-q21083961', radiusMetres: 400, precision: 6 } }));
  assert.deepEqual(result.answer, { kind: 'nearby', entryIds: ['shibuya-q595153'], claimIds: [], sourceIds: [], citations: [] });
  assert.equal(result.answer.kind, 'nearby');
  assert.equal(result.text, `Nearby: ${placeValue(h.gazetteer.byId('shibuya-q595153')).names[0]}.`);
  const unknown = renderPlaceAnswer({ ...result.answer, entryIds: ['foreign'] }, h.gazetteer);
  assert.equal(unknown.status === 'refused' && unknown.code, 'TPLC1004');
});

test('identical source spans deduplicate even when their JSON property order differs', async () => {
  const h = await placeHistory([{ time: exactPlaceTime(0) }]), span = h.claims[0].citations[0];
  const event = placeValue(await createTemporalClaim({ scope: h.query.scope, series: { subject: 'alex', key: 'event' }, value: 'report',
    time: exactPlaceTime(0), status: 'accepted', citations: [{ quote: span.quote, end: span.end, start: span.start, sourceHash: span.sourceHash, sourceId: span.sourceId }],
    derivation: { method: 'host-asserted', identity: 'place-test' } }, h.sources));
  const bundle = placeValue(await rebuildTemporalFixture(h.bundle, { claims: [...h.claims, event] }));
  const receipt = placeValue(await h.store.apply(bundle, { key: 'event', expectedHead: h.receipt.head }));
  const answer = placeValue(await answerPlace({ temporal: h.store, gazetteer: h.gazetteer }, { ...h.query,
    expectedHead: receipt.head, operation: { kind: 'location-at-event', eventClaimId: event.id } }));
  assert.equal(answer.answer.claimIds.length, 2); assert.equal(answer.answer.citations.length, 1);
});
