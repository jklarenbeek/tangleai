import assert from 'node:assert/strict';
import { it } from 'node:test';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';

for (const runtime of [process.execPath, 'bun']) it(`${runtime === 'bun' ? 'Bun' : 'Node'} SQLite qualifies cadence, stale-parent execution, foreground availability and retained archival`, async () => {
  const result = await runRuntimeFixture(runtime, ['test/store/cadence-driver.fixture.ts'], { timeout: 120000, env: { NODE_TEST_CONTEXT: undefined } });
  const row = JSON.parse(result.stdout);
  assert.equal(row.runtime, runtime === 'bun' ? 'bun' : 'node'); assert.equal(row.passed, 12); assert.equal(row.failed, 0);
  assert.equal(new Set(row.cases).size, 12); assert.equal(row.physicalRequests, 0); assert.equal(row.scientificApproval, 'not-claimed');
  assert.deepEqual(row.measurements.duplicateTicks, { ticks: 20, enqueued: 1, replayed: 19, jobsAfterReopen: 1, submissions: 0 });
  assert.deepEqual(row.measurements.cancel, { action: 'cancelled', cancelled: 1, rebased: 0, submissions: 0 });
  assert.deepEqual(row.measurements.rebase, { action: 'rebased', cancelled: 1, rebased: 1, submissions: 1 });
  assert.deepEqual(row.measurements.foreground, { clockMs: 0, memoryWrites: 1, memoryReads: 1, memoryRecalls: 1, documentIngests: 1, trainingStillBlocked: true });
});
