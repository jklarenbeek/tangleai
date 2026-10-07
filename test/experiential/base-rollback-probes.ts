/** Exact-base recovery conformance; synthetic evaluations do not claim learning. */
import assert from 'node:assert/strict';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { planExperientialActivation, planExperientialRollback, planAutomaticRollback,
  type ExperientialResult } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { experientialStoreFixture, pendingActivation, type ExperientialProbeHost } from './store-fixtures.ts';

type Fixture = Awaited<ReturnType<typeof experientialStoreFixture>>;
function refused(result: ExperientialResult<unknown>, code: string) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.issues[0].code, code, JSON.stringify(result));
}
async function restorePlan(host: ExperientialProbeHost, fixture: Fixture, retain = true) {
  const deployment = accepted(await host.store.get('deployments', fixture.servingDeployment.id))!;
  const head = accepted(await host.store.head(deployment.profile, deployment.scope));
  const approval = await addressedFixture('approval', { action: 'rollback', artifactId: fixture.base.id,
    evaluationId: null, baseDigest: deployment.base.digest, deploymentId: deployment.id,
    expectedDeploymentRevision: deployment.revision, expectedHead: head.head, reason: 'Restore the registered base.' });
  if (retain) accepted(await host.store.put('approvals', approval));
  return accepted(planExperientialRollback({ head, deployment, artifact: fixture.base, evaluation: null, approval, reason: approval.reason }));
}
async function addCanary(host: ExperientialProbeHost, fixture: Fixture) {
  const input = await pendingActivation(host.store, fixture, 'base-restore-canary');
  const approval = await addressedFixture('approval', { ...input.approval, action: 'canary', rolloutFraction: 1 });
  accepted(await host.store.put('approvals', approval));
  const plan = accepted(planExperientialActivation({ ...input, approval }));
  accepted(await host.store.activate(plan)); return plan;
}

export async function runExperientialBaseRollbackProbes(createHost: () => Promise<ExperientialProbeHost>) {
  const cases: string[] = [];
  async function probe(name: string, work: (host: ExperientialProbeHost) => Promise<void>) {
    const host = await createHost();
    try { await work(host); cases.push(name); } finally { await host.close(); }
  }
  for (const firstAction of ['canary', 'activate'] as const) {
    await probe(firstAction + '-to-base-preserves-pins-evidence-revisions-and-replay', async host => {
      const fixture = await experientialStoreFixture(host.store, undefined, { firstAction });
      const staleApproval = await addressedFixture('approval', { ...fixture.plan.approval,
        principal: { ...fixture.plan.approval.principal, id: 'never-applied-stale-approval' } });
      accepted(await host.store.put('approvals', staleApproval));
      const stalePlan = accepted(planExperientialActivation({ ...fixture.plan, approval: staleApproval }));
      const pin = await addressedFixture('inferencePin', { runId: 'before-base-restore', deploymentId: fixture.servingDeployment.id,
        deploymentRevision: fixture.servingDeployment.revision, artifactId: fixture.artifact.id,
        servedModel: fixture.artifact.runtime.servedModel, canary: firstAction === 'canary', capability: { trainable: true } });
      accepted(await host.store.pin(pin));
      const plan = await restorePlan(host, fixture), before = await host.state();
      const restored = accepted(await host.store.rollback(plan));
      assert.deepEqual(restored.head, { versionId: null, revision: firstAction === 'canary' ? 1 : 2 });
      const after = await host.state();
      assert.deepEqual(after.pins, before.pins); assert.deepEqual(after.evaluations, before.evaluations);
      assert.deepEqual(after.approvals, before.approvals);
      assert.deepEqual(after.artifacts.find(a => a.id === fixture.base.id), fixture.base);
      assert.deepEqual(after.artifacts.find(a => a.id === fixture.artifact.id),
        { ...before.artifacts.find(a => a.id === fixture.artifact.id), state: 'archived' });
      const d = accepted(await host.store.get('deployments', plan.deployment.id))!;
      assert.equal(d.activeArtifactId, null); assert.equal(d.canaryArtifactId, null); assert.equal(d.rolloutFraction, 0);
      assert.equal(d.revision, plan.deployment.revision + 1); assert.equal(d.headRevision, restored.head.revision);
      assert.equal(d.rollbackReason, plan.reason); assert.equal(d.approvalId, plan.approval.id);
      const audit = after.events.find(e => e.id === restored.eventId)!;
      assert.equal(audit.kind, 'artifact-rolled-back'); assert.equal(audit.recordId, fixture.base.id);
      assert.equal(JSON.parse(audit.detail).evaluationId, null);
      await host.reopen(); assert.deepEqual(accepted(await host.store.head(d.profile, d.scope)), restored);
      const replay = await host.store.rollback(plan); assert.ok(replay.ok); assert.equal(replay.writes, 0);
      assert.deepEqual(await host.state(), after);
      const basePin = await addressedFixture('inferencePin', { runId: 'after-base-restore', deploymentId: d.id,
        deploymentRevision: d.revision, artifactId: null, servedModel: fixture.base.runtime.servedModel, canary: false });
      accepted(await host.store.pin(basePin));
      assert.deepEqual(accepted(await host.store.get('pins', pin.id)), pin);
      // The identical null version at a later revision must not reopen revision zero.
      const stale = await host.store.activate(stalePlan); refused(stale, 'TEXP1007');
      if (!stale.ok) assert.equal(stale.issues[0].cause?.code, 'OUTC1013');
      const later = await pendingActivation(host.store, fixture, 'after-base-' + firstAction);
      accepted(await host.store.activate(later)); const latest = await host.state();
      assert.equal(later.nextHead.revision, restored.head.revision + 1);
      accepted(await host.store.rollback(plan)); assert.deepEqual(await host.state(), latest);
      await host.reopen(); assert.deepEqual(accepted(await host.store.head(d.profile, d.scope)).head, later.nextHead);
    });
  }
  await probe('base-restore-withdraws-both-active-and-canary', async host => {
    const fixture = await experientialStoreFixture(host.store), canary = await addCanary(host, fixture);
    const plan = await restorePlan(host, fixture); accepted(await host.store.rollback(plan));
    for (const id of [fixture.artifact.id, canary.artifact.id]) assert.equal(accepted(await host.store.get('artifacts', id))?.state, 'archived');
    assert.equal(accepted(await host.store.get('artifacts', fixture.base.id))?.state, 'staged');
  });
  for (const change of ['head', 'deployment'] as const) await probe('base-restore-fences-stale-' + change, async host => {
    const fixture = await experientialStoreFixture(host.store), plan = await restorePlan(host, fixture);
    if (change === 'head') accepted(await host.store.activate(await pendingActivation(host.store, fixture, 'competing-head')));
    else await addCanary(host, fixture);
    const before = await host.state(), result = await host.peer.rollback(plan);
    refused(result, 'TEXP1007'); if (!result.ok) assert.equal(result.issues[0].cause?.code, 'OUTC1013');
    assert.deepEqual(await host.state(), before);
  });
  await probe('base-restore-needs-retained-authority-exact-base-and-digest', async host => {
    const fixture = await experientialStoreFixture(host.store), plan = await restorePlan(host, fixture, false);
    const before = await host.state(); refused(await host.store.rollback(plan), 'TEXP1004');
    const other = await addressedFixture('artifact', { ...fixture.base, checksum: 'f'.repeat(64) });
    accepted(await host.store.put('artifacts', other));
    for (const changes of [{ baseDigest: 'f'.repeat(64) }, { artifactId: other.id }, { artifactId: fixture.artifact.id }]) {
      const approval = await addressedFixture('approval', { ...plan.approval, ...changes });
      const stable = await host.state();
      refused(await host.store.put('approvals', approval), changes.artifactId === fixture.artifact.id ? 'TEXP1006' : 'TEXP1002');
      assert.deepEqual(await host.state(), stable);
    }
    assert.equal(planExperientialRollback({ ...plan, reason: '' }).ok, false);
    assert.equal(planExperientialRollback({ ...plan, reason: 'Different reason' }).ok, false);
    assert.equal(planExperientialRollback({ ...plan, evaluation: fixture.evaluation, reason: plan.reason! }).ok, false);
    assert.equal(planExperientialActivation({ ...plan }).ok, false);
    const after = await host.state(); assert.deepEqual(after.heads, before.heads); assert.deepEqual(after.approvals, before.approvals);
  });
  await probe('base-restore-has-one-concurrent-winner', async host => {
    const fixture = await experientialStoreFixture(host.store), first = await restorePlan(host, fixture), plans = [];
    for (let i = 0; i < 20; i++) {
      const approval = await addressedFixture('approval', { ...first.approval, principal: { ...first.approval.principal, id: 'base-operator-' + i } });
      accepted(await host.store.put('approvals', approval));
      plans.push(accepted(planExperientialRollback({ ...first, approval, reason: first.reason! })));
    }
    const results = await Promise.all(plans.map((p, i) => (i % 2 ? host.peer : host.store).rollback(p)));
    assert.equal(results.filter(r => r.ok).length, 1);
    for (const result of results) if (!result.ok) refused(result, 'TEXP1007');
    assert.deepEqual(accepted(await host.store.head('fixture-profile', 'fixture')).head, { versionId: null, revision: 2 });
  });
  await probe('automatic-base-advice-retains-host-approval-authority', async host => {
    const fixture = await experientialStoreFixture(host.store), d = fixture.servingDeployment, before = await host.state();
    const advice = accepted(await planAutomaticRollback(d, { deploymentId: d.id, deploymentRevision: d.revision,
      count: d.operationalLimits.window, failureRate: 1, p95Ms: 1 }));
    assert.equal(advice?.targetArtifactId, fixture.base.id); assert.deepEqual(await host.state(), before);
    const plan = await restorePlan(host, fixture, false);
    refused(await host.store.rollback(plan), 'TEXP1004');
    const approval = await addressedFixture('approval', { ...plan.approval, reason: advice!.reason,
      principal: { ...plan.approval.principal, kind: 'policy' } });
    accepted(await host.store.put('approvals', approval));
    accepted(await host.store.rollback(accepted(planExperientialRollback({ ...plan, approval, reason: advice!.reason }))));
  });
  for (const corruption of ['revision-zero', 'missing-event', 'forged-audit'] as const)
    await probe('retained-null-head-refuses-' + corruption, async host => {
      const fixture = await experientialStoreFixture(host.store), plan = await restorePlan(host, fixture);
      const restored = accepted(await host.store.rollback(plan));
      if (corruption === 'forged-audit') {
        const event = accepted(await host.store.get('events', restored.eventId!))!;
        const detail = JSON.parse(event.detail); detail.approvalId = 'f'.repeat(64);
        const forged = await addressedFixture('event', { ...event, detail: JSON.stringify(detail) });
        await host.persistence.transaction(async tx => {
          await tx.put('events', forged); await tx.put('heads', { ...restored, eventId: forged.id });
        });
      } else await host.persistence.transaction(tx => tx.put('heads', corruption === 'revision-zero'
        ? { ...restored, head: { versionId: null, revision: 0 } } : { ...restored, eventId: null }));
      const before = await host.state(); await host.reopen();
      refused(await host.store.head('fixture-profile', 'fixture'), 'TEXP1002');
      assert.deepEqual(await host.state(), before);
    });
  for (const mode of ['canary', 'activate', 'both'] as const) {
    const faults: Array<readonly [string, number]> = [['put:experiential_artifacts', 1], ['put:experiential_deployments', 1],
      ['put:experiential_events', 1], ['put:experiential_heads', 1], ['commit', 1]];
    if (mode === 'both') faults.push(['put:experiential_artifacts', 2]);
    for (const [step, occurrence] of faults) await probe(`base-${mode}-atomic-${step}-${occurrence}`, async host => {
      const fixture = await experientialStoreFixture(host.store, undefined, { firstAction: mode === 'canary' ? 'canary' : 'activate' });
      if (mode === 'both') await addCanary(host, fixture);
      const plan = await restorePlan(host, fixture), before = await host.state();
      host.failAt = step; host.failOccurrence = occurrence;
      refused(await host.store.rollback(plan), 'TEXP1009'); host.failAt = null;
      assert.deepEqual(await host.state(), before); await host.reopen(); assert.deepEqual(await host.state(), before);
      accepted(await host.store.rollback(plan));
    });
  }
  return { fixture: 'synthetic-base-rollback-conformance', passed: cases.length, failed: 0, cases,
    casesDigest: await canonicalSha256(cases), physicalRequests: 0, scientificApproval: 'not-claimed' };
}
