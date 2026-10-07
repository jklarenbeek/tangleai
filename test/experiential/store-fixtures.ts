/** Synthetic persistence conformance. Recorded gate inputs are not learning evidence. */
import assert from 'node:assert/strict';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { planExperienceTransition, planTrainingTransition, planArtifactTransition, planExperientialActivation,
  createExperientialDeployment, planExperientialSelection, planExperientialDataset, planExperientialEvaluation, createExperientialEvaluation,
  type ExperientialStore, type ExperientialStoreResult, type ExperientialWrite, type ExperientialArtifact, type ExperientialDataset,
  type ExperientialActivationPlan, type ExperientialMemoryState, type ExperientialPersistence } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { selectionFixture } from './selection-fixtures.ts';
import { datasetOptions } from './dataset-fixtures.ts';
import { passingGateMetrics } from './gate-fixtures.ts';

export const EXPERIENTIAL_FIXTURE_TIME = '2026-09-13T00:00:00.000Z';
export interface ExperientialProbeHost {
  store: ExperientialStore;
  peer: ExperientialStore;
  persistence: ExperientialPersistence;
  failAt: string | null;
  failOccurrence: number;
  state(): Promise<ExperientialMemoryState>;
  reopen(): Promise<void>;
  close(): Promise<void>;
}
export type ExperientialStep = <T>(run: () => Promise<ExperientialStoreResult<T>>) => Promise<T>;
const direct: ExperientialStep = async run => accepted(await run());

export async function stagedCandidateFixture(store: ExperientialStore, dataset: ExperientialDataset, base: ExperientialArtifact,
  label: string, step: ExperientialStep = direct) {
  let training = await addressedFixture('trainingRun', { datasetId: dataset.id, baseArtifactId: base.id,
    idempotencyKey: await canonicalSha256({ fixture: 'synthetic-state-conformance', label }) });
  await step(() => store.put('training_runs', training));
  for (const next of ['preparing', 'training', 'materializing', 'complete'] as const) {
    const plan = accepted(planTrainingTransition(training, next));
    await step(() => store.transition(plan)); training = plan.after;
  }
  let artifact = await addressedFixture('artifact', { trainingRunId: training.id, baseArtifactId: base.id,
    runtime: { ...base.runtime, servedModel: 'fixture-' + label },
    checksum: await canonicalSha256({ format: 'synthetic-state-conformance', label }), storageUri: 'memory:fixture/' + label });
  await step(() => store.put('artifacts', artifact));
  return { artifact, training };
}

export async function candidateFixture(store: ExperientialStore, dataset: ExperientialDataset, base: ExperientialArtifact,
  label: string, step: ExperientialStep = direct) {
  const staged = await stagedCandidateFixture(store, dataset, base, label, step);
  let artifact = staged.artifact; const training = staged.training;
  const policy = await addressedFixture('gatePolicy'); await step(() => store.put('gate_policies', policy));
  const head = await step(() => store.head('fixture-profile', artifact.scope));
  const baseline = head.head.versionId ? accepted(await store.get('artifacts', head.head.versionId))! : base;
  const evaluating = accepted(await planExperientialEvaluation({ artifact, baseline, dataset, policy, head,
    evaluatorRevision: await canonicalSha256({ fixture: 'recorded-gate-conformance/v1' }),
    questionSetId: await canonicalSha256({ fixture: 'recorded-gate-conformance-questions/v1' }), sampleCount: 32, recordedAt: EXPERIENTIAL_FIXTURE_TIME }));
  await step(() => store.startEvaluation(evaluating));
  const evaluation = accepted(await createExperientialEvaluation({ registration: evaluating.registration, policy,
    measurements: passingGateMetrics(policy, artifact.sizeBytes), reportId: await canonicalSha256({ fixture: 'recorded-gate-conformance', label }), recordedAt: EXPERIENTIAL_FIXTURE_TIME }));
  const approved = await step(() => store.recordEvaluation(evaluation)); artifact = approved.after;
  return { artifact, evaluation, training, policy, evaluating };
}

export async function experientialStoreFixture(store: ExperientialStore, step: ExperientialStep = direct,
  options: { firstAction: 'activate' | 'canary' } = { firstAction: 'activate' }) {
  const base = await addressedFixture('artifact', { kind: 'base', method: null, baseArtifactId: null, trainingRunId: null,
    checksum: await canonicalSha256({ fixture: 'synthetic-base' }), storageUri: 'memory:fixture/base',
    runtime: { provider: 'fixture', base: 'https://inference.example.test/v1', servedModel: 'fixture-base' } });
  await step(() => store.put('artifacts', base));
  const inputs = await selectionFixture(1, 'fixture');
  const observed = inputs.experiences[0]; await step(() => store.put('experiences', observed));
  const assessment = inputs.assessments[0];
  await step(() => store.put('assessments', assessment));
  const eligible = accepted(planExperienceTransition(observed, 'eligible')); await step(() => store.transition(eligible));
  const selected = accepted(planExperienceTransition(eligible.after, 'selected')); await step(() => store.transition(selected));
  const experience = selected.after;
  const selection = accepted(await planExperientialSelection({ ...inputs, experiences: [experience] }));
  const { dataset } = accepted(await planExperientialDataset(selection, datasetOptions()));
  await step(() => store.put('datasets', dataset));
  const candidate = await candidateFixture(store, dataset, base, 'first', step);
  const deploymentInput = { scope: base.scope, candidateId: 'fixture-base', baseArtifact: base, recordedAt: EXPERIENTIAL_FIXTURE_TIME,
    operationalLimits: { maxFailureRate: 0.1, maxP95Ms: 200, window: 20 } };
  const deployment = accepted(await createExperientialDeployment({ ...deploymentInput, profile: 'fixture-base-preview' }));
  const servingDeployment = accepted(await createExperientialDeployment({ ...deploymentInput, profile: 'fixture-profile' }));
  await step(() => store.put('deployments', servingDeployment));
  await step(() => store.put('deployments', deployment));
  const pin = await addressedFixture('inferencePin', { deploymentId: deployment.id, servedModel: base.runtime.servedModel });
  await step(() => store.pin(pin));
  const retention = await addressedFixture('retentionDecision', { dependentArtifactId: candidate.artifact.id });
  await step(() => store.put('retention_decisions', retention));
  const head = await step(() => store.head('fixture-profile', 'fixture'));
  const approval = await addressedFixture('approval', { artifactId: candidate.artifact.id, evaluationId: candidate.evaluation.id, expectedHead: head.head,
    deploymentId: servingDeployment.id, expectedDeploymentRevision: servingDeployment.revision,
    action: options.firstAction, rolloutFraction: options.firstAction === 'canary' ? 1 : null });
  await step(() => store.put('approvals', approval));
  const plan = accepted(planExperientialActivation({ head, deployment: servingDeployment, artifact: candidate.artifact, evaluation: candidate.evaluation, approval }));
  const active = await step(() => store.activate(plan));
  assert.equal(active.head.versionId, options.firstAction === 'canary' ? null : candidate.artifact.id);
  return { base, observed, experience, assessment, dataset, ...candidate, deployment, servingDeployment: plan.nextDeployment, pin, retention, approval, plan, active };
}

export async function pendingActivation(store: ExperientialStore, fixture: Awaited<ReturnType<typeof experientialStoreFixture>>, label: string): Promise<ExperientialActivationPlan> {
  const candidate = await candidateFixture(store, fixture.dataset, fixture.base, label);
  const head = accepted(await store.head('fixture-profile', 'fixture'));
  const deployment = accepted(await store.get('deployments', fixture.servingDeployment.id))!;
  const approval = await addressedFixture('approval', { artifactId: candidate.artifact.id, evaluationId: candidate.evaluation.id, expectedHead: head.head,
    deploymentId: deployment.id, expectedDeploymentRevision: deployment.revision,
    principal: { ...fixture.approval.principal, id: 'fixture-operator-' + label } });
  accepted(await store.put('approvals', approval));
  return accepted(planExperientialActivation({ head, deployment, artifact: candidate.artifact, evaluation: candidate.evaluation, approval }));
}

export async function replayImmutableState(store: ExperientialStore, state: ExperientialMemoryState) {
  let writes = 0;
  const records = Object.entries(state).flatMap(([table, rows]) => rows.map(value => ({ table, value }))) as ExperientialWrite[];
  // Existing lifecycle records replay byte-for-byte; no admission or transition
  // is inferred from a new row already claiming one of these states.
  for (const row of records) { const result = await store.put(row.table, row.value); assert.equal(result.ok, true, JSON.stringify(result)); if (result.ok) writes += result.writes; }
  assert.equal(writes, 0); return records.length;
}
