import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openTangleDb, createPlaceDbStore } from '@tangleai/store';
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
  const { gazetteer, entry, cells, summary } = await qualifyPlace();
  const path = join(directory, 'place.db');
  db = await openTangleDb({ path });
  assert.deepEqual(value(await createPlaceDbStore(db).loadGazetteer(gazetteer)), { writes: 72, replayed: false });
  await db.close(); db = await openTangleDb({ path });
  const store = createPlaceDbStore(db);
  assert.deepEqual(value(await store.entries(gazetteer.id)), gazetteer.entries);
  assert.deepEqual(value(await store.loadGazetteer(gazetteer)), { writes: 0, replayed: true });
  assert.equal(store.stats().writes, 0);
  assert.ok(value(await store.entriesInCells(gazetteer.id, cells)).some(e => e.id === entry.id));
  console.log(JSON.stringify({ placeInstalled: true, ...summary, reopenEqual: true, replayWrites: 0, providerRequests: 0 }));
} finally { await db?.close(); globalThis.fetch = oldFetch; }
