import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearbyEntries, placeCell, checkAuthoredQuery } from '@tangleai/memory/place';
import { placeGazetteer, placeValue } from './place-fixture.ts';
import entries from '../../benchmark/fixtures/place/gazetteer.json' with { type: 'json' };
import prefix from '../../benchmark/fixtures/place/refusals/prefix-as-proximity.json' with { type: 'json' };

test('nine-cell refinement finds the frozen boundary neighbour that a single prefix misses', async () => {
  const gazetteer = await placeGazetteer(), centre = placeValue(gazetteer.byId('shibuya-scramble-crossing-q21083961'));
  const neighbour = placeValue(gazetteer.byId('shibuya-q595153'));
  const actual = placeValue(await nearbyEntries(gazetteer, centre, { radiusMetres: 400, precision: 6 }));
  assert.deepEqual(actual.entryIds, [neighbour.id]); assert.equal(actual.probedCells, 9);
  assert.ok(actual.candidates >= actual.entryIds.length); assert.equal(actual.narrowed, actual.candidates - actual.entryIds.length);
  assert.equal(placeValue(placeCell(neighbour, 6)).startsWith(placeValue(placeCell(centre, 6))), false);
  const gate = checkAuthoredQuery(prefix, { question: 'Which place is next to Shibuya?', intent: { proximity: true, spatial: true } });
  assert.equal(gate.status === 'refused' && gate.code, 'TPLC1007'); assert.equal(gate.status === 'refused' && gate.cause, 'AI0230');
  assert.deepEqual(placeValue(await nearbyEntries(gazetteer, centre, { radiusMetres: 0, precision: 6 })).entryIds, []);
});

test('oversized, antimeridian and polar circles refuse before a partial cell read', async () => {
  const gazetteer = await placeGazetteer(); let reads = 0;
  const large = await nearbyEntries(gazetteer, gazetteer.entries[0], { radiusMetres: 1e7, precision: 6, entriesInCells: async () => { reads++; return { status: 'success', value: [] }; } });
  assert.equal(large.status === 'refused' && large.code, 'TPLC1011'); assert.equal(reads, 0);
  if (large.status === 'refused') assert.match(large.detail, /footprint.*centre=/);
  for (const [lon, lat] of [[179.999, 0], [0, 89.9999]]) {
    const probe = structuredClone(entries.entries[0]); probe.geometry.coordinates = [lon, lat]; probe.sourceLatLon = { lon, lat }; probe.names = ['Synthetic coverage boundary'];
    const edge = await placeGazetteer([probe]);
    const result = await nearbyEntries(edge, edge.entries[0], { radiusMetres: 400, precision: 6 });
    assert.equal(result.status === 'refused' && result.code, 'TPLC1011');
  }
});

test('cell readers cannot silently omit or invent sourced candidates, and invalid limits remain refusals', async () => {
  const gazetteer = await placeGazetteer(), entry = placeValue(gazetteer.byId('shibuya-scramble-crossing-q21083961'));
  const missing = await nearbyEntries(gazetteer, entry, { radiusMetres: 400, precision: 6, entriesInCells: async () => ({ status: 'success', value: [] }) });
  assert.equal(missing.status === 'refused' && missing.code, 'TPLC1011');
  const thrown = await nearbyEntries(gazetteer, entry, { radiusMetres: 400, precision: 6, entriesInCells: async () => { throw Error('cell read failed'); } });
  assert.equal(thrown.status === 'refused' && thrown.code, 'TPLC1010');
  for (const options of [{ radiusMetres: -1, precision: 6 }, { radiusMetres: Infinity, precision: 6 }, { radiusMetres: 0, precision: 13 }]) {
    const result = await nearbyEntries(gazetteer, entry, options); assert.equal(result.status === 'refused' && result.code, 'TPLC1001');
  }
});
