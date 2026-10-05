import assert from 'node:assert/strict';
import { test } from 'node:test';
import { researchControlPlaneParity, probeUnsupportedResearchDomain } from '../../benchmark/lib/research-domain-probes.ts';
import { tabularFixture } from './tabular-fixtures.ts';
test('shared control-plane sources contain zero profile literals and zero domain equality branches', async () => {
  const result = await researchControlPlaneParity();
  assert.ok(result.sources.length >= 10); assert.equal(result.profileLiterals, 0); assert.equal(result.domainComparisons, 0);
  assert.deepEqual(await researchControlPlaneParity(), result);
});
test('the unsupported profile names its absent evaluator and refuses before any call or runner dispatch', async () => {
  const f = await tabularFixture(), result = await probeUnsupportedResearchDomain(f.domain);
  assert.equal(result.code, 'TRSH2008'); assert.equal(result.missingId, f.domain.profile.evaluatorId);
  assert.equal(result.modelCalls, 0); assert.equal(result.runnerInvocations, 0);
});
