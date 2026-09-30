import { it } from 'node:test';
import assert from 'node:assert/strict';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';
const reports: unknown[] = [];
for (const runtime of [process.execPath,'bun']) it('forecast runtime survives durable stops and manual worker ticks on ' + runtime,async () => {
  const { stdout } = await runRuntimeFixture(runtime,['benchmark/scripts/forecast-runtime.ts'],{ timeout: 120000 });
  const { backend,...report } = JSON.parse(stdout);
  assert.equal(backend,runtime === 'bun' ? 'bun-sqlite' : 'node-sqlite');
  assert.equal(report.physicalRequests,0); assert.equal(report.transportCalls,0); assert.equal(report.logicalCalls,12);
  assert.equal(report.stages.length,10); assert.equal(report.workerTicks,2); assert.equal(report.secondTickStarts,0);
  reports.push(report); if (reports.length === 2) assert.deepEqual(reports[0],reports[1]);
});
