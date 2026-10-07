/** Atomic evaluation acceptance and refusals run unchanged on memory, Node SQLite and Bun SQLite. */
import assert from 'node:assert/strict';
import { planArtifactTransition, planExperientialEvaluation, createExperientialEvaluation, reviseGatePolicy,
  type ExperientialStoreResult } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { experientialStoreFixture, stagedCandidateFixture, pendingActivation, EXPERIENTIAL_FIXTURE_TIME,
  type ExperientialProbeHost } from './store-fixtures.ts';
import { passingGateMetrics } from './gate-fixtures.ts';

type Probe = (name: string, work: (host: ExperientialProbeHost) => Promise<void>) => Promise<void>;
const refused = (result: ExperientialStoreResult<unknown>, code: string) => {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.issues[0].code, code, JSON.stringify(result));
};
async function staged(host: ExperientialProbeHost) {
  const fixture = await experientialStoreFixture(host.store);
  const candidate = await stagedCandidateFixture(host.store, fixture.dataset, fixture.base, 'evaluation-candidate');
  const head = accepted(await host.store.head('fixture-profile', 'fixture'));
  const baseline = accepted(await host.store.get('artifacts', head.head.versionId!))!;
  const plan = accepted(await planExperientialEvaluation({ artifact: candidate.artifact, baseline, dataset: fixture.dataset,
    policy: fixture.policy, head, evaluatorRevision: 'a'.repeat(64), questionSetId: 'b'.repeat(64), sampleCount: 32, recordedAt: EXPERIENTIAL_FIXTURE_TIME }));
  const result = async (metrics = passingGateMetrics(fixture.policy)) => accepted(await createExperientialEvaluation({
    registration: plan.registration, policy: fixture.policy, measurements: metrics, reportId: 'c'.repeat(64), recordedAt: EXPERIENTIAL_FIXTURE_TIME }));
  return { fixture, candidate, head, baseline, plan, result };
}

export async function runEvaluationStoreProbes(probe: Probe) {
  await probe('evaluation-registration-reopen-and-replay', async host => {
    const prepared = await staged(host), before = host.store.stats().writes;
    accepted(await host.store.startEvaluation(prepared.plan));
    assert.equal(host.store.stats().writes - before, 2);
    const state = await host.state(); await host.reopen();
    const retry = await host.store.startEvaluation(prepared.plan); assert.ok(retry.ok); assert.equal(retry.writes, 0);
    assert.deepEqual(await host.state(), state);
    assert.equal(accepted(await host.store.get('artifacts', prepared.candidate.artifact.id))?.evaluationRegistration?.gatePolicyId, prepared.fixture.policy.id);
  });
  await probe('evaluation-requires-policy-persisted-before-start', async host => {
    const prepared = await staged(host), policy = await addressedFixture('gatePolicy', { retention: { ...prepared.fixture.policy.retention, cgtReplayMaxDrop: 0.01 } });
    const plan = accepted(await planExperientialEvaluation({ artifact: prepared.candidate.artifact, baseline: prepared.baseline,
      dataset: prepared.fixture.dataset, policy, head: prepared.head, evaluatorRevision: 'a'.repeat(64), questionSetId: 'b'.repeat(64), sampleCount: 32, recordedAt: EXPERIENTIAL_FIXTURE_TIME }));
    const before = await host.state(); refused(await host.store.startEvaluation(plan), 'TEXP1004');
    assert.deepEqual(await host.state(), before);
  });
  await probe('generic-writes-cannot-start-or-complete-evaluation', async host => {
    const prepared = await staged(host), before = await host.state();
    refused(await host.store.transition(accepted(planArtifactTransition(prepared.candidate.artifact, 'evaluating'))), 'TEXP1006');
    refused(await host.store.put('evaluations', await prepared.result()), 'TEXP1006');
    refused(await host.store.recordEvaluation(await prepared.result()), 'TEXP1006');
    assert.deepEqual(await host.state(), before);
  });
  await probe('mid-evaluation-policy-revision-does-not-retarget-registration', async host => {
    const prepared = await staged(host); accepted(await host.store.startEvaluation(prepared.plan));
    const proposal = await addressedFixture('gatePolicy', { retention: { ...prepared.fixture.policy.retention, cgtReplayMaxDrop: 0.05 } });
    const revised = accepted(await reviseGatePolicy({ proposal, read: async () => accepted(await host.store.get('gate_policies', prepared.fixture.policy.id))!,
      commit: next => host.store.put('gate_policies', next) }));
    const original = await prepared.result(), wrong = await addressedFixture('evaluation', { ...original, gatePolicyId: revised.id });
    const before = await host.state(); refused(await host.store.recordEvaluation(wrong), 'TEXP1002');
    assert.deepEqual(await host.state(), before);
    accepted(await host.store.recordEvaluation(original));
    assert.equal(accepted(await host.store.get('artifacts', prepared.candidate.artifact.id))?.evaluationRegistration?.gatePolicyId, prepared.fixture.policy.id);
  });
  await probe('recorded-rejection-retains-losses-and-leaves-the-active-head', async host => {
    const prepared = await staged(host); accepted(await host.store.startEvaluation(prepared.plan));
    const metrics = passingGateMetrics(prepared.fixture.policy); metrics.interval[0].low = 0;
    metrics.retention[2] = { lane: 'locomo-recall', status: 'not-run', drop: null };
    metrics.security[0].outcome = 'changed'; metrics.operations.inferenceP95Ms = 101;
    metrics.rows.splice(0, 1);
    const evaluation = await prepared.result(metrics), applied = accepted(await host.store.recordEvaluation(evaluation));
    assert.equal(applied.after.state, 'rejected'); assert.equal(evaluation.rows[0].status, 'not-run');
    assert.deepEqual(new Set(evaluation.failures.map(f => f.gate)), new Set(['learning', 'retention', 'security', 'operations']));
    assert.ok(applied.issues.every(issue => issue.code === 'TEXP1010')); assert.equal(applied.issues.length, evaluation.failures.length);
    assert.deepEqual(accepted(await host.store.head('fixture-profile', 'fixture')), prepared.head);
    const replay = await host.store.recordEvaluation(evaluation); assert.ok(replay.ok); assert.equal(replay.writes, 0);
  });
  await probe('passing-conformance-approves-without-activating', async host => {
    const prepared = await staged(host); accepted(await host.store.startEvaluation(prepared.plan));
    const evaluation = await prepared.result(), before = await host.state();
    const result = accepted(await host.store.recordEvaluation(evaluation));
    assert.equal(result.after.state, 'approved'); assert.deepEqual(result.issues, []);
    const after = await host.state(); assert.deepEqual(after.heads, before.heads); assert.deepEqual(after.approvals, before.approvals);
    assert.equal(after.evaluations.length, before.evaluations.length + 1);
    const retry = await host.store.recordEvaluation(evaluation); assert.ok(retry.ok); assert.equal(retry.writes, 0);
  });
  await probe('rehashing-cannot-forge-gates-bindings-coverage-or-receipt', async host => {
    const prepared = await staged(host); accepted(await host.store.startEvaluation(prepared.plan));
    const evaluation = await prepared.result(), before = await host.state();
    for (const mutate of [
      (e: typeof evaluation) => { e.interval[0].low = 0; },
      (e: typeof evaluation) => { e.interval[0].seed++; },
      (e: typeof evaluation) => { e.rows.forEach(row => row.samples++); e.interval.forEach(row => row.pairs++); },
      (e: typeof evaluation) => { e.evaluatorRevision = 'e'.repeat(64); },
      (e: typeof evaluation) => { e.expectedHead.revision++; },
      (e: typeof evaluation) => { e.operations.artifactBytes!++; },
      (e: typeof evaluation) => { e.registrationId = 'e'.repeat(64); },
    ]) {
      const copy = structuredClone(evaluation); mutate(copy);
      refused(await host.store.recordEvaluation(await addressedFixture('evaluation', copy)), 'TEXP1002');
      assert.deepEqual(await host.state(), before);
    }
  });
  await probe('stale-evaluation-start-preserves-native-head-cause', async host => {
    const prepared = await staged(host), competing = await pendingActivation(host.store, prepared.fixture, 'evaluation-race');
    accepted(await host.store.activate(competing)); const before = await host.state();
    const refusedStart = await host.store.startEvaluation(prepared.plan); refused(refusedStart, 'TEXP1007');
    if (!refusedStart.ok) assert.equal(refusedStart.issues[0].cause?.code, 'OUTC1013');
    assert.deepEqual(await host.state(), before);
  });
  for (const target of ['put:experiential_artifacts', 'put:experiential_events', 'commit'])
    await probe('evaluation-registration-atomic-' + target, async host => {
      const prepared = await staged(host), before = await host.state(), counts = host.store.stats();
      host.failAt = target; host.failOccurrence = 1;
      refused(await host.store.startEvaluation(prepared.plan), 'TEXP1009'); host.failAt = null;
      assert.deepEqual(await host.state(), before); assert.deepEqual(host.store.stats(), { ...counts, transactions: counts.transactions + 1 });
    });
  for (const target of ['put:experiential_evaluations', 'put:experiential_artifacts', 'put:experiential_events', 'commit'])
    await probe('evaluation-atomic-' + target, async host => {
      const prepared = await staged(host); accepted(await host.store.startEvaluation(prepared.plan));
      const evaluation = await prepared.result(), before = await host.state(), counts = host.store.stats();
      host.failAt = target; host.failOccurrence = 1;
      refused(await host.store.recordEvaluation(evaluation), 'TEXP1009'); host.failAt = null;
      assert.deepEqual(await host.state(), before); assert.deepEqual(host.store.stats(), { ...counts, transactions: counts.transactions + 1 });
    });
}
