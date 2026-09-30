import { it } from 'node:test';
import assert from 'node:assert/strict';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';
import { runForecastStoreProbes,createMemoryForecastProbeHost } from '../../benchmark/lib/forecast-store-probes.ts';

for (const runtime of [process.execPath,'bun']) it('forecast additive upgrade and lifecycle on ' + runtime,async () => {
  const { stdout } = await runRuntimeFixture(runtime,['benchmark/scripts/forecast-store.ts'],{ timeout: 120000 });
  const report = JSON.parse(stdout),reference = await runForecastStoreProbes(createMemoryForecastProbeHost);
  assert.equal(report.backend,runtime === 'bun' ? 'bun-sqlite' : 'node-sqlite');
  for (const [key,value] of Object.entries(reference)) assert.deepEqual(report[key],value,key);
  assert.equal(report.passed,17); assert.equal(report.failed,0); assert.equal(report.physicalRequests,0);
  assert.equal(report.legacyMemoriesPreserved,1); assert.equal(report.integrity,true); assert.equal(report.repeatWrites,0);
});
