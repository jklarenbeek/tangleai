/** The verification parent owns SQLite scratch until this runtime closes every handle. */
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { openStore } from '@jarenjs/db';
import { createMemoryUnit } from '@tangleai/memory';
import { openTangleDb,createForecastStore,createDbMemoryStore,TANGLE_DB_MODEL,pickDriver } from '@tangleai/store';
import { runForecastStoreProbes,type ForecastProbeHost } from '../lib/forecast-store-probes.ts';

const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw Error('The forecast fixture requires parent-owned scratch.');
let physicalRequests = 0;
globalThis.fetch = async () => { physicalRequests++; throw Error('The forecast storage fixture cannot call a provider.'); };
const path = join(directory,'pre-forecast.db');
const collections = Object.fromEntries(Object.entries(TANGLE_DB_MODEL.collections).filter(([name]) => !name.startsWith('forecast_')));
const old = await openStore({ ...TANGLE_DB_MODEL,collections },{ path,driver: pickDriver() });
const memory = createMemoryUnit({ text: 'Preserve a pre-forecast memory',evidence: 'fixture host',at: '2024-01-01T00:00:00Z' });
try { await createDbMemoryStore(old.collection('memories')).put(memory); } finally { await old.close(); }
const upgraded = await openTangleDb({ path });
try { assert.deepEqual(await createDbMemoryStore(upgraded.collection('memories')).get(memory.id),memory); assert.equal((await upgraded.integrityCheck()).ok,true); } finally { await upgraded.close(); }
const fixtureDirectory: string = directory; let sequence = 0;
const report = await runForecastStoreProbes(async () => {
  const path = join(fixtureDirectory,'forecast-' + sequence++ + '.db'); let db = await openTangleDb({ path });
  const host: ForecastProbeHost = { store: null!,peer: null!,failAt: null,
    async reopen() { await db.close(); db = await openTangleDb({ path }); host.store = createForecastStore(db,options); host.peer = createForecastStore(db,options); },
    async close() { assert.equal((await db.integrityCheck()).ok,true); await db.close(); } };
  const options = { applyProbe: (step: string) => { if (step === host.failAt) throw Error('Injected forecast persistence fault.'); } };
  host.store = createForecastStore(db,options); host.peer = createForecastStore(db,options); return host;
});
assert.equal(physicalRequests,0);
console.log(JSON.stringify({ ...report,backend: process.versions.bun ? 'bun-sqlite' : 'node-sqlite',physicalRequests,legacyMemoriesPreserved: 1,integrity: true }));
