import { it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { createPlaceClaim, placeClaimGeometry, type PlaceClaimInput } from '@tangleai/memory/place';
import { citeSource, validateTemporalClaim, claimContains, temporalInstant } from '@tangleai/memory/temporal';
import { placeGazetteer, placeSource, placeValue } from './place-fixture.ts';

async function input(): Promise<PlaceClaimInput> {
  const gazetteer = await placeGazetteer(), entry = gazetteer.entries[0];
  const source = await placeSource(`I visited ${entry.names[0]}.`);
  return { scope: source.scope, subject: 'traveller', entry, kind: 'event', at: source.observedAt.at, until: null,
    source, span: placeValue(citeSource(source, 10, 10 + entry.names[0].length)),
    derivation: { method: 'host-asserted', identity: 'cited-visit-v1' } };
}

it('creates deterministic location claims using the temporal identity and citation owner and resolves their geometry', async () => {
  const value = await input(), claim = placeValue(await createPlaceClaim(value));
  assert.deepEqual(claim.series, { subject: value.subject, key: 'location' });
  assert.equal(claim.value, value.entry.id);
  assert.deepEqual(claim.time, { kind: 'point', at: value.at, precision: 'minute' });
  assert.deepEqual(claim.citations, [value.span]);
  assert.equal((await validateTemporalClaim(claim, [value.source])).status, 'success');
  assert.equal(canonicalizeJson(await createPlaceClaim(value)), canonicalizeJson({ status: 'success', value: claim }));
  const gazetteer = await placeGazetteer();
  assert.deepEqual(placeValue(placeClaimGeometry(claim, gazetteer)), value.entry.geometry);
  const foreign = placeClaimGeometry({ ...claim, value: 'not-in-gazetteer' }, gazetteer);
  assert.equal(foreign.status === 'refused' && foreign.code, 'TPLC1004');
  const other = placeClaimGeometry({ ...claim, series: { subject: value.subject, key: 'job' } }, gazetteer);
  assert.equal(other.status === 'refused' && other.code, 'TPLC1001');
});

it('preserves unknown residence ends, half-open known ends and explicit exact host indices', async () => {
  const value = await input(), at = placeValue(temporalInstant(value.at));
  const coarse = placeValue(await createPlaceClaim(value));
  assert.equal(claimContains(coarse.time, at).status, 'refused', 'minute evidence cannot assert an exact instant');
  const exact = placeValue(await createPlaceClaim({ ...value, precision: 'millisecond' }));
  assert.equal(placeValue(claimContains(exact.time, at)), true);
  const residence = placeValue(await createPlaceClaim({ ...value, kind: 'state' }));
  assert.deepEqual(residence.time, { kind: 'state', from: value.at, until: { kind: 'unknown' }, precision: 'minute' });
  const uncertain = claimContains(residence.time, at);
  assert.equal(uncertain.status === 'refused' && uncertain.reason, 'unknown-validity');
  const until = '2026-09-01T12:05:00Z';
  const ended = placeValue(await createPlaceClaim({ ...value, kind: 'state', until }));
  assert.equal(placeValue(claimContains(ended.time, at)), true);
  assert.equal(placeValue(claimContains(ended.time, placeValue(temporalInstant(until)))), false);
});

it('refuses source forgery, foreign or cut citations and invalid temporal bounds through the temporal refusal owner', async () => {
  const value = await input();
  for (const override of [
    { source: { ...value.source, sourceHash: '0'.repeat(64) } },
    { scope: 'other-scope' }, { span: { ...value.span, end: value.span.end + 1 } },
    { at: '2026-02-30T00:00:00Z' }, { at: '2026-09-01T12:00:01Z' },
    { kind: 'state' as const, until: value.at },
  ]) {
    const result = await createPlaceClaim({ ...value, ...override });
    assert.equal(result.status === 'refused' && result.code, 'TPLC1009');
    assert.ok(result.status === 'refused' && result.cause);
  }
  const emojiSource = await placeSource('😀 location');
  const cut = await createPlaceClaim({ ...value, source: emojiSource, span: { sourceId: emojiSource.id,
    sourceHash: emojiSource.sourceHash, start: 0, end: 1, quote: emojiSource.text.slice(0, 1) } });
  assert.equal(cut.status === 'refused' && cut.cause, 'identity-mismatch');
});

it('refuses unsourced or swapped entries and malformed place inputs without silently discarding an event end', async () => {
  const value = await input();
  for (const override of [{ subject: null }, { kind: 'unknown' }, { until: '2026-09-01T12:05:00Z' }, { until: undefined }]) {
    const result = await createPlaceClaim({ ...value, ...override } as unknown as PlaceClaimInput);
    assert.equal(result.status === 'refused' && result.code, 'TPLC1001');
  }
  const absent = structuredClone(value) as unknown as { entry: Record<string, unknown> };
  delete absent.entry.source;
  const missing = await createPlaceClaim(absent as unknown as PlaceClaimInput);
  assert.equal(missing.status === 'refused' && missing.code, 'TPLC1003');
  const swapped = await createPlaceClaim({ ...value, entry: { ...value.entry,
    geometry: { type: 'Point', coordinates: [value.entry.sourceLatLon.lat, value.entry.sourceLatLon.lon] } } });
  assert.equal(swapped.status === 'refused' && swapped.code, 'TPLC1002');
});
