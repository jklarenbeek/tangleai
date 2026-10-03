import { it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { validatePlaceShape, placeReasons, type PlaceSchemaName } from '@tangleai/core/schemas/place';
import fixture from '../../benchmark/fixtures/place/gazetteer.json' with { type: 'json' };

const hash = 'a'.repeat(64), entry = fixture.entries[0];
const revision = 'fa3379ba52dcf7c579942dc4e5693ef01ae1f52edbbd124e90488a32028c3f79';
const citation = { sourceId: hash, sourceHash: hash, start: 0, end: 4, quote: 'Bali' };
const coverage = { occurrences: 1, comparable: 1, semanticCandidates: 1, positions: 1,
  unplaceable: 0, poolTruncated: false, complete: true };
const query = { scope: 'one', subject: 'person', operation: { kind: 'location-at', at: '2023-01-01T00:00:00Z' },
  knowledge: { mode: 'provided-history' }, embeddedBy: { model: 'hash-trigram-512', dims: 512 },
  embedding: [1], candidatePool: 100, k: 10, minScore: 0, expectedHead: { scope: 'one', versionId: hash, revision: 1 } };

it('validates every committed source entry and freezes its canonical entry revision', async () => {
  for (const value of fixture.entries) assert.equal(validatePlaceShape('gazetteerEntry', value).valid, true, value.id);
  assert.equal(await canonicalSha256([...fixture.entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), revision);
  assert.equal(validatePlaceShape('gazetteer', { id: 'sourced-place-fixture', revision, entries: fixture.entries }).valid, true);
  for (const position of [[4.9, 52.3, 10], [181, 52.3], [4.9, 91], [4.9], ['4.9', 52.3]]) {
    assert.equal(validatePlaceShape('position', position).valid, false);
  }
  assert.equal(validatePlaceShape('placeGeometry', { type: 'Point', coordinates: [4.9, 52.3], crs: {} }).valid, false);
});

it('closes each place object and every nested object in representative public values', () => {
  const examples: Partial<Record<PlaceSchemaName, object>> = {
    placeGeometry: entry.geometry, placeSource: entry.source, gazetteerEntry: entry,
    gazetteer: { id: 'sourced-place-fixture', revision, entries: [entry] },
    placeMention: { ...citation, entryId: entry.id, status: 'grounded', candidates: [entry.id] },
    placeIntent: { proximity: false, spatial: true }, placeCoverage: coverage,
    placeRefusal: { status: 'refused', code: 'TPLC1001', reason: 'invalid-shape', detail: 'invalid content', coverage },
    positionSample: { claimId: hash, entryId: entry.id, at: '2023-01-01T00:00:00Z', until: null, kind: 'event' },
    placeQuery: query,
    placeAnswer: { kind: 'location-at', entryId: entry.id, claimIds: [hash], sourceIds: [hash], citations: [citation] },
  };
  function paths(value: unknown, path: Array<string | number> = []): Array<Array<string | number>> {
    if (value === null || typeof value !== 'object') return [];
    return [...(Array.isArray(value) ? [] : [path]), ...Object.entries(value).flatMap(([key, child]) => paths(child, [...path, key]))];
  }
  for (const [name, value] of Object.entries(examples)) {
    assert.equal(validatePlaceShape(name as PlaceSchemaName, value).valid, true, name);
    for (const path of paths(value)) {
      const changed = structuredClone(value) as Record<string, unknown>;
      let target = changed;
      for (const part of path) target = target[part] as Record<string, unknown>;
      target.unregistered = true;
      assert.equal(validatePlaceShape(name as PlaceSchemaName, changed).valid, false, `${name}/${path.join('/')}`);
    }
  }
});

it('binds refusal codes to reasons and mention statuses to their candidate inventory', () => {
  for (const [code, reason] of Object.entries(placeReasons)) {
    assert.equal(validatePlaceShape('placeRefusal', { status: 'refused', code, reason, detail: 'counted refusal' }).valid, true);
  }
  assert.equal(validatePlaceShape('placeRefusal', { status: 'refused', code: 'TPLC1002', reason: 'invalid-shape', detail: 'wrong pairing' }).valid, false);
  for (const wrong of [
    { ...citation, entryId: 'foreign', status: 'grounded', candidates: [entry.id] },
    { ...citation, entryId: null, status: 'ambiguous', candidates: [entry.id] },
    { ...citation, entryId: entry.id, status: 'ungrounded', candidates: [] },
    { ...citation, start: 4, end: 4, entryId: entry.id, status: 'grounded', candidates: [entry.id] },
  ]) assert.equal(validatePlaceShape('placeMention', wrong).valid, false);
});

it('requires operation-specific answers, a subject and bounded nearby precision', () => {
  assert.equal(validatePlaceShape('placeQuery', { ...query, subject: null }).valid, false);
  for (const precision of [0, 13, 1.5]) assert.equal(validatePlaceShape('placeQuery', { ...query,
    operation: { kind: 'nearby', entryId: entry.id, radiusMetres: 100, precision } }).valid, false);
  const evidence = { claimIds: [hash], sourceIds: [hash], citations: [citation] };
  assert.equal(validatePlaceShape('placeAnswer', { kind: 'location-at', ...evidence }).valid, false);
  assert.equal(validatePlaceShape('placeAnswer', { kind: 'movement', fromEntryId: entry.id, metres: 1, ...evidence }).valid, false);
  assert.equal(validatePlaceShape('placeAnswer', { kind: 'nearby', entryIds: [], claimIds: [], sourceIds: [], citations: [] }).valid, true);
});
