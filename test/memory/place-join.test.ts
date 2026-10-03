import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationAtInstant, locationAtEvent, movementDistance, positionSeries, type PositionSeries } from '@tangleai/memory/place';
import { loadPlaceFixture } from '../../benchmark/lib/place-fixture.ts';
import { preparePlaceBaselines } from '../../benchmark/lib/place-baselines.ts';
import { placeGazetteer, placeValue } from './place-fixture.ts';
import { placeHistory, exactPlaceTime } from './place-history.ts';

test('native joins reproduce every frozen location, movement and unmatched event expectation', async t => {
  const loaded = await loadPlaceFixture();
  if (loaded.corpus.status !== 'available') { t.skip(loaded.corpus.detail); return; }
  const prepared = await preparePlaceBaselines(loaded), gazetteer = await placeGazetteer(), cache = new Map<string, PositionSeries>();
  const counts = { location: 0, movement: 0, unmatched: 0 };
  for (const question of loaded.fixture.questions) {
    if (question.kind !== 'location-at-event' && question.kind !== 'movement-distance' && question.kind !== 'no-position') continue;
    const projection = prepared.projections.get(question.sampleId)!;
    if (!cache.has(question.subject)) cache.set(question.subject, placeValue(await positionSeries(prepared.stores.get(question.sampleId)!, {
      scope: question.sampleId, subject: question.subject, versionId: projection.bundle.projection.versionId, gazetteer })));
    const series = cache.get(question.subject)!;
    if (question.kind === 'movement-distance') {
      const value = placeValue(movementDistance(series, projection.eventsByDiaId.get(question.fromDiaId)!, projection.eventsByDiaId.get(question.toDiaId)!));
      assert.deepEqual({ fromEntryId: value.from.entry.id, toEntryId: value.to.entry.id, metres: value.metres }, question.expected, question.id); counts.movement++;
    } else {
      const result = locationAtEvent(series, projection.eventsByDiaId.get(question.eventDiaId)!);
      assert.deepEqual(result.status === 'success' ? { entryId: result.value.entry.id } : { refused: result.code }, question.expected, question.id);
      if (question.kind === 'no-position') counts.unmatched++; else counts.location++;
    }
  }
  assert.deepEqual(counts, { location: 56, movement: 29, unmatched: 13 });
});

test('ended states and old points cannot establish a later position; unknown ends preserve their temporal cause', async () => {
  for (const until of [{ kind: 'at' as const, at: new Date(10).toISOString() }, { kind: 'unknown' as const }]) {
    const h = await placeHistory([{ time: { kind: 'state', from: new Date(0).toISOString(), until, precision: 'millisecond' } }]);
    const series = placeValue(await positionSeries(h.store, h.seriesOptions));
    const result = locationAtInstant(series, 10);
    assert.equal(result.status === 'refused' && result.code, until.kind === 'at' ? 'TPLC1008' : 'TPLC1009');
    if (result.status === 'refused') { if (until.kind === 'at') assert.match(result.detail, /ended/); else assert.equal(result.cause, 'unknown-validity'); }
  }
  const h = await placeHistory([{ time: exactPlaceTime(0) }]), series = placeValue(await positionSeries(h.store, h.seriesOptions));
  assert.equal(locationAtInstant(series, 1).status, 'refused');
  for (const at of [NaN, Infinity, 0.5]) assert.equal(locationAtInstant(series, at).status, 'refused');
});

test('coarse, state and foreign event operands cannot become exact instants', async () => {
  const h = await placeHistory([{ time: exactPlaceTime(0) }, { time: { kind: 'point', at: new Date(0).toISOString(), precision: 'minute' }, series: 'event' },
    { time: { kind: 'state', from: new Date(0).toISOString(), until: { kind: 'open' }, precision: 'minute' }, series: 'event' },
    { time: exactPlaceTime(0), subject: 'blair', series: 'event' }]);
  const series = placeValue(await positionSeries(h.store, h.seriesOptions));
  for (const event of h.claims.slice(1)) {
    const result = locationAtEvent(series, event);
    assert.equal(result.status === 'refused' && result.cause, event.series.subject === 'blair' ? 'identity-mismatch' : 'unknown-validity');
  }
});

test('equal instants use the last numeric table row and later exact points can follow unknown-ended states', async () => {
  const h = await placeHistory([{ time: { kind: 'state', from: new Date(0).toISOString(), until: { kind: 'unknown' }, precision: 'millisecond' } },
    { time: exactPlaceTime(10) }, { time: exactPlaceTime(10) }]);
  const series = placeValue(await positionSeries(h.store, h.seriesOptions));
  const expected = series.samples.filter(sample => sample.at === 10).at(-1)!;
  assert.equal(placeValue(locationAtInstant(series, 10)).claim.id, series.table[expected.value].claim.id);
  const unknown = await placeHistory([{ time: { kind: 'unknown' }, status: 'unknown' }, { time: exactPlaceTime(10) }]);
  const refused = locationAtInstant(placeValue(await positionSeries(unknown.store, unknown.seriesOptions)), 10);
  assert.equal(refused.status === 'refused' && refused.cause, 'unknown-validity');
});

test('movement never invents a missing endpoint and names the side that refused', async () => {
  const h = await placeHistory([{ time: exactPlaceTime(0) }, { time: exactPlaceTime(0), series: 'event' }, { time: exactPlaceTime(10), series: 'event' }]);
  const series = placeValue(await positionSeries(h.store, h.seriesOptions));
  for (const [from, to, side] of [[h.claims[1], h.claims[2], 'to'], [h.claims[2], h.claims[1], 'from']] as const) {
    const result = movementDistance(series, from, to);
    assert.equal(result.status === 'refused' && result.code, 'TPLC1008');
    if (result.status === 'refused') assert.ok(result.detail.startsWith(`${side}:`));
  }
});
