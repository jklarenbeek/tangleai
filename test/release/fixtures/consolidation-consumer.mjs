import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openTangleDb, createConsolidationDbStore } from '@tangleai/store';
import { qualifyConsolidation } from './consolidation-browser.mjs';
globalThis.fetch = async () => { throw Error('Installed consolidation consumer forbids network'); };
const guide = await readFile(new URL('./docs/CONSOLIDATION.md', import.meta.resolve('@tangleai/memory/package.json')), 'utf8');
assert.match(guide, /^# Immutable consolidation/m);
assert.match(guide, /createConsolidationRunner/);
assert.match(guide, /createConsolidationOperations/);
assert.match(import.meta.resolve('@tangleai/memory/consolidation'), /\.js$/);
await import('./consolidation-example.mjs');
const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw new Error('installed consolidation consumer requires parent-owned scratch');
const memory = await qualifyConsolidation();
assert.equal(memory.sources, 2);
const path = join(directory, 'consolidation.db');
let db = await openTangleDb({ path });
try {
  await qualifyConsolidation(createConsolidationDbStore(db));
  await db.close(); db = await openTangleDb({ path });
  const reopened = await qualifyConsolidation(createConsolidationDbStore(db));
  assert.equal(reopened.reopened, true); assert.equal(reopened.replayWrites, 0);
  assert.equal((await db.integrityCheck()).ok, true);
} finally { await db.close(); }
console.log('Installed consolidation: immutable sources, atomic activation and reopen replay passed');
