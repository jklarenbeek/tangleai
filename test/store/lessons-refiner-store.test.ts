import { it } from 'node:test';
import assert from 'node:assert/strict';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';

for (const runtime of [process.execPath, 'bun']) it(`${runtime === 'bun' ? 'Bun' : 'Node'} SQLite stages guarded lessons identically to memory and rolls back every native write`, async () => {
  const result = await runRuntimeFixture(runtime, ['test/store/lessons-refiner-driver.fixture.ts'], { env: { NODE_TEST_CONTEXT: undefined } });
  const report = JSON.parse(result.stdout);
  assert.equal(report.runtime, runtime === 'bun' ? 'bun' : 'node'); assert.equal(report.physicalRequests, 0);
  assert.deepEqual(report.concurrent, { applied: 1, replayed: 19 }); assert.match(report.stateDigest, /^[a-f0-9]{64}$/);
  assert.ok(report.faultBoundaries.includes('skill:put:candidates')); assert.ok(report.faultBoundaries.includes('put:lessonSets'));
});
