/** Synthetic persistence conformance. Evaluation shells are not learning evidence. */
import assert from 'node:assert/strict';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { planExperienceTransition, planTrainingTransition, planArtifactTransition, planExperientialActivation,
  planExperientialSelection, planExperientialDataset,
  type ExperientialStore, type ExperientialStoreResult, type ExperientialWrite, type ExperientialArtifact, type ExperientialDataset,
  type ExperientialActivationPlan, type ExperientialMemoryState, type ExperientialPersistence } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { selectionFixture } from './selection-fixtures.ts';
import { datasetOptions } from './dataset-fixtures.ts';

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

export async function candidateFixture(store: ExperientialStore, dataset: ExperientialDataset, base: ExperientialArtifact,
  label: string, step: ExperientialStep = direct) {
  let training = await addressedFixture('trainingRun', { datasetId: dataset.id, baseArtifactId: base.id,
    idempotencyKey: await canonicalSha256({ fixture: 'synthetic-state-conformance', label }) });
  await step(() => store.put('training_runs', training));
  for (const next of ['preparing', 'training', 'materializing', 'complete'] as const) {
    const plan = accepted(planTrainingTransition(training, next));
    await step(() => store.transition(plan)); training = plan.after;
  }
  let artifact = await addressedFixture('artifact', { trainingRunId: training.id, baseArtifactId: base.id,
    checksum: await canonicalSha256({ format: 'synthetic-state-conformance', label }), storageUri: 'memory:fixture/' + label });
  await step(() => store.put('artifacts', artifact));
  const evaluating = accepted(planArtifactTransition(artifact, 'evaluating'));
  await step(() => store.transition(evaluating)); artifact = evaluating.after;
  const policy = await addressedFixture('gatePolicy'); await step(() => store.put('gate_policies', policy));
  const evaluation = await addressedFixture('evaluation', { artifactId: artifact.id, baselineArtifactId: base.id, gatePolicyId: policy.id,
    reportId: await canonicalSha256({ fixture: 'synthetic-evaluation-shell', label }), passed: true, failures: [], rows: [], interval: [] });
  await step(() => store.put('evaluations', evaluation));
  const approved = accepted(planArtifactTransition(artifact, 'approved'));
  await step(() => store.transition(approved, { evaluationId: evaluation.id })); artifact = approved.after;
  return { artifact, evaluation, training, policy };
}

export async function experientialStoreFixture(store: ExperientialStore, step: ExperientialStep = direct) {
  const base = await addressedFixture('artifact', { kind: 'base', method: null, baseArtifactId: null, trainingRunId: null,
    checksum: await canonicalSha256({ fixture: 'synthetic-base' }), storageUri: 'memory:fixture/base',
    runtime: { provider: 'fixture', base: 'memory:fixture/inference', servedModel: 'fixture-base' } });
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
  const deployment = await addressedFixture('deployment', { profile: 'fixture-base-preview', base: {
    candidateId: 'fixture-base', provider: base.runtime.provider, base: base.runtime.base, model: base.runtime.servedModel, digest: base.checksum } });
  await step(() => store.put('deployments', deployment));
  const pin = await addressedFixture('inferencePin', { deploymentId: deployment.id, servedModel: base.runtime.servedModel });
  await step(() => store.put('pins', pin));
  const retention = await addressedFixture('retentionDecision', { dependentArtifactId: candidate.artifact.id });
  await step(() => store.put('retention_decisions', retention));
  const head = await step(() => store.head('fixture-profile', 'fixture'));
  const approval = await addressedFixture('approval', { artifactId: candidate.artifact.id, evaluationId: candidate.evaluation.id, expectedHead: head.head });
  await step(() => store.put('approvals', approval));
  const plan = accepted(planExperientialActivation({ head, artifact: candidate.artifact, evaluation: candidate.evaluation, approval }));
  const active = await step(() => store.activate(plan));
  assert.equal(active.head.versionId, candidate.artifact.id);
  return { base, observed, experience, assessment, dataset, ...candidate, deployment, pin, retention, approval, plan, active };
}

export async function pendingActivation(store: ExperientialStore, fixture: Awaited<ReturnType<typeof experientialStoreFixture>>, label: string): Promise<ExperientialActivationPlan> {
  const candidate = await candidateFixture(store, fixture.dataset, fixture.base, label);
  const head = accepted(await store.head('fixture-profile', 'fixture'));
  const approval = await addressedFixture('approval', { artifactId: candidate.artifact.id, evaluationId: candidate.evaluation.id, expectedHead: head.head,
    principal: { ...fixture.approval.principal, id: 'fixture-operator-' + label } });
  accepted(await store.put('approvals', approval));
  return accepted(planExperientialActivation({ head, artifact: candidate.artifact, evaluation: candidate.evaluation, approval }));
}

export async function replayImmutableState(store: ExperientialStore, state: ExperientialMemoryState) {
  let writes = 0;
  const records = Object.entries(state).flatMap(([table, rows]) => rows.map(value => ({ table, value }))) as ExperientialWrite[];
  // Existing lifecycle records replay byte-for-byte; no admission or transition
  // is inferred from a new row already claiming one of these states.
  for (const row of records) { const result = await store.put(row.table, row.value); assert.equal(result.ok, true, JSON.stringify(result)); if (result.ok) writes += result.writes; }
  assert.equal(writes, 0); return records.length;
}
