/** Structural fixtures only; these placeholder addresses confer no provenance. */
import type { ExperientialRecordMap } from '@tangleai/experiential';

const id = (n: number) => n.toString(16).padStart(64, '0');
const common = { schemaVersion: 1 as const, id: id(1), scope: 'fixture', recordedAt: '2026-09-13T00:00:00.000Z' };
const source = { sourceId: 'episode-a', digest: id(2), kind: 'episode' };
const principal = { id: 'fixture-operator', kind: 'operator' as const, authorityId: id(3) };
const head = { versionId: null, revision: 0 };

export function experientialSchemaFixtures(): ExperientialRecordMap {
  return {
    experience: { ...common, document: 'experiential-experience', taskRef: source, inputRef: source, outputRef: source,
      observedOutcome: { kind: 'outcome', sourceId: 'independent-evaluation', digest: id(4), value: 1 },
      sourceRefs: [source], producingIdentityId: id(5), trust: 'verified', privacy: 'internal', state: 'observed', contentDigest: id(6) },
    assessment: { ...common, document: 'experiential-assessment', experienceId: id(7),
      author: { kind: 'operator', principalId: principal.id }, policyRevision: id(8), generalizable: true,
      rationale: 'The independently checked outcome supports review.', duplicateOf: null, contradiction: 'none',
      trustDecision: 'verified', inclusion: 'include', reason: 'independent-outcome', supportingIds: [id(4)] },
    dataset: { ...common, document: 'experiential-dataset', selectedIds: [id(7)], assessmentIds: [id(23)],
      splits: { train: [id(7)], validation: [], compositionalHoldout: [], replay: [] },
      groupKeys: [{ experienceId: id(7), sourceEpisodeId: 'episode-a', duplicateFamilyId: id(9) }],
      seed: 17753, templateRevision: id(10), tokenizerIdentity: 'fixture-tokenizer/v1', chatTemplateIdentity: 'fixture-chat/v1',
      manifestDigest: id(11), exclusions: { total: 0, byReason: {} } },
    trainingRun: { ...common, document: 'experiential-training-run', idempotencyKey: id(12), datasetId: id(13), baseArtifactId: id(14),
      method: 'lora', hyperparameters: { learningRate: 0.001, epochs: 1, rank: 8, alpha: 16 },
      backendIdentity: { id: 'fixture-backend', version: '1', kind: 'fake' },
      budget: { maxRecords: 1024, maxBytes: 65536, maxWallMs: 10000, maxPolls: 8, maxSpend: null },
      state: 'queued', startedAt: null, finishedAt: null, logRefs: [], metricsRef: null, stopReason: null, submissions: 0 },
    artifact: { ...common, document: 'experiential-artifact', checksum: id(15), baseArtifactId: id(14), kind: 'adapter', method: 'lora',
      storageUri: 'https://artifacts.example.test/adapter', runtime: { servedModel: 'fixture-adapter', provider: 'fixture', base: 'https://inference.example.test/v1' },
      trainingRunId: id(16), state: 'staged', sizeBytes: 1024 },
    evaluation: { ...common, document: 'experiential-evaluation', artifactId: id(17), baselineArtifactId: id(14), gatePolicyId: id(18),
      reportId: id(19), passed: false, failures: [{ gate: 'learning', detail: 'No candidate evaluation has run.', observed: null, tolerance: 0 }],
      rows: [], interval: [], cost: null },
    gatePolicy: { ...common, document: 'experiential-gate-policy', primaryMetric: 'cgc', controls: ['frozen-retrieval', 'frozen-distilled-rule'],
      interval: { statistic: 'paired-bootstrap', level: 0.95, resamples: 1000, seed: 17753 }, learning: { minLowerBound: 0 },
      retention: { cgtReplayMaxDrop: 0, baseReplayMaxDrop: 0, locomoRecallMaxDrop: 0, locomoQaMaxDrop: 0 },
      security: { fixtures: ['poisoned-tool-output'], requiredOutcome: 'refused-or-unchanged' },
      operations: { maxArtifactBytes: 4096, maxTrainingMs: 10000, maxInferenceP95Ms: 100, maxFailureRate: 0, maxCost: null, runtimeProviders: ['fixture'] },
      rows: ['frozen-none', 'frozen-retrieval', 'frozen-distilled-rule', 'active-artifact-no-retrieval', 'candidate-no-retrieval'],
      requiredRows: ['frozen-none', 'frozen-retrieval', 'frozen-distilled-rule', 'active-artifact-no-retrieval', 'candidate-no-retrieval'] },
    approval: { ...common, document: 'experiential-approval', profile: 'fixture-profile', action: 'activate', artifactId: id(17),
      evaluationId: id(20), expectedHead: head, principal, reason: 'Operator reviewed the independent evidence.' },
    deployment: { ...common, document: 'experiential-deployment', profile: 'fixture-profile',
      base: { candidateId: 'fixture-base', provider: 'fixture', base: 'https://inference.example.test/v1', model: 'fixture-base', digest: id(21) },
      activeArtifactId: null, canaryArtifactId: null, rolloutFraction: 0, expectedParentArtifactId: null, approvalId: null, revision: 0 },
    inferencePin: { ...common, document: 'experiential-inference-pin', runId: 'fixture-run', identityId: id(5), deploymentId: id(22),
      deploymentRevision: 0, artifactId: null, servedModel: 'fixture-base', canary: false },
    retentionDecision: { ...common, document: 'experiential-retention-decision', episodeIds: ['episode-a'], dependentArtifactId: id(17),
      rollbackUntil: null, decision: 'keep', reason: 'The active lineage requires its source.', principal, evidence: [source] },
    event: { ...common, document: 'experiential-event', seq: 1, kind: 'experience-observed', recordId: id(7), runId: null, detail: 'Source observation retained.' },
    head: { ...common, document: 'experiential-head', profile: 'fixture-profile', head, eventId: null },
  };
}
