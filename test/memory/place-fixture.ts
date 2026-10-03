import { canonicalSha256 } from '@jarenjs/json/canonical';
import { compareCodePoints } from '@jarenjs/core/string';
import { checkPlace, createGazetteer, type Gazetteer, type PlaceResult } from '@tangleai/memory/place';
import { createSourceOccurrence, temporalStamp, type TemporalResult } from '@tangleai/memory/temporal';
import fixture from '../../benchmark/fixtures/place/gazetteer.json' with { type: 'json' };

export function placeValue<T>(result: PlaceResult<T> | TemporalResult<T>): T {
  if (result.status !== 'success') throw Error(`${result.reason}: ${result.detail}`);
  return result.value;
}
export async function placeDocument(entries = fixture.entries, id = 'sourced-place-fixture') {
  const copied = structuredClone(entries).sort((a, b) => compareCodePoints(a.id, b.id));
  return placeValue(checkPlace<Gazetteer>('gazetteer', { id, revision: await canonicalSha256(copied), entries: copied }));
}
export async function placeGazetteer(entries = fixture.entries) {
  return placeValue(await createGazetteer(await placeDocument(entries)));
}
export async function placeSource(text: string, scope = 'place-test', turnOrdinal = 0) {
  const at = '2026-09-01T12:00:00Z';
  return placeValue(await createSourceOccurrence({ scope, sessionOrdinal: 0, turnOrdinal, role: 'host', text,
    observedAt: placeValue(temporalStamp(at, { precision: 'minute' })), knownAt: at, sourceLocator: `host:${turnOrdinal}` }));
}
