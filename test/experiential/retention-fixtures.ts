import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createExperientialDeployment, planExperienceTransition, planExperientialSelection, planExperientialDataset,
  planExperientialEvaluation, createExperientialEvaluation, sealExperientialRetentionPolicy,
  type ExperientialStore, type ExperientialRetentionPolicy } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { selectionFixture, SELECTION_TIME } from './selection-fixtures.ts';
import { datasetOptions } from './dataset-fixtures.ts';
import { stagedCandidateFixture } from './store-fixtures.ts';
import { passingGateMetrics } from './gate-fixtures.ts';

export async function retentionFixture(store: ExperientialStore) {
  const input = await selectionFixture(1, 'fixture'), observed = input.experiences[0];
  const assessment = await addressedFixture('assessment', { ...input.assessments[0],
    supportingIds: [input.assessments[0].supportingIds[0], observed.inputRef.digest] });
  input.assessments = [assessment]; input.approvals[0].assessmentId = assessment.id;
  accepted(await store.put('experiences', observed)); accepted(await store.put('assessments', assessment));
  const eligible = accepted(planExperienceTransition(observed, 'eligible')); accepted(await store.transition(eligible));
  const selected = accepted(planExperienceTransition(eligible.after, 'selected')); accepted(await store.transition(selected));
  input.experiences = [selected.after];
  const selection = accepted(await planExperientialSelection(input));
  const { dataset } = accepted(await planExperientialDataset(selection, datasetOptions())); accepted(await store.put('datasets', dataset));
  const base = await addressedFixture('artifact', { kind: 'base', method: null, trainingRunId: null, baseArtifactId: null,
    runtime: { provider: 'fixture', base: 'https://inference.example.test/v1', servedModel: 'fixture-base' } });
  accepted(await store.put('artifacts', base));
  const deployment = accepted(await createExperientialDeployment({ profile: 'fixture-profile', scope: 'fixture', candidateId: 'fixture-base',
    baseArtifact: base, recordedAt: SELECTION_TIME, operationalLimits: { maxFailureRate: 0, maxP95Ms: 10, window: 10 } }));
  accepted(await store.put('deployments', deployment));
  const staged = await stagedCandidateFixture(store, dataset, base, 'retained-rejected-source');
  const gates = await addressedFixture('gatePolicy'); accepted(await store.put('gate_policies', gates));
  const head = accepted(await store.head('fixture-profile', 'fixture'));
  const registration = accepted(await planExperientialEvaluation({ artifact: staged.artifact, baseline: base, dataset, policy: gates, head,
    evaluatorRevision: await canonicalSha256('retention-conformance'), questionSetId: await canonicalSha256('retention-conformance-questions'),
    sampleCount: 32, recordedAt: SELECTION_TIME }));
  accepted(await store.startEvaluation(registration));
  const measurements = passingGateMetrics(gates, staged.artifact.sizeBytes); measurements.interval[0].low = 0;
  const evaluation = accepted(await createExperientialEvaluation({ registration: registration.registration, policy: gates, measurements,
    reportId: await canonicalSha256('retention-recorded-refusal'), recordedAt: SELECTION_TIME }));
  const rejected = accepted(await store.recordEvaluation(evaluation));
  const principal = { kind: 'operator' as const, id: 'retention-fixture', authorityId: 'a'.repeat(64) };
  const policy = async (changes: Partial<Omit<ExperientialRetentionPolicy, 'revision'>> = {}) => accepted(await sealExperientialRetentionPolicy({
    decision: 'archive', rollbackWindowMs: 1000, holds: [], reason: 'Retain the source while excluding it from future selection.',
    principal, evidence: selected.after.sourceRefs, ...changes }));
  const snapshot = async (p?: ExperientialRetentionPolicy) => ({ episodeIds: [selected.after.sourceRefs[0].sourceId], deployment,
    artifacts: accepted(await store.list('artifacts', 'fixture')), now: Date.parse(SELECTION_TIME), policy: p ?? await policy(),
    lineage: { experiences: accepted(await store.list('experiences', 'fixture')), assessments: accepted(await store.list('assessments', 'fixture')),
      datasets: accepted(await store.list('datasets', 'fixture')), trainingRuns: accepted(await store.list('training_runs', 'fixture')),
      events: accepted(await store.list('events', 'fixture')) } });
  return { deployment, base, dataset, assessment, experience: selected.after, artifact: rejected.after, input, policy, snapshot };
}
