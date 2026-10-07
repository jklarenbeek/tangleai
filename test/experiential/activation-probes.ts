/** Deployment conformance over synthetic recorded gate inputs, never learning evidence. */
import assert from 'node:assert/strict';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createExperientialDeployment, planExperientialActivation, planExperientialRollback, planAutomaticRollback,
  routesToCanary, type ExperientialActivationPlan, type ExperientialStoreResult } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { experientialStoreFixture, pendingActivation, type ExperientialProbeHost } from './store-fixtures.ts';

type Fixture = Awaited<ReturnType<typeof experientialStoreFixture>>;
function refused(result: ExperientialStoreResult<unknown>, code: string) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.issues[0].code, code, JSON.stringify(result));
}
async function canaryPlan(host: ExperientialProbeHost, fixture: Fixture, fraction = 0.25) {
  const pending = await pendingActivation(host.store, fixture, 'canary-conformance');
  const approval = await addressedFixture('approval', { ...pending.approval, action: 'canary', rolloutFraction: fraction });
  accepted(await host.store.put('approvals', approval));
  return accepted(planExperientialActivation({ ...pending, approval }));
}
async function rollbackPlan(host: ExperientialProbeHost, fixture: Fixture, reason = 'Synthetic rollback drill.') {
  const head = accepted(await host.store.head('fixture-profile', 'fixture'));
  const deployment = accepted(await host.store.get('deployments', fixture.servingDeployment.id))!;
  const artifact = accepted(await host.store.get('artifacts', fixture.artifact.id))!;
  const approval = await addressedFixture('approval', { action: 'rollback', artifactId: artifact.id,
    evaluationId: fixture.evaluation.id, deploymentId: deployment.id, expectedDeploymentRevision: deployment.revision,
    expectedHead: head.head, reason });
  accepted(await host.store.put('approvals', approval));
  return accepted(planExperientialRollback({ head, deployment, artifact, evaluation: fixture.evaluation, approval, reason }));
}
async function pinFor(host: ExperientialProbeHost, fixture: Fixture, runId: string) {
  const deployment = accepted(await host.store.get('deployments', fixture.servingDeployment.id))!;
  const canary = await routesToCanary(deployment, runId);
  const artifactId = canary ? deployment.canaryArtifactId : deployment.activeArtifactId;
  const artifact = accepted(await host.store.get('artifacts', artifactId!))!;
  return addressedFixture('inferencePin', { runId, deploymentId: deployment.id, deploymentRevision: deployment.revision,
    artifactId, servedModel: artifact.runtime.servedModel, canary, capability: { trainable: true } });
}

export async function runExperientialActivationProbes(createHost: () => Promise<ExperientialProbeHost>) {
  const cases: string[] = [];
  async function probe(name: string, work: (host: ExperientialProbeHost) => Promise<void>) {
    const host = await createHost();
    try { await work(host); cases.push(name); } finally { await host.close(); }
  }
  await probe('canary-contention-fences-revisions-without-moving-head', async host => {
    const fixture = await experientialStoreFixture(host.store), first = await canaryPlan(host, fixture), plans: ExperientialActivationPlan[] = [];
    for (let i = 0; i < 20; i++) {
      const approval = await addressedFixture('approval', { ...first.approval, principal: { ...first.approval.principal, id: 'canary-contender-' + i } });
      accepted(await host.store.put('approvals', approval)); plans.push(accepted(planExperientialActivation({ ...first, approval })));
    }
    const before = await host.state(), results = await Promise.all(plans.map((plan, i) => (i % 2 ? host.store : host.peer).activate(plan)));
    assert.equal(results.filter(result => result.ok).length, 1);
    for (const result of results) if (!result.ok) { assert.equal(result.issues[0].code, 'TEXP1007'); assert.equal(result.issues[0].cause?.code, 'OUTC1013'); }
    const after = await host.state(); assert.deepEqual(after.heads, before.heads); assert.equal(after.events.length - before.events.length, 1);
    assert.equal(after.artifacts.filter(a => a.state === 'active').length, 1); assert.equal(after.artifacts.filter(a => a.state === 'canary').length, 1);
    assert.equal(after.deployments.find(d => d.id === fixture.servingDeployment.id)!.revision, first.deployment.revision + 1);
  });
  await probe('in-flight-pin-survives-promotion-and-repin-is-refused', async host => {
    const fixture = await experientialStoreFixture(host.store), canary = await canaryPlan(host, fixture, 1);
    accepted(await host.store.activate(canary)); const pin = await pinFor(host, fixture, 'in-flight'); accepted(await host.store.pin(pin));
    assert.equal(pin.artifactId, canary.artifact.id); assert.equal(pin.canary, true);
    const artifact = accepted(await host.store.get('artifacts', canary.artifact.id))!;
    const approval = await addressedFixture('approval', { ...canary.approval, action: 'activate', rolloutFraction: null,
      expectedDeploymentRevision: canary.nextDeployment.revision });
    accepted(await host.store.put('approvals', approval));
    accepted(await host.store.activate(accepted(planExperientialActivation({ ...canary, artifact, deployment: canary.nextDeployment, approval }))));
    const before = await host.state(); refused(await host.store.pin(pin), 'TEXP1006');
    const stale = await addressedFixture('inferencePin', { ...pin, runId: 'new-stale-run' });
    refused(await host.store.pin(stale), 'TEXP1007'); refused(await host.store.put('pins', stale), 'TEXP1006');
    assert.deepEqual(await host.state(), before); await host.reopen(); assert.deepEqual(accepted(await host.store.get('pins', pin.id)), pin);
    assert.equal((await host.store.put('pins', pin)).ok, true);
  });
  await probe('a-run-cannot-repin-in-another-logical-scope', async host => {
    const fixture = await experientialStoreFixture(host.store), pin = await pinFor(host, fixture, 'global-native-run');
    accepted(await host.store.pin(pin));
    const base = await addressedFixture('artifact', { ...fixture.base, scope: 'foreign' }); accepted(await host.store.put('artifacts', base));
    const d = accepted(await createExperientialDeployment({ profile: 'foreign-profile', scope: 'foreign', candidateId: 'fixture-base',
      baseArtifact: base, recordedAt: base.recordedAt, operationalLimits: fixture.deployment.operationalLimits }));
    accepted(await host.store.put('deployments', d));
    const other = await addressedFixture('inferencePin', { scope: 'foreign', runId: pin.runId, deploymentId: d.id, servedModel: base.runtime.servedModel });
    const before = await host.state(); refused(await host.store.pin(other), 'TEXP1006'); assert.deepEqual(await host.state(), before);
  });
  await probe('restore-fences-an-approval-for-the-same-old-artifact-head', async host => {
    const fixture = await experientialStoreFixture(host.store), stale = await pendingActivation(host.store, fixture, 'stale-after-restore');
    const second = await pendingActivation(host.store, fixture, 'second-active'); accepted(await host.store.activate(second));
    const rollback = await rollbackPlan(host, fixture); accepted(await host.store.rollback(rollback));
    const before = await host.state(), head = accepted(await host.store.head('fixture-profile', 'fixture'));
    assert.equal(head.head.versionId, fixture.artifact.id); assert.equal(head.head.revision, 3);
    const result = await host.store.activate(stale); refused(result, 'TEXP1007'); if (!result.ok) assert.equal(result.issues[0].cause?.code, 'OUTC1013');
    assert.deepEqual(await host.state(), before); assert.equal(accepted(await host.store.get('artifacts', second.artifact.id))?.state, 'archived');
    assert.equal((await host.store.rollback(rollback)).ok, true); assert.deepEqual(await host.state(), before);
  });
  await probe('rollback-target-and-reason-are-bound-before-any-write', async host => {
    const fixture = await experientialStoreFixture(host.store), second = await pendingActivation(host.store, fixture, 'rollback-bindings');
    accepted(await host.store.activate(second)); const rollback = await rollbackPlan(host, fixture), before = await host.state();
    for (const reason of ['', ' ']) { const r = planExperientialRollback({ ...rollback, reason }); assert.ok(!r.ok); assert.equal(r.issues[0].code, 'TEXP1001'); }
    assert.equal(planExperientialRollback({ ...rollback, reason: 'Different reason.' }).ok, false);
    assert.equal(planExperientialRollback({ ...rollback, deployment: { ...rollback.deployment, expectedParentArtifactId: 'f'.repeat(64) }, reason: rollback.reason! }).ok, false);
    assert.deepEqual(await host.state(), before);
  });
  await probe('automatic-rollback-advice-needs-a-retained-policy-approval', async host => {
    const fixture = await experientialStoreFixture(host.store), second = await pendingActivation(host.store, fixture, 'operational-regression');
    accepted(await host.store.activate(second));
    const deployment = second.nextDeployment, before = await host.state();
    const intent = accepted(await planAutomaticRollback(deployment, { deploymentId: deployment.id, deploymentRevision: deployment.revision,
      count: deployment.operationalLimits.window, failureRate: 0.5, p95Ms: 50 })); assert.ok(intent);
    assert.deepEqual(await host.state(), before);
    const original = await rollbackPlan(host, fixture, intent.reason);
    const approval = await addressedFixture('approval', { ...original.approval, principal: { ...original.approval.principal, kind: 'policy', id: 'fixture-policy' } });
    const plan = accepted(planExperientialRollback({ ...original, approval, reason: intent.reason }));
    refused(await host.store.rollback(plan), 'TEXP1004'); accepted(await host.store.put('approvals', approval));
    assert.equal(accepted(await host.store.rollback(plan)).head.versionId, intent.targetArtifactId);
  });
  for (const step of ['put:experiential_artifacts', 'put:experiential_deployments', 'put:experiential_events', 'commit'])
    await probe('canary-atomic-' + step, async host => {
      const fixture = await experientialStoreFixture(host.store), plan = await canaryPlan(host, fixture), before = await host.state();
      host.failAt = step; refused(await host.store.activate(plan), 'TEXP1009'); host.failAt = null; assert.deepEqual(await host.state(), before);
    });
  for (const [step, occurrence] of [['put:experiential_artifacts', 1], ['put:experiential_artifacts', 2], ['put:experiential_deployments', 1],
    ['put:experiential_events', 1], ['put:experiential_heads', 1], ['commit', 1]] as const)
    await probe('rollback-atomic-' + step + '-' + occurrence, async host => {
      const fixture = await experientialStoreFixture(host.store), second = await pendingActivation(host.store, fixture, 'rollback-atomic');
      accepted(await host.store.activate(second)); const plan = await rollbackPlan(host, fixture), before = await host.state();
      host.failAt = step; host.failOccurrence = occurrence; refused(await host.store.rollback(plan), 'TEXP1009'); host.failAt = null;
      assert.deepEqual(await host.state(), before);
    });
  await probe('activation-deployment-write-failure-rolls-back-the-head', async host => {
    const fixture = await experientialStoreFixture(host.store), plan = await pendingActivation(host.store, fixture, 'deployment-fault'), before = await host.state();
    host.failAt = 'put:experiential_deployments'; refused(await host.store.activate(plan), 'TEXP1009'); host.failAt = null;
    assert.deepEqual(await host.state(), before);
  });
  for (const step of ['put:experiential_pins', 'put:experiential_events', 'commit']) await probe('pin-atomic-' + step, async host => {
    const fixture = await experientialStoreFixture(host.store), pin = await pinFor(host, fixture, 'pin-fault'), before = await host.state();
    host.failAt = step; refused(await host.store.pin(pin), 'TEXP1009'); host.failAt = null; assert.deepEqual(await host.state(), before);
  });
  await probe('a-retained-deployment-must-reproduce-its-transition-event', async host => {
    const fixture = await experientialStoreFixture(host.store), pin = await pinFor(host, fixture, 'audit-fence');
    const deployment = accepted(await host.store.get('deployments', fixture.servingDeployment.id))!;
    await host.persistence.transaction(tx => tx.put('deployments', { ...deployment, revision: deployment.revision + 1 }));
    const before = await host.state(); refused(await host.store.pin(pin), 'TEXP1002'); assert.deepEqual(await host.state(), before);
  });
  return { fixture: 'synthetic-deployment-conformance', passed: cases.length, failed: 0, cases,
    casesDigest: await canonicalSha256(cases), physicalRequests: 0, scientificApproval: 'not-claimed' };
}
