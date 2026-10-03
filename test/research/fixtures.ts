import assert from 'node:assert/strict';
import { researchRevisionOf, inputManifestHashOf, stageAttemptIdOf,
  type ResearchProject, type ResearchContract, type ExperimentPlan, type InputManifest,
  type ResearchLifecycle, type StageAttempt, type ResearchOutcome } from '@tangleai/research';

export const hash = (character = 'a') => character.repeat(64);
export function checked<T>(outcome: ResearchOutcome<T>): T {
  assert.equal(outcome.valid, true, JSON.stringify(outcome));
  if (!outcome.valid) throw new Error('Refused fixture');
  return outcome.value;
}
export function project(id = 'fixture-project'): ResearchProject {
  return { id, topic: 'seed initialization', domainProfile: 'computational', question: 'Does the candidate reduce inertia?',
    owner: 'fixture', mode: 'gate-only', safetyClass: 'computational', status: 'CREATED',
    budget: { calls: 10, tokens: 100, ms: 1000, physical: 10 }, createdAt: '2026-10-03T00:00:00.000Z' };
}
export async function frozen(projectId = 'fixture-project', suffix = '', minImprovement = 0) {
  const body: Omit<ResearchContract, 'contractHash'> = {
    id: projectId + '-contract' + suffix, projectId, hypothesisSpace: ['candidate improves over control'],
    successRule: { metric: 'inertia', condition: 'candidate', baseline: 'control', minImprovement, confidenceLevel: 0.95 },
    failureRule: 'stop-on-invalid', metrics: [{ id: 'inertia', direction: 'minimize', unit: 'squared-distance' }],
    datasets: [{ id: 'fixture-data', sha256: hash() }], splits: { train: ['train'], test: ['test'] },
    requiredBaselines: [{ condition: 'control', programId: 'control', source: 'authored fixture',
      licence: { spdx: 'MIT', provenance: 'tangle-authored-synthetic', source: 'fixture' } }],
    replicatePolicy: { seeds: [1, 2], minimum: 2, resamples: 100, bootstrapSeed: 1 },
    attemptCap: 3, pivotCap: 2, reviewCap: 2, selectionRule: { kind: 'all', n: 1, metric: 'inertia' },
    stopConditions: ['budget exhausted'],
  };
  const contract: ResearchContract = { ...body, contractHash: await researchRevisionOf(body) };
  const planBody: Omit<ExperimentPlan, 'planHash'> = { id: projectId + '-plan' + suffix, projectId,
    contractHash: contract.contractHash, hypothesisHash: hash('b'),
    conditions: [{ id: 'control', programId: 'control', datasetId: 'fixture-data', params: { k: 3 } },
      { id: 'candidate', programId: 'candidate', datasetId: 'fixture-data', params: { k: 3 } }],
    inputPaths: ['features.json'], evaluator: { id: 'fixture-evaluator', version: '1' } };
  return { contract, plan: { ...planBody, planHash: await researchRevisionOf(planBody) } satisfies ExperimentPlan };
}
export function manifest(projectId = 'fixture-project', stage: ResearchLifecycle = 'DISCOVERY', artifactIds: string[] = []): InputManifest {
  return { projectId, stage, inputs: artifactIds.map(artifactId => ({ artifactId, sha256: artifactId.slice(4) })),
    promptRevision: hash(), runIdentityId: hash('b'), toolVersions: [{ name: 'fixture', version: '1' }],
    evaluator: { id: 'fixture-evaluator', version: '1' }, reservation: { calls: 1, tokens: 10, ms: 100, physical: 1 } };
}
export async function attempt(input: InputManifest, artifactIds: string[] = [], ordinal = 1): Promise<StageAttempt> {
  const key = { projectId: input.projectId, stage: input.stage, attemptOrdinal: ordinal, inputManifestHash: await inputManifestHashOf(input) };
  return { ...key, id: await stageAttemptIdOf(key), masPath: input.projectId + '/' + input.stage + '/' + ordinal,
    promptRevision: input.promptRevision, runIdentityId: input.runIdentityId, toolVersions: structuredClone(input.toolVersions),
    spend: { calls: 0, tokens: 0, ms: 0, physical: 0 }, stopReason: 'completed', interventions: [],
    outputArtifactIds: artifactIds, error: null, mode: 'scripted' };
}
