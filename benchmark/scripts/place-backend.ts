/** Actual Node/Bun SQLite execution with an independent process-local network guard. */
import assert from 'node:assert/strict';
import { loadPlaceFixture } from '../lib/place-fixture.ts';
import { runPlaceBackend } from '../lib/place-runtime.ts';
const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
assert.ok(directory, 'place backend requires parent-owned scratch');
assert.ok(process.argv.slice(2).every(arg => arg === '--without-corpus'), 'unknown place backend argument');
const loaded = await loadPlaceFixture(process.argv.includes('--without-corpus') ? { corpusRoot: directory } : {});
console.log(JSON.stringify(await runPlaceBackend(process.versions.bun ? 'bun-sqlite' : 'node-sqlite', loaded)));
