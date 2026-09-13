/** SQLite lifetime belongs to the Node parent, including under Bun on Windows. */
import { runConsolidationExecutionProbes } from '../lib/consolidate-execution-probes.ts';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { openStore } from '@jarenjs/db';
import { createMemoryUnit } from '@tangleai/memory';
import { openTangleDb, createConsolidationDbStore, createDbMemoryStore, TANGLE_DB_MODEL, pickDriver } from '@tangleai/store';
import { runConsolidationStoreProbes, consolidationProbeSource, consolidationMust, type ConsolidationProbeHost } from '../lib/consolidate-store-probes.ts';
const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw new Error('consolidation fixture needs parent-owned scratch');
const legacyPath = join(directory, 'pre-consolidation.db');
const collections = Object.fromEntries(Object.entries(TANGLE_DB_MODEL.collections).filter(([name]) => !name.startsWith('consolidation_')));
const old = await openStore({ ...TANGLE_DB_MODEL, collections }, { path: legacyPath, driver: pickDriver() });
const legacy = createMemoryUnit({ text: 'Preserve ordinary memory', evidence: 'host', at: '2024-01-01T00:00:00Z' });
try { await createDbMemoryStore(old.collection('memories')).put(legacy); } finally { await old.close(); }
const upgraded = await openTangleDb({ path: legacyPath });
try {
  assert.deepEqual(await createDbMemoryStore(upgraded.collection('memories')).get(legacy.id), legacy);
  const source = await consolidationProbeSource('additive-upgrade');
  consolidationMust(await createConsolidationDbStore(upgraded).enqueue([source], { maxPending: 1 }));
  assert.equal((await upgraded.integrityCheck()).ok, true);
} finally { await upgraded.close(); }
const fixtureDirectory: string = directory;
let sequence = 0;
async function createHost(): Promise<ConsolidationProbeHost> {
  const path = join(fixtureDirectory, `consolidation-${sequence++}.db`);
  let host: ConsolidationProbeHost;
  const applyProbe = (step: string) => { if (host?.failAt === step) throw new Error(`injected ${step}`); };
  let db = await openTangleDb({ path });
  host = { store: createConsolidationDbStore(db, { applyProbe }), peer: createConsolidationDbStore(db, { applyProbe }), failAt: null,
    async reopen() { await db.close(); db = await openTangleDb({ path }); host.store = createConsolidationDbStore(db, { applyProbe }); host.peer = createConsolidationDbStore(db, { applyProbe }); },
    async close() { await db.close(); },
  };
  return host;
}
const report = await runConsolidationStoreProbes(createHost);
const execution = await runConsolidationExecutionProbes(createHost);
console.log(JSON.stringify({ backend: process.versions.bun ? 'bun-sqlite' : 'node-sqlite', legacyMemoriesPreserved: 1, ...report, execution }));
