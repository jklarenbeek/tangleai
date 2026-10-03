import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runPlaceExample } from './place-example/place-example.mjs';
import entries from './place-example/place-gazetteer.json' with { type: 'json' };

assert.equal(entries.length, 3, 'the public example must retain its own sourced fixture');
assert.ok(process.env.TANGLE_FIXTURE_DIRECTORY, 'the parent owns disposable SQLite files');
const before = globalThis.fetch; let calls = 0;
globalThis.fetch = async () => { calls++; throw Error('installed place example forbids network requests'); };
try { await runPlaceExample(join(process.env.TANGLE_FIXTURE_DIRECTORY, 'example.db')); assert.equal(calls, 0); }
finally { globalThis.fetch = before; }
