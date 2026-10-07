/** The parent owns temporary files until the tested SQLite runtime has closed. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { experientialSqliteProbeFactory } from './experiential-host.ts';
import { openStore } from '@jarenjs/db';
import { createMemoryUnit } from '@tangleai/memory';
import { createExperientialStoreAdapter, EXPERIENTIAL_TABLES,
  type ExperientialMemoryState, type ExperientialTable, type ExperientialTables } from '@tangleai/experiential';
import { openTangleDb, createExperientialDbPersistence, createDbMemoryStore, pickDriver, TANGLE_DB_MODEL } from '@tangleai/store';
import { EXPERIENTIAL_FIXTURE_TIME, type ExperientialProbeHost } from '../experiential/store-fixtures.ts';
import { runExperientialStoreProbes } from '../experiential/store-probes.ts';
import { createExperientialMemoryProbe } from '../experiential/memory-host.ts';

const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw new TypeError('A parent-owned fixture directory is required.');
assert.deepEqual(Object.keys(TANGLE_DB_MODEL.collections).filter(name => name.startsWith('experiential_')).sort(),
  EXPERIENTIAL_TABLES.map(table => 'experiential_' + table).sort());
const createSqliteProbe = experientialSqliteProbeFactory(directory);

const memory = await runExperientialStoreProbes(createExperientialMemoryProbe);
const sqlite = await runExperientialStoreProbes(createSqliteProbe);
assert.deepEqual(sqlite, memory, 'Every retained byte, refusal, replay and lineage result must agree with memory.');

const path = join(directory, 'pre-experiential.sqlite');
const collections = Object.fromEntries(Object.entries(TANGLE_DB_MODEL.collections).filter(([name]) => !name.startsWith('experiential_')));
const old = await openStore({ ...TANGLE_DB_MODEL, collections }, { path, driver: pickDriver() });
const unit = createMemoryUnit({ text: 'Preserve prior evidence-backed memory.', evidence: 'Authored SQLite upgrade fixture.', at: EXPERIENTIAL_FIXTURE_TIME });
try { await createDbMemoryStore(old.collection('memories')).put(unit); } finally { await old.close(); }
const current = await openTangleDb({ path });
try {
  assert.deepEqual(await createDbMemoryStore(current.collection('memories')).get(unit.id), unit);
  for (const table of EXPERIENTIAL_TABLES) {
    const rows = [];
    for await (const row of current.collection('experiential_' + table).query({ $for: { r: '$[*]' }, $return: '$r' })) rows.push(row);
    assert.deepEqual(rows, []);
  }
  assert.equal((await current.integrityCheck()).ok, true);
} finally { await current.close(); }
process.stdout.write(JSON.stringify({ runtime: process.versions.bun ? 'bun' : 'node', legacyMemoriesPreserved: 1, report: sqlite }) + '\n');
