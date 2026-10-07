import { it } from 'node:test';
import assert from 'node:assert/strict';
import { planExperientialEvaluation, createExperientialEvaluation, recordExperientialEvaluation,
  experientialRecordId, experientialEvaluationRegistrationId, type ExperientialResult } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { passingGateMetrics } from './gate-fixtures.ts';

const refused = (result: ExperientialResult<unknown>, code: string) => {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.equal(result.issues[0].code, code, JSON.stringify(result));
};
async function inputs() {
  const baseline = await addressedFixture('artifact', { kind: 'base', baseArtifactId: null, method: null, trainingRunId: null });
  const artifact = await addressedFixture('artifact', { baseArtifactId: baseline.id });
  const dataset = await addressedFixture('dataset'), policy = await addressedFixture('gatePolicy'), head = await addressedFixture('head');
  return { artifact, baseline, dataset, policy, head, evaluatorRevision: 'a'.repeat(64), questionSetId: 'b'.repeat(64),
    sampleCount: 32, recordedAt: head.recordedAt };
}
async function prepared() {
  const input = await inputs(), plan = accepted(await planExperientialEvaluation(input));
  const measurements = passingGateMetrics(input.policy);
  const request = { registration: plan.registration, policy: input.policy, measurements,
    reportId: 'c'.repeat(64), recordedAt: input.recordedAt };
  const evaluation = accepted(await createExperientialEvaluation(request));
  const record = { ...input, artifact: plan.after, evaluation };
  return { input, plan, request, evaluation, record };
}

it('evaluation snapshots registration inputs before awaiting and grants no activation authority', async () => {
  const input = structuredClone(await inputs()), original = structuredClone(input);
  const pending = planExperientialEvaluation(input);
  input.artifact.runtime.servedModel = 'later-model'; input.policy.interval.seed++;
  input.head.head.revision++; input.evaluatorRevision = 'f'.repeat(64);
  const plan = accepted(await pending);
  assert.deepEqual(plan.before, original.artifact); assert.deepEqual(plan.policy, original.policy);
  assert.deepEqual(plan.registration.expectedHead, original.head.head);
  assert.equal(plan.registration.evaluatorRevision, original.evaluatorRevision);
  assert.equal(plan.after.state, 'evaluating'); assert.equal(plan.after.id, original.artifact.id);
  assert.ok(Object.isFrozen(plan.after.evaluationRegistration));
  const complete = await prepared(), result = accepted(await recordExperientialEvaluation(complete.record));
  assert.equal(result.after.state, 'approved'); assert.deepEqual(result.issues, []);
  assert.deepEqual(complete.input.head.head, { versionId: null, revision: 0 });
  assert.equal(complete.plan.after.state, 'evaluating');
});

it('a different base requires a migration experiment and a recorded migration can never approve', async () => {
  const input = await inputs();
  const baseline = await addressedFixture('artifact', { ...input.baseline, checksum: 'e'.repeat(64) });
  refused(await planExperientialEvaluation({ ...input, baseline }), 'TEXP1002');
  const plan = accepted(await planExperientialEvaluation({ ...input, baseline, migrationExperiment: true }));
  const measurements = { ...passingGateMetrics(input.policy), migrationExperiment: true };
  const evaluation = accepted(await createExperientialEvaluation({ registration: plan.registration, policy: input.policy,
    measurements, reportId: 'c'.repeat(64), recordedAt: input.recordedAt }));
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.failures.some(value => value.gate === 'binding' && /migration/.test(value.detail)), true);
  const result = accepted(await recordExperientialEvaluation({ ...input, artifact: plan.after, baseline, evaluation }));
  assert.equal(result.after.state, 'rejected'); assert.ok(result.issues.every(value => value.code === 'TEXP1010'));
});

it('evaluation refuses cross-scope, unregistered, nonstaged and mismatched active baselines', async () => {
  const input = await inputs();
  const policy = await addressedFixture('gatePolicy', { ...input.policy, scope: 'foreign' });
  refused(await planExperientialEvaluation({ ...input, policy }), 'TEXP1005');
  for (const state of ['evaluating', 'approved', 'active', 'rejected'] as const)
    refused(await planExperientialEvaluation({ ...input, artifact: { ...input.artifact, state } }), 'TEXP1006');
  const plan = accepted(await planExperientialEvaluation(input));
  refused(await planExperientialEvaluation({ ...input, artifact: { ...plan.after, state: 'staged' } }), 'TEXP1006');
  refused(await planExperientialEvaluation({ ...input, head: { ...input.head, head: { versionId: 'f'.repeat(64), revision: 1 } } }), 'TEXP1002');
  for (const sampleCount of [0, -1, 0.5, Number.NaN])
    refused(await planExperientialEvaluation({ ...input, sampleCount }), 'TEXP1001');
});

it('a policy revision, forged registration or added model explanation cannot retarget evaluation', async () => {
  const { input, plan, request } = await prepared();
  const policy = await addressedFixture('gatePolicy', { ...input.policy, interval: { ...input.policy.interval, seed: 1 } });
  refused(await createExperientialEvaluation({ ...request, policy }), 'TEXP1002');
  const registration = { ...plan.registration, evaluatorRevision: 'e'.repeat(64) };
  refused(await createExperientialEvaluation({ ...request, registration }), 'TEXP1002');
  const measurements = { ...request.measurements, explanation: 'The candidate is certainly excellent.' };
  refused(await createExperientialEvaluation({ ...request, measurements }), 'TEXP1001');
  const changed = structuredClone(request); changed.measurements.interval[0].low = 0;
  const result = accepted(await createExperientialEvaluation(changed));
  assert.equal(result.passed, false); assert.ok(result.failures.some(value => value.gate === 'learning'));
});

it('coverage is checked against the frozen question count even when row and pair counts agree', async () => {
  const { request } = await prepared(), changed = structuredClone(request);
  changed.measurements.rows.forEach(row => { row.samples++; });
  changed.measurements.interval.forEach(interval => { interval.pairs++; });
  const result = accepted(await createExperientialEvaluation(changed));
  assert.equal(result.passed, false); assert.equal(result.failures.some(value => value.gate === 'binding'), true);
  const missing = structuredClone(request); missing.measurements.rows.splice(2, 1);
  const incomplete = accepted(await createExperientialEvaluation(missing));
  assert.equal(incomplete.rows.length, 5); assert.equal(incomplete.rows[2].status, 'not-run'); assert.equal(incomplete.passed, false);
  const duplicate = structuredClone(request); duplicate.measurements.rows.push(duplicate.measurements.rows[0]);
  refused(await createExperientialEvaluation(duplicate), 'TEXP1001');
});

it('recording verifies the retained decision, operational receipt and registration chronology', async () => {
  const { record, evaluation } = await prepared();
  for (const change of [
    { recordedAt: '2026-09-12T23:59:59.999Z' },
    { evaluatorRevision: 'd'.repeat(64) },
    { expectedHead: { versionId: null, revision: 1 } },
    { operations: { ...evaluation.operations, artifactBytes: evaluation.operations.artifactBytes! + 1 } },
    { operations: { ...evaluation.operations, runtimeProvider: 'other' } },
    { interval: evaluation.interval.map(value => ({ ...value, low: 0 })) },
  ]) {
    const forged = await addressedFixture('evaluation', { ...evaluation, ...change });
    refused(await recordExperientialEvaluation({ ...record, evaluation: forged }), 'TEXP1002');
  }
  refused(await recordExperientialEvaluation({ ...record, artifact: { ...record.artifact, state: 'staged' } }), 'TEXP1006');
});

it('operational time and cost remain beside identity while registered policy and scientific values bind it', async () => {
  const { evaluation, plan } = await prepared();
  const changed = { ...evaluation, operations: { ...evaluation.operations, trainingMs: 2, inferenceP95Ms: 2, cost: 0.5 } };
  assert.equal(await experientialRecordId('evaluation', changed), evaluation.id);
  assert.notEqual(await experientialRecordId('evaluation', { ...evaluation, interval: evaluation.interval.map(value => ({ ...value, low: 0.1 })) }), evaluation.id);
  assert.equal(await experientialEvaluationRegistrationId({ ...plan.registration, recordedAt: '2026-09-14T00:00:00.000Z' }), plan.registration.id);
  assert.notEqual(await experientialEvaluationRegistrationId({ ...plan.registration, sampleCount: 33 }), plan.registration.id);
});
