import { it } from 'node:test';
import assert from 'node:assert/strict';
import { planExperienceTransition, planTrainingTransition, planArtifactTransition,
  planExperientialActivation, planExperientialRollback, planExperientialEvaluation, createExperientialEvaluation,
  recordExperientialEvaluation, type ExperientialActivationInput } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { passingGateMetrics } from './gate-fixtures.ts';

it('experience transitions admit only the reviewed selection edges', async () => {
  const row = await addressedFixture('experience'), states = ['observed', 'quarantined', 'eligible', 'selected', 'excluded'] as const;
  const allowed = new Set(['observed/quarantined', 'observed/eligible', 'eligible/selected', 'eligible/excluded']);
  for (const before of states) for (const after of states) {
    const result = planExperienceTransition({ ...row, state: before }, after);
    assert.equal(result.ok, allowed.has(before + '/' + after), before + '/' + after);
    if (result.ok) { assert.equal(result.value.after.id, row.id); assert.equal(result.value.before.state, before); assert.equal(result.value.after.state, after); }
    else assert.equal(result.issues[0].code, 'TEXP1006');
  }
});

it('training cannot skip successful stages or resume a terminal run, and can stop before materialization', async () => {
  const row = await addressedFixture('trainingRun'), states = ['queued', 'preparing', 'training', 'materializing', 'complete', 'failed', 'cancelled'] as const;
  const allowed = new Set(['queued/preparing', 'preparing/training', 'training/materializing', 'materializing/complete',
    'queued/failed', 'queued/cancelled', 'preparing/failed', 'preparing/cancelled', 'training/failed', 'training/cancelled', 'materializing/failed', 'materializing/cancelled']);
  for (const before of states) for (const after of states) {
    const result = planTrainingTransition({ ...row, state: before }, after);
    assert.equal(result.ok, allowed.has(before + '/' + after), before + '/' + after);
    if (!result.ok) assert.equal(result.issues[0].code, 'TEXP1006');
  }
});

it('artifact state plans cannot skip evaluation or replace activation approval with a generic transition', async () => {
  const row = await addressedFixture('artifact'), states = ['staged', 'evaluating', 'rejected', 'approved', 'canary', 'active', 'archived'] as const;
  const allowed = new Set(['staged/evaluating', 'evaluating/rejected', 'evaluating/approved', 'approved/canary', 'canary/active', 'active/archived']);
  for (const before of states) for (const after of states) {
    const result = planArtifactTransition({ ...row, state: before }, after);
    assert.equal(result.ok, allowed.has(before + '/' + after), before + '/' + after);
    if (!result.ok) assert.equal(result.issues[0].code, 'TEXP1006');
  }
});

async function activationFixture(): Promise<ExperientialActivationInput> {
  const baseline = await addressedFixture('artifact', { kind: 'base', baseArtifactId: null, method: null, trainingRunId: null });
  const candidate = await addressedFixture('artifact', { baseArtifactId: baseline.id });
  const dataset = await addressedFixture('dataset'), policy = await addressedFixture('gatePolicy');
  const head = await addressedFixture('head');
  const planned = accepted(await planExperientialEvaluation({ artifact: candidate, baseline, dataset, policy, head,
    evaluatorRevision: 'a'.repeat(64), questionSetId: 'b'.repeat(64), sampleCount: 32, recordedAt: head.recordedAt }));
  const evaluation = accepted(await createExperientialEvaluation({ registration: planned.registration, policy,
    measurements: passingGateMetrics(policy), reportId: 'c'.repeat(64), recordedAt: head.recordedAt }));
  const artifact = accepted(await recordExperientialEvaluation({ artifact: planned.after, baseline, dataset, policy, evaluation })).after;
  const approval = await addressedFixture('approval', { artifactId: artifact.id, evaluationId: evaluation.id, expectedHead: head.head });
  return { head, artifact, evaluation, approval };
}

it('activation binds scope, profile, action, artifact, evaluation and a passing result', async () => {
  const input = await activationFixture(), plan = accepted(planExperientialActivation(input));
  assert.deepEqual(plan.nextHead, { versionId: input.artifact.id, revision: 1 });
  assert.deepEqual(accepted(planExperientialActivation({ ...input, artifact: { ...input.artifact, state: 'canary' } })).nextHead, plan.nextHead);
  const mutations: Array<(row: ExperientialActivationInput) => void> = [
    row => { row.approval.scope = 'other'; }, row => { row.approval.profile = 'other'; },
    row => { row.approval.action = 'canary'; }, row => { row.approval.artifactId = 'f'.repeat(64); },
    row => { row.approval.evaluationId = 'f'.repeat(64); }, row => { row.evaluation.artifactId = 'f'.repeat(64); },
    row => { row.evaluation.passed = false; }, row => { row.evaluation.failures = [{ gate: 'learning', detail: 'failed', observed: 0, tolerance: 0 }]; },
    row => { row.artifact.state = 'staged'; }, row => { row.approval.reason = ' '; },
  ];
  for (const change of mutations) { const copy = structuredClone(input); change(copy); assert.equal(planExperientialActivation(copy).ok, false); }
  assert.equal(input.artifact.state, 'approved'); assert.ok(Object.isFrozen(plan));
});

it('a stale head preserves the native OUTC1013 cause before a contender-changed artifact state', async () => {
  const input = await activationFixture();
  for (const changed of [{ versionId: 'f'.repeat(64), revision: 1 }, { versionId: null, revision: 1 }]) {
    const result = planExperientialActivation({ ...input, head: { ...input.head, head: changed }, artifact: { ...input.artifact, state: 'active' } });
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.issues[0].code, 'TEXP1007'); assert.equal(result.issues[0].cause?.code, 'OUTC1013'); }
  }
  const maximum = { versionId: 'f'.repeat(64), revision: Number.MAX_SAFE_INTEGER };
  const full = planExperientialActivation({ ...input, head: { ...input.head, head: maximum }, approval: { ...input.approval, expectedHead: maximum } });
  assert.equal(full.ok, false); if (!full.ok) assert.equal(full.issues[0].code, 'TEXP1009');
});

it('rollback requires an archived target, matching rollback approval and a reason', async () => {
  const input = await activationFixture(), current = { versionId: 'f'.repeat(64), revision: 2 };
  const request: ExperientialActivationInput = { ...input, head: { ...input.head, head: current }, artifact: { ...input.artifact, state: 'archived' },
    approval: { ...input.approval, action: 'rollback', expectedHead: current } };
  assert.deepEqual(accepted(planExperientialRollback(request)).nextHead, { versionId: input.artifact.id, revision: 3 });
  assert.equal(planExperientialRollback({ ...request, artifact: { ...request.artifact, state: 'staged' } }).ok, false);
  assert.equal(planExperientialRollback({ ...request, approval: { ...request.approval, action: 'activate' } }).ok, false);
});
