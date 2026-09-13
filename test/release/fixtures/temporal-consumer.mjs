import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTangleDb, createTemporalDbStore } from '@tangleai/store';
import schema from '@tangleai/core/schemas/temporal.schema.json' with { type: 'json' };
import { temporalSchema } from '@tangleai/core/schemas/temporal';
import { qualifyTemporal } from './temporal-browser.mjs';
assert.deepEqual(schema, temporalSchema);
const guide = await readFile(new URL('./docs/TEMPORAL.md', import.meta.resolve('@tangleai/memory/package.json')), 'utf8');
assert.match(guide, /^# Evidenced temporal memory/m);
assert.match(guide, /prepareTemporal/);
assert.match(import.meta.resolve('@tangleai/memory/temporal'), /\.js$/);
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Installed temporal consumer forbids network'); };
const directory = await mkdtemp(join(tmpdir(), 'temporal-installed-')), path = join(directory, 'temporal.db');
let db;
try {
  const memory = await qualifyTemporal();
  db = await openTangleDb({ path });
  const first = await qualifyTemporal(createTemporalDbStore(db));
  assert.deepEqual(first, memory);
  await db.close(); db = await openTangleDb({ path });
  const reopened = await qualifyTemporal(createTemporalDbStore(db));
  assert.deepEqual(reopened.answer, first.answer);
  assert.equal(reopened.replayed, true); assert.equal(reopened.replayWrites, 0);
  await import('./temporal-example.mjs');
  console.log(JSON.stringify({ temporalInstalled: true, occurrences: reopened.occurrences, citations: reopened.citations, reopenEqual: true, replayWrites: 0, providerRequests: 0 }));
} finally { await db?.close(); globalThis.fetch = oldFetch; await rm(directory, { recursive: true, force: true }); }
