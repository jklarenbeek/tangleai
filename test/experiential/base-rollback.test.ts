import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createExperientialMemoryProbe } from './memory-host.ts';
import { runExperientialBaseRollbackProbes } from './base-rollback-probes.ts';

it('memory restores the exact registered base with durable revision fences and atomic audit', async () => {
  const report = await runExperientialBaseRollbackProbes(createExperientialMemoryProbe);
  assert.equal(report.passed, 27); assert.equal(report.failed, 0);
  assert.equal(report.physicalRequests, 0); assert.equal(report.scientificApproval, 'not-claimed');
});
