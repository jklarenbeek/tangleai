import { it } from 'node:test';
import assert from 'node:assert/strict';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';

for (const runtime of [process.execPath, 'bun']) it(`${runtime === 'bun' ? 'Bun' : 'Node'} SQLite matches exact-base recovery, faults and reopen behavior`, async () => {
  const result = await runRuntimeFixture(runtime, ['test/store/base-rollback-driver.fixture.ts'], { env: { NODE_TEST_CONTEXT: undefined } });
  const row = JSON.parse(result.stdout);
  assert.equal(row.runtime, runtime === 'bun' ? 'bun' : 'node'); assert.equal(row.report.passed, 27);
  assert.equal(row.report.failed, 0); assert.equal(row.report.physicalRequests, 0);
  assert.equal(new Set(row.report.cases).size, row.report.passed);
});
