import { it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidGeoJson, geohashEncode } from '@jarenjs/core/geo';
import { checkPlace, checkPlaceGeometry, placeCell, placeNeighbourhood, type GazetteerEntry } from '@tangleai/memory/place';
import fixture from '../../benchmark/fixtures/place/gazetteer.json' with { type: 'json' };

it('qualifies all sourced fixture points and their nine distinct native cells', () => {
  for (const raw of fixture.entries) {
    const entry = checkPlace<GazetteerEntry>('gazetteerEntry', raw);
    if (entry.status !== 'success') throw Error(entry.detail);
    const geometry = checkPlaceGeometry(entry.value.geometry, entry.value.sourceLatLon);
    assert.equal(geometry.status, 'success', raw.id);
    assert.deepEqual(geometry.status === 'success' && geometry.value, raw.geometry);
    const cell = placeCell(entry.value, 6); assert.equal(cell.status, 'success');
    assert.equal(cell.status === 'success' && cell.value, geohashEncode(raw.sourceLatLon.lon, raw.sourceLatLon.lat, 6));
    const cells = placeNeighbourhood(entry.value, 6); assert.equal(cells.status, 'success');
    assert.equal(cells.status === 'success' && new Set(cells.value).size, 9, raw.id);
  }
});

it('distinguishes CRS, dimension, range and source-pair refusals from native GeoJSON validity', () => {
  const crs = { type: 'Point', coordinates: [4.9, 52.3], crs: {} };
  const altitude = { type: 'Point', coordinates: [4.9, 52.3, 10] };
  assert.equal(isValidGeoJson(crs), true); assert.equal(isValidGeoJson(altitude), true);
  const cases: Array<[unknown, RegExp]> = [
    [crs, /crs/], [altitude, /two components/],
    [{ type: 'Point', coordinates: [181, 52.3] }, /longitude/],
    [{ type: 'Point', coordinates: [4.9, 91] }, /latitude/],
    [{ type: 'Point', coordinates: [4.9, 52.3], hidden: { crs: {} } }, /crs/],
    [{ type: 'Point', coordinates: [4.9, 52.3], bbox: [4, 52, 5, 53] }, /invalid placeGeometry/],
  ];
  for (const [value, detail] of cases) {
    const result = checkPlaceGeometry(value); assert.equal(result.status, 'refused');
    if (result.status !== 'refused') throw Error('Expected geometry refusal');
    assert.equal(result.code, 'TPLC1002'); assert.match(result.detail, detail);
  }
  const swapped = checkPlaceGeometry({ type: 'Point', coordinates: [52.37, 4.9] }, { lat: 52.37, lon: 4.9 });
  assert.equal(swapped.status, 'refused');
  if (swapped.status !== 'refused') throw Error('Expected swapped-pair refusal');
  assert.equal(swapped.code, 'TPLC1002'); assert.match(swapped.detail, /swapped/);
  const outside = checkPlaceGeometry({ type: 'Point', coordinates: [181, 0] });
  assert.equal(outside.status === 'refused' && outside.cause, 'isValidGeoJson=false');
});

it('refuses malformed geometry and invalid precision as values before native encoding', () => {
  for (const value of [null, [], {}, { type: 'Point', coordinates: [NaN, 0] }]) {
    assert.equal(checkPlaceGeometry(value).status, 'refused');
  }
  const entry = checkPlace<GazetteerEntry>('gazetteerEntry', fixture.entries[0]);
  if (entry.status !== 'success') throw Error(entry.detail);
  for (const precision of [Infinity, NaN, -1, 0, 1.5, 13]) {
    const result = placeCell(entry.value, precision);
    assert.equal(result.status === 'refused' && result.code, 'TPLC1001');
  }
});
