import { it } from 'node:test';
import assert from 'node:assert/strict';
import { runExperientialStoreProbes } from './store-probes.ts';
import { createExperientialMemoryProbe } from './memory-host.ts';

it('memory qualifies experiential lifecycle, rollback, lineage, faults and concurrent native CAS', async () => {
  const report = await runExperientialStoreProbes(createExperientialMemoryProbe);
  assert.equal(report.passed, 48); assert.equal(report.failed, 0); assert.equal(report.physicalRequests, 0);
  assert.equal(new Set(report.cases).size, report.passed); assert.ok(report.replayRecords > 13);
});
