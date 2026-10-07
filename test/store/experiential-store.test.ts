import { it } from 'node:test';
import assert from 'node:assert/strict';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';

for (const runtime of [process.execPath, 'bun']) it(`${runtime === 'bun' ? 'Bun' : 'Node'} SQLite matches experiential memory, retains lineage and upgrades existing memory`, async () => {
  const result = await runRuntimeFixture(runtime, ['test/store/experiential-driver.fixture.ts'], { env: { NODE_TEST_CONTEXT: undefined } });
  const row = JSON.parse(result.stdout);
  assert.equal(row.runtime, runtime === 'bun' ? 'bun' : 'node'); assert.equal(row.legacyMemoriesPreserved, 1);
  assert.equal(row.report.passed, 49); assert.equal(row.report.failed, 0); assert.equal(row.report.physicalRequests, 0);
  assert.equal(new Set(row.report.cases).size, row.report.passed); assert.ok(row.report.replayRecords > 13);
});
