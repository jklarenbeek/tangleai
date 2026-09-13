import { it } from 'node:test';
import assert from 'node:assert/strict';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';

for (const runtime of [process.execPath, 'bun']) it(`${runtime === 'bun' ? 'Bun' : 'Node'} SQLite qualifies the complete atomic consolidation protocol`, async () => {
  const result = await runRuntimeFixture(runtime, ['benchmark/scripts/consolidation-store.ts']);
  const report = JSON.parse(result.stdout);
  assert.equal(report.passed, 12); assert.equal(report.failed, 0); assert.equal(report.physicalRequests, 0);
  assert.equal(new Set(report.cases).size, 12);
  assert.equal(report.legacyMemoriesPreserved, 1);
  assert.equal(report.execution.passed, 16); assert.equal(report.execution.failed, 0);
  assert.equal(report.execution.physicalRequests, 0);
  assert.equal(report.triggers.passed, 27); assert.equal(report.triggers.failed, 0); assert.equal(report.triggers.physicalRequests, 0);
});
