/** The parent owns temporary files until the tested SQLite runtime has closed. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
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
let instance = 0;
async function createSqliteProbe(): Promise<ExperientialProbeHost> {
  const path = join(directory!, 'experiential-' + instance++ + '.sqlite');
  let db = await openTangleDb({ path }), host: ExperientialProbeHost;
  const applyProbe = (step: string) => { if (host?.failAt === step && --host.failOccurrence === 0) throw new Error('Injected transaction failure.'); };
  const options = { now: () => EXPERIENTIAL_FIXTURE_TIME };
  let persistence = createExperientialDbPersistence(db, { applyProbe });
  host = {
    persistence, store: createExperientialStoreAdapter(persistence, options), peer: createExperientialStoreAdapter(persistence, options),
    failAt: null, failOccurrence: 1,
    async state() {
      // Read the native rows directly so fault injection applies only to the
      // operation being measured, never to the observation of its rollback.
      const state: Partial<ExperientialMemoryState> = {};
      for (const table of EXPERIENTIAL_TABLES) {
        const rows: ExperientialTables[ExperientialTable][] = [];
        for await (const row of db.collection('experiential_' + table).query<ExperientialTables[ExperientialTable]>({
          $for: { r: '$[*]' }, $orderby: '$r.id', $return: '$r.payload',
        })) rows.push(row);
        Object.assign(state, { [table]: rows });
      }
      return state as ExperientialMemoryState;
    },
    async reopen() {
      assert.equal((await db.integrityCheck()).ok, true); await db.close(); db = await openTangleDb({ path });
      persistence = createExperientialDbPersistence(db, { applyProbe }); host.persistence = persistence;
      host.store = createExperientialStoreAdapter(persistence, options); host.peer = createExperientialStoreAdapter(persistence, options);
    },
    close: () => db.close(),
  };
  return host;
}

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
