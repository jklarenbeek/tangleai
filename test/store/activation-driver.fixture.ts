/** Shared conformance is executed in the selected native SQLite runtime. */
import assert from 'node:assert/strict';
import { experientialSqliteProbeFactory } from './experiential-host.ts';
import { createExperientialMemoryProbe } from '../experiential/memory-host.ts';
import { runExperientialActivationProbes } from '../experiential/activation-probes.ts';
const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw new TypeError('A parent-owned fixture directory is required.');
const memory = await runExperientialActivationProbes(createExperientialMemoryProbe);
const sqlite = await runExperientialActivationProbes(experientialSqliteProbeFactory(directory));
assert.deepEqual(sqlite, memory);
console.log(JSON.stringify({ runtime: process.versions.bun ? 'bun' : 'node', report: sqlite }));
