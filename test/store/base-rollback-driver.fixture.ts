import assert from 'node:assert/strict';
import { createExperientialMemoryProbe } from '../experiential/memory-host.ts';
import { runExperientialBaseRollbackProbes } from '../experiential/base-rollback-probes.ts';
import { experientialSqliteProbeFactory } from './experiential-host.ts';

const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw new TypeError('A parent-owned fixture directory is required.');
const memory = await runExperientialBaseRollbackProbes(createExperientialMemoryProbe);
const sqlite = await runExperientialBaseRollbackProbes(experientialSqliteProbeFactory(directory));
assert.deepEqual(sqlite, memory);
console.log(JSON.stringify({ runtime: process.versions.bun ? 'bun' : 'node', report: sqlite }));
