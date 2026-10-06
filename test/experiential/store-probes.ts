/** One independent conformance fixture shared by the three persistence runtimes. */
import assert from 'node:assert/strict';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { EXPERIENTIAL_TABLES, planExperientialActivation, planExperientialRollback, resolveExperientialLineage,
  planExperienceTransition, type ExperientialTransaction, type ExperientialStoreResult } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { experientialStoreFixture, pendingActivation, replayImmutableState, type ExperientialProbeHost, type ExperientialStep } from './store-fixtures.ts';

function refused(result: ExperientialStoreResult<unknown>, code: string) {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.issues[0].code, code, JSON.stringify(result));
}

export async function runExperientialStoreProbes(createHost: () => Promise<ExperientialProbeHost>) {
  const cases: string[] = [];
  let stateDigest = '', lineageDigest = '', replayRecords = 0;
  async function probe(name: string, work: (host: ExperientialProbeHost) => Promise<void>) {
    const host = await createHost();
    try { await work(host); cases.push(name); } finally { await host.close(); }
  }
  await probe('synthetic-shell-lifecycle-lineage-reopen-replay', async host => {
    const fixture = await experientialStoreFixture(host.store), before = await host.state();
    const lineage = accepted(await resolveExperientialLineage(host.store, fixture.artifact.id));
    assert.equal(lineage.artifacts.length, 2); assert.equal(lineage.trainingRuns.length, 1); assert.equal(lineage.datasets.length, 1);
    assert.equal(lineage.assessments[0].id, fixture.assessment.id); assert.equal(lineage.experiences[0].id, fixture.experience.id);
    assert.equal(lineage.externalBytes, 'not-resolved'); assert.ok(lineage.sourceRefs.length > 0);
    assert.deepEqual(Object.keys(before).sort(), [...EXPERIENTIAL_TABLES].sort());
    assert.ok(EXPERIENTIAL_TABLES.every(table => before[table].length > 0));
    stateDigest = await canonicalSha256(before); lineageDigest = await canonicalSha256(lineage);
    const first = await host.store.activate(fixture.plan); assert.ok(first.ok); assert.equal(first.writes, 0); assert.equal(first.replayed, true);
    await host.reopen(); assert.equal(await canonicalSha256(await host.state()), stateDigest);
    const replay = await host.store.activate(fixture.plan); assert.ok(replay.ok); assert.equal(replay.writes, 0); assert.deepEqual(replay.value, fixture.active);
    replayRecords = await replayImmutableState(host.store, before);
    assert.equal(await canonicalSha256(await host.state()), stateDigest);
    assert.equal(await canonicalSha256(accepted(await resolveExperientialLineage(host.store, fixture.artifact.id))), lineageDigest);
  });
  await probe('immutable-id-time-state-and-caller-copy', async host => {
    const row = await addressedFixture('experience'), input = structuredClone(row), pending = host.store.put('experiences', input);
    input.taskRef.digest = 'f'.repeat(64); accepted(await pending);
    assert.deepEqual(accepted(await host.store.get('experiences', row.id)), row);
    const before = await host.state();
    refused(await host.store.put('experiences', { ...row, id: 'f'.repeat(64) }), 'TEXP1002');
    refused(await host.store.put('experiences', { ...row, recordedAt: '2026-10-05T10:00:00.000Z' }), 'TEXP1002');
    refused(await host.store.put('experiences', { ...row, state: 'selected' }), 'TEXP1002');
    const plan = accepted(planExperienceTransition(row, 'eligible'));
    refused(await host.store.transition({ ...plan, after: { ...plan.after, privacy: 'public' } }), 'TEXP1006');
    assert.deepEqual(await host.state(), before);
    accepted(await host.store.transition(plan)); const replay = await host.store.transition(plan); assert.ok(replay.ok); assert.equal(replay.writes, 0);
  });
  await probe('batch-refusal-rolls-back-earlier-record-and-event', async host => {
    const row = await addressedFixture('experience'), assessment = await addressedFixture('assessment', { experienceId: 'f'.repeat(64) });
    const before = await host.state();
    refused(await host.store.putBatch([{ table: 'experiences', value: row }, { table: 'assessments', value: assessment }]), 'TEXP1004');
    assert.deepEqual(await host.state(), before); assert.equal(host.store.stats().writes, 0);
  });
  await probe('twenty-approvals-one-head-transition', async host => {
    const fixture = await experientialStoreFixture(host.store), pending = await pendingActivation(host.store, fixture, 'contended');
    const plans = [];
    for (let index = 0; index < 20; index++) {
      const approval = await addressedFixture('approval', { ...pending.approval, principal: { ...pending.approval.principal, id: 'contender-' + index } });
      accepted(await host.store.put('approvals', approval));
      plans.push(accepted(planExperientialActivation({ ...pending, approval })));
    }
    const results = await Promise.all(plans.map((plan, index) => (index % 2 ? host.store : host.peer).activate(plan)));
    assert.equal(results.filter(result => result.ok).length, 1);
    for (const result of results.filter(result => !result.ok)) { assert.equal(result.issues[0].code, 'TEXP1007'); assert.equal(result.issues[0].cause?.code, 'OUTC1013'); }
    const state = await host.state(); assert.equal(state.heads.length, 1); assert.equal(state.artifacts.filter(row => row.state === 'active').length, 1);
    assert.equal(state.heads[0].head.revision, 2); assert.equal(host.store.stats().activations + host.peer.stats().activations, 2);
  });
  await probe('approved-rollback-retains-prior-artifact-and-replays', async host => {
    const fixture = await experientialStoreFixture(host.store), second = await pendingActivation(host.store, fixture, 'second');
    accepted(await host.store.activate(second));
    const target = accepted(await host.store.get('artifacts', fixture.artifact.id)); assert.ok(target); assert.equal(target.state, 'archived');
    const head = accepted(await host.store.head('fixture-profile', 'fixture'));
    const approval = await addressedFixture('approval', { action: 'rollback', artifactId: target.id, evaluationId: fixture.evaluation.id, expectedHead: head.head, reason: 'Synthetic rollback conformance.' });
    accepted(await host.store.put('approvals', approval));
    const plan = accepted(planExperientialRollback({ head, artifact: target, evaluation: fixture.evaluation, approval }));
    const applied = accepted(await host.store.rollback(plan)); assert.equal(applied.head.versionId, target.id); assert.equal(applied.head.revision, 3);
    const replay = await host.store.rollback(plan); assert.ok(replay.ok); assert.equal(replay.writes, 0);
    assert.equal(accepted(await host.store.get('artifacts', second.artifact.id))?.state, 'archived');
    assert.equal((await host.state()).artifacts.length, 3);
  });
  for (const table of EXPERIENTIAL_TABLES) await probe('atomic-failure-' + table, async host => {
    host.failAt = 'put:experiential_' + table;
    let failed = false;
    const stop = new Error('Expected injected refusal.');
    const step: ExperientialStep = async run => {
      const state = await host.state(), counts = host.store.stats(), result = await run();
      if (!result.ok) {
        assert.equal(result.issues[0].code, 'TEXP1009');
        assert.deepEqual(await host.state(), state);
        assert.equal(host.store.stats().writes, counts.writes); assert.equal(host.store.stats().activations, counts.activations);
        failed = true; throw stop;
      }
      return result.value;
    };
    try { await experientialStoreFixture(host.store, step); } catch (error) { if (error !== stop) throw error; }
    assert.equal(failed, true, table);
  });
  for (const [step, occurrence] of [['put:experiential_artifacts', 1], ['put:experiential_artifacts', 2], ['put:experiential_events', 1], ['put:experiential_heads', 1], ['commit', 1]] as const)
    await probe(`activation-rollback-${step}-${occurrence}`, async host => {
      const fixture = await experientialStoreFixture(host.store), plan = await pendingActivation(host.store, fixture, 'atomic-second');
      const before = await host.state(), counts = host.store.stats(); host.failAt = step; host.failOccurrence = occurrence;
      refused(await host.store.activate(plan), 'TEXP1009'); host.failAt = null;
      assert.deepEqual(await host.state(), before); assert.equal(host.store.stats().writes, counts.writes); assert.equal(host.store.stats().activations, counts.activations);
      assert.equal(accepted(await host.store.head('fixture-profile', 'fixture')).head.versionId, fixture.artifact.id);
    });
  await probe('escaped-transaction-has-no-later-authority', async host => {
    let escaped!: ExperientialTransaction;
    await host.persistence.transaction(async tx => { escaped = tx; });
    const row = await addressedFixture('experience'), before = await host.state();
    await assert.rejects(escaped.put('experiences', row), /ended/);
    await assert.rejects(escaped.get('experiences', row.id), /ended/);
    await assert.rejects(escaped.list('experiences', row.scope), /ended/);
    assert.deepEqual(await host.state(), before);
  });
  await probe('lineage-missing-selected-experience', async host => {
    const fixture = await experientialStoreFixture(host.store);
    const result = await resolveExperientialLineage({ get: async (table, id) => table === 'experiences' && id === fixture.experience.id
      ? { ok: true, value: null, writes: 0, replayed: true } : host.store.get(table, id) }, fixture.artifact.id);
    assert.equal(result.ok, false); if (!result.ok) { assert.equal(result.issues[0].code, 'TEXP1004'); assert.ok(result.issues[0].path.includes(fixture.experience.id)); }
  });
  await probe('lineage-refuses-source-without-digest', async host => {
    const fixture = await experientialStoreFixture(host.store), broken = structuredClone(fixture.experience);
    delete (broken.sourceRefs[0] as Partial<typeof broken.sourceRefs[0]>).digest;
    await host.persistence.transaction(tx => tx.put('experiences', broken));
    const result = await resolveExperientialLineage(host.store, fixture.artifact.id);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.issues[0].code, 'TEXP1004');
  });
  await probe('lineage-refuses-artifact-without-training', async host => {
    const fixture = await experientialStoreFixture(host.store), broken = await addressedFixture('artifact', { baseArtifactId: fixture.base.id, trainingRunId: null });
    refused(await host.store.put('artifacts', broken), 'TEXP1004');
    await host.persistence.transaction(tx => tx.put('artifacts', broken));
    const result = await resolveExperientialLineage(host.store, broken.id);
    assert.equal(result.ok, false); if (!result.ok) assert.equal(result.issues[0].code, 'TEXP1004');
  });
  await probe('a-later-assessment-cannot-rewrite-dataset-provenance', async host => {
    const fixture = await experientialStoreFixture(host.store), later = await addressedFixture('assessment', { experienceId: fixture.experience.id, inclusion: 'exclude', reason: 'later-review' });
    accepted(await host.store.put('assessments', later));
    const lineage = accepted(await resolveExperientialLineage(host.store, fixture.artifact.id));
    assert.deepEqual(lineage.assessments.map(row => row.id), [fixture.assessment.id]);
  });
  await probe('cross-scope-links-never-admit', async host => {
    const observed = await addressedFixture('experience'); accepted(await host.store.put('experiences', observed));
    const assessment = await addressedFixture('assessment', { experienceId: observed.id, scope: 'foreign' });
    const before = await host.state(), counts = host.store.stats();
    refused(await host.store.put('assessments', assessment), 'TEXP1005');
    assert.deepEqual(await host.state(), before); assert.equal(host.store.stats().writes, counts.writes);
  });
  await probe('ordinary-put-cannot-mint-command-authority', async host => {
    const before = await host.state();
    refused(await host.store.put('heads', await addressedFixture('head')), 'TEXP1006');
    refused(await host.store.put('events', await addressedFixture('event')), 'TEXP1006');
    refused(await host.store.put('artifacts', await addressedFixture('artifact', { state: 'active' })), 'TEXP1006');
    assert.deepEqual(await host.state(), before); assert.equal(host.store.stats().activations, 0);
  });
  await probe('head-must-reproduce-retained-activation-event', async host => {
    const fixture = await experientialStoreFixture(host.store);
    await host.persistence.transaction(tx => tx.put('heads', { ...fixture.active, head: { ...fixture.active.head, revision: 2 } }));
    const before = await host.state();
    refused(await host.store.head('fixture-profile', 'fixture'), 'TEXP1002');
    assert.deepEqual(await host.state(), before);
  });
  await probe('historical-activation-replay-does-not-rewind-a-newer-head', async host => {
    const fixture = await experientialStoreFixture(host.store), second = await pendingActivation(host.store, fixture, 'replay-after-new-head');
    const current = accepted(await host.store.activate(second)), before = await host.state();
    const replay = await host.store.activate(fixture.plan); assert.ok(replay.ok); assert.equal(replay.writes, 0);
    assert.deepEqual(replay.value, fixture.active); assert.deepEqual(await host.state(), before);
    assert.deepEqual(accepted(await host.store.head('fixture-profile', 'fixture')), current);
  });
  await probe('approval-must-be-retained-with-exact-bytes', async host => {
    const fixture = await experientialStoreFixture(host.store), plan = await pendingActivation(host.store, fixture, 'bound-approval');
    const fresh = await addressedFixture('approval', { ...plan.approval, principal: { ...plan.approval.principal, id: 'unretained-principal' } });
    const unretained = accepted(planExperientialActivation({ ...plan, approval: fresh })), before = await host.state();
    refused(await host.store.activate(unretained), 'TEXP1004');
    const changed = accepted(planExperientialActivation({ ...plan, approval: { ...plan.approval, recordedAt: '2026-10-05T00:00:00.000Z' } }));
    refused(await host.store.activate(changed), 'TEXP1006'); assert.deepEqual(await host.state(), before);
  });
  return { fixture: 'synthetic-state-conformance', passed: cases.length, failed: 0, physicalRequests: 0, cases, stateDigest, lineageDigest, replayRecords };
}
