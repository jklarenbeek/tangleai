import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tabularDomainInputs } from '../../benchmark/lib/research-domain-inputs.ts';
import { runResearchDomainLifecycle } from '../../benchmark/lib/research-domain-runtime.ts';
test('the second profile executes every seed through native stages and re-admits its retained observations', async () => {
  const inputs = await tabularDomainInputs();
  const measured = await runResearchDomainLifecycle(inputs[0]);
  assert.equal(measured.lifecycle.status, 'completed'); assert.equal(measured.lifecycle.state.status, 'COMPLETE');
  assert.equal(measured.lifecycle.observations.length, 6); assert.equal(measured.lifecycle.runs.length, 6);
  assert.equal(measured.lifecycle.modelCalls, 0); assert.equal(measured.lifecycle.spend.physical, 6);
  assert.equal(measured.result, 'improvement'); assert.equal(measured.tabular?.pairs, 24);
  for (const attempt of measured.lifecycle.attempts) assert.equal(attempt.toolVersions.find(row => row.name === 'research-domain-profile')?.version,
    inputs[0].domain.profile.revision);
});
