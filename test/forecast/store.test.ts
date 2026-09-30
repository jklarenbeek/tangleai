import { describe,it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { openTangleDb,createForecastStore } from '@tangleai/store';
import { createForecastStoreAdapter,createMemoryForecastStore,forecastTransaction } from '@tangleai/forecast';
import { runForecastStoreProbes,createMemoryForecastProbeHost,type ForecastProbeHost } from '../../benchmark/lib/forecast-store-probes.ts';

describe('forecast persistence parity', () => {
  it('runs one adversarial lifecycle census identically on memory and SQLite',async () => {
    const directory = await mkdtemp(join(tmpdir(),'forecast-store-')); let sequence = 0;
    try {
      const reference = await runForecastStoreProbes(createMemoryForecastProbeHost);
      const sqlite = await runForecastStoreProbes(async () => {
        const path = join(directory,String(sequence++)); let db = await openTangleDb({ path });
        const host: ForecastProbeHost = { store: null!,peer: null!,failAt: null,async reopen() { await db.close(); db = await openTangleDb({ path }); host.store = createForecastStore(db,options); host.peer = createForecastStore(db,options); },async close() { assert.equal((await db.integrityCheck()).ok,true); await db.close(); } };
        const options = { applyProbe: (step: string) => { if (step === host.failAt) throw Error('Injected forecast persistence fault.'); } };
        host.store = createForecastStore(db,options); host.peer = createForecastStore(db,options); return host;
      });
      assert.deepEqual(sqlite,reference); assert.equal(reference.passed,17); assert.equal(reference.repeatWrites,0);
    } finally { await rm(directory,{ recursive: true,force: true }); }
  });
  it('throws only for missing trusted adapters and non-function injections',async () => {
    assert.throws(() => createForecastStoreAdapter({} as never),TypeError);
    assert.throws(() => createMemoryForecastStore({ applyProbe: 1 as never }),TypeError);
    await assert.rejects(forecastTransaction({ atomic: true },async () => null),TypeError);
  });
  it('imports the browser bundle without filesystem, database, network or timer capabilities',async () => {
    const directory = await mkdtemp(join(tmpdir(),'forecast-zero-io-'));
    try {
      const path = join(directory,'forecast.js');
      execFileSync('bun',['build','packages/forecast/src/index.ts','--target','browser','--format','iife','--outfile',path],{ stdio: 'pipe' });
      let calls = 0; const trap = () => { calls++; throw Error('Import attempted host IO.'); };
      runInNewContext(await readFile(path,'utf8'),{ TextEncoder,TextDecoder,URL,structuredClone,fetch: trap,setTimeout: trap,setInterval: trap },{ timeout: 5000 });
      assert.equal(calls,0);
    } finally { await rm(directory,{ recursive: true,force: true }); }
  });
});
