import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openTangleDb, createPlaceDbStore, createTemporalDbStore } from '@tangleai/store';
import { answerPlace } from '@tangleai/memory/place';
import schema from '@tangleai/core/schemas/place.schema.json' with { type: 'json' };
import { placeSchema } from '@tangleai/core/schemas/place';
import { qualifyPlace } from './place-browser.mjs';

const value = result => { if (result.status !== 'success') throw Error(`${result.reason}: ${result.detail}`); return result.value; };
assert.deepEqual(schema, placeSchema);
assert.match(import.meta.resolve('@tangleai/memory/place'), /\.js$/);
const guide = await readFile(new URL('./docs/PLACE.md', import.meta.resolve('@tangleai/memory/package.json')), 'utf8');
assert.match(guide, /createPlaceClaim/);
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Installed place consumer forbids network'); };
const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
assert.ok(directory, 'installed place fixture requires parent-owned scratch');
let db;
try {
  const { gazetteer, entry, cells, bundle, query, answer, summary } = await qualifyPlace();
  const path = join(directory, 'place.db');
  db = await openTangleDb({ path });
  assert.deepEqual(value(await createPlaceDbStore(db).loadGazetteer(gazetteer)), { writes: 72, replayed: false });
  const temporal = createTemporalDbStore(db);
  value(await temporal.apply(bundle, { key: 'installed-place', expectedHead: null }));
  assert.deepEqual(value(await answerPlace({ temporal, gazetteer }, query)), answer);
  await db.close(); db = await openTangleDb({ path });
  const store = createPlaceDbStore(db);
  assert.deepEqual(value(await store.entries(gazetteer.id)), gazetteer.entries);
  assert.deepEqual(value(await store.loadGazetteer(gazetteer)), { writes: 0, replayed: true });
  assert.equal(store.stats().writes, 0);
  assert.ok(value(await store.entriesInCells(gazetteer.id, cells)).some(e => e.id === entry.id));
  const reopened = createTemporalDbStore(db);
  assert.deepEqual(value(await answerPlace({ temporal: reopened, gazetteer }, query)), answer);
  assert.equal(value(await reopened.apply(bundle, { key: 'installed-place', expectedHead: null })).writes, 0);
  assert.equal(reopened.stats().writes, 0);
  const nearby = value(await answerPlace({ temporal: reopened, gazetteer, entriesInCells: cells => store.entriesInCells(gazetteer.id, cells) },
    { ...query, operation: { kind: 'nearby', entryId: 'shibuya-scramble-crossing-q21083961', radiusMetres: 400, precision: 6 } }));
  assert.deepEqual(nearby.answer.entryIds, ['shibuya-q595153']);
  console.log(JSON.stringify({ placeInstalled: true, ...summary, reopenEqual: true, replayWrites: 0, projectionReplayWrites: 0, providerRequests: 0 }));
} finally { await db?.close(); globalThis.fetch = oldFetch; }
