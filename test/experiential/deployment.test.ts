import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createExperientialDeployment, experientialRecordId, experientialBaseDigest, planAutomaticRollback } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { inferenceFixture } from './inference-fixtures.ts';

it('registers the resolved base role and keeps deployment identity stable through serving revisions', async () => {
  const f = await inferenceFixture(), d = f.deployment;
  assert.equal(d.baseArtifactId, f.baseArtifact.id);
  assert.equal(d.base.digest, await experientialBaseDigest(f.identity.roles.chat));
  assert.notEqual(d.base.digest, f.baseArtifact.checksum);
  assert.equal(await experientialRecordId('deployment', { ...d, revision: 2, headRevision: 1,
    activeArtifactId: 'a'.repeat(64), canaryArtifactId: 'b'.repeat(64), rolloutFraction: 0.25 }), d.id);
  assert.notEqual(await experientialRecordId('deployment', { ...d,
    operationalLimits: { ...d.operationalLimits, window: 21 } }), d.id);
  assert.notEqual(await experientialRecordId('deployment', { ...d, baseArtifactId: 'b'.repeat(64) }), d.id);
});

it('snapshots registration inputs before hashing and refuses an unrelated or learned base', async () => {
  const f = await inferenceFixture(), input = { profile: 'base', scope: f.baseArtifact.scope, candidateId: 'chat-beta',
    baseArtifact: structuredClone(f.baseArtifact), operationalLimits: { maxFailureRate: 0.1, maxP95Ms: 200, window: 20 },
    recordedAt: f.recordedAt };
  const pending = createExperientialDeployment(input);
  input.operationalLimits.window = 999; input.baseArtifact.runtime.servedModel = 'mutated';
  assert.deepEqual(accepted(await pending), f.deployment);
  assert.equal((await createExperientialDeployment({ ...input, baseArtifact: f.baseArtifact, scope: 'foreign' })).ok, false);
  assert.equal((await createExperientialDeployment({ ...input, baseArtifact: await addressedFixture('artifact') })).ok, false);
});

it('automatic rollback uses an exact registered window, strict thresholds and no approval authority', async () => {
  const { deployment } = await inferenceFixture();
  const d = { ...deployment, activeArtifactId: 'a'.repeat(64), expectedParentArtifactId: 'b'.repeat(64), revision: 4, headRevision: 3 };
  const observed = { deploymentId: d.id, deploymentRevision: d.revision, count: 20, failureRate: 0.1, p95Ms: 200 };
  assert.equal(accepted(await planAutomaticRollback(d, observed)), null);
  assert.equal(accepted(await planAutomaticRollback(d, { ...observed, count: 19, failureRate: 1 })), null);
  for (const changed of [{ failureRate: 0.11 }, { p95Ms: 201 }]) {
    const plan = accepted(await planAutomaticRollback(d, { ...observed, ...changed })); assert.ok(plan);
    assert.equal(plan.targetArtifactId, d.expectedParentArtifactId);
    assert.deepEqual(plan.expectedHead, { versionId: d.activeArtifactId, revision: 3 });
    assert.ok(!Object.hasOwn(plan, 'approval')); assert.ok(!Object.hasOwn(plan, 'principal'));
  }
  for (const changed of [{ count: 21 }, { count: 0 }, { deploymentRevision: 3 }, { deploymentId: 'c'.repeat(64) }, { p95Ms: NaN }])
    assert.equal((await planAutomaticRollback(d, { ...observed, ...changed })).ok, false);
  assert.equal((await planAutomaticRollback({ ...d, expectedParentArtifactId: null }, { ...observed, failureRate: 1 })).ok, false);
});

it('automatic rollback refuses limits changed under the registered deployment identity', async () => {
  const { deployment } = await inferenceFixture();
  const changed = { ...deployment, activeArtifactId: 'a'.repeat(64), expectedParentArtifactId: 'b'.repeat(64),
    revision: 2, headRevision: 2, operationalLimits: { ...deployment.operationalLimits, maxFailureRate: 0 } };
  const result = await planAutomaticRollback(changed, { deploymentId: changed.id, deploymentRevision: 2, count: 20, failureRate: 0.05, p95Ms: 10 });
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.issues[0].code, 'TEXP1002');
});

it('automatic advice snapshots the observed window before asynchronous identity checks yield', async () => {
  const { deployment } = await inferenceFixture();
  const observed = { deploymentId: deployment.id, deploymentRevision: 0, count: 20, failureRate: 0.1, p95Ms: 200 };
  const pending = planAutomaticRollback(deployment, observed);
  observed.failureRate = 1;
  assert.equal(accepted(await pending), null);
});
