/** Frozen, explicitly scripted candidate inputs; no trainer or provider is invoked. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { runIdentitySchema } from '@tangleai/config';
import { experientialSchema, sealExperientialRecord, sealExperientialSelectionPolicy, planExperientialSelection,
  planExperientialDataset, EXPERIENTIAL_EXAMPLE_TEMPLATE, experientialArtifactChecksum,
  type ExperientialResult, type ExperientialSelectionInput, type ExperientialArtifact } from '@tangleai/experiential';
import schema from '../schemas/cgt.schema.json' with { type: 'json' };
import { experiencesFromCgt } from './cgt-experiences.ts';
import { createReportValidator } from './validate.ts';
import type { CgtFixture, CgtBaseReplayFixture, CgtSecurityFixtures, CgtCandidateEvaluation } from './cgt.types.ts';

export const CGT_CANDIDATES = ['candidate-memorizer', 'candidate-rule-follower', 'candidate-forgetting', 'candidate-tainted', 'candidate-oversized'] as const;
export type CgtCandidateId = typeof CGT_CANDIDATES[number];
export const CGT_EVALUATION_TIME = '2026-09-13T00:00:00.000Z';
export const CGT_EVALUATION_FIXTURE_FILES = ['benchmark/fixtures/cgt/base-replay.json', 'benchmark/fixtures/cgt/gate-policy.json',
  'benchmark/fixtures/cgt/security.json', ...['prompt-injection', 'poisoned-tool-output', 'cross-scope'].map(name => 'test/fixtures/experiential/selection/' + name + '.json')];
export function requireExperiential<T>(result: ExperientialResult<T>): T {
  if (!result.ok) throw Error('cgt experiential refusal: ' + JSON.stringify(result.issues));
  return result.value;
}
const checkBase = createReportValidator({ ...schema, $ref: '#/$defs/CgtBaseReplayFixture' }, [runIdentitySchema, experientialSchema]);
const checkSecurity = createReportValidator({ ...schema, $ref: '#/$defs/CgtSecurityFixtures' }, [runIdentitySchema, experientialSchema]);

export async function cgtEvaluationFixture(root: string, fixture: CgtFixture) {
  const observations = await experiencesFromCgt(fixture, fixture.sessions.length, CGT_EVALUATION_TIME);
  const policy = requireExperiential(await sealExperientialRecord('gatePolicy', JSON.parse(await readFile(join(root, 'benchmark/fixtures/cgt/gate-policy.json'), 'utf8'))));
  if (policy.scope !== fixture.manifest.scope) throw Error('cgt gate policy: scope mismatch');
  const selectionPolicy = requireExperiential(await sealExperientialSelectionPolicy({ scope: fixture.manifest.scope, minimumSupport: 1,
    requireIndependentOutcome: true, allowedTrust: ['verified', 'operator'], allowedPrivacy: ['public', 'internal'],
    requireGeneralizable: true, requireApproval: true, principalKinds: ['operator', 'policy'] }));
  const assessments = [], approvals: Array<ExperientialSelectionInput['approvals'][number]> = [];
  for (const experience of observations.experiences) {
    const assessment = requireExperiential(await sealExperientialRecord('assessment', { document: 'experiential-assessment', schemaVersion: 1,
      scope: experience.scope, recordedAt: CGT_EVALUATION_TIME, experienceId: experience.id, author: { kind: 'policy', principalId: 'cgt-fixture-review' },
      policyRevision: selectionPolicy.revision, generalizable: true, rationale: 'Authored observation with an independently registered fixture outcome.',
      duplicateOf: null, contradiction: 'none', trustDecision: 'verified', inclusion: 'include', reason: 'scripted-independent-observation',
      supportingIds: [experience.observedOutcome!.digest] }));
    assessments.push(assessment);
    approvals.push({ action: 'select', scope: experience.scope, experienceId: experience.id, assessmentId: assessment.id,
      policyRevision: selectionPolicy.revision, principal: { kind: 'policy', id: 'cgt-fixture-review', authorityId: await canonicalSha256('cgt-fixture-review/v1') },
      reason: 'Registered scripted selection conformance; no training purchase.' });
  }
  const selection = requireExperiential(await planExperientialSelection({ ...observations, assessments, approvals, policy: selectionPolicy }));
  const datasetPlan = requireExperiential(await planExperientialDataset(selection, { seed: fixture.manifest.seed,
    splitRatios: { validation: 0.2, replay: 0.2 }, groupKeyOf: value => ({ sourceEpisodeId: value.sourceRefs[0].sourceId, duplicateFamilyId: value.contentDigest }),
    holdoutPairsOf: () => [], conceptsOf: value => observations.concepts[value.id], evaluationReferences: observations.evaluationReferences,
    template: EXPERIENTIAL_EXAMPLE_TEMPLATE, tokenizerIdentity: 'cgt-scripted-tokenizer/v1', chatTemplateIdentity: 'cgt-scripted-questions/v1', recordedAt: CGT_EVALUATION_TIME }));
  const baseBytes = new TextEncoder().encode('cgt-scripted-base/v1:' + fixture.fixtureId);
  const baseline = requireExperiential(await sealExperientialRecord('artifact', { document: 'experiential-artifact', schemaVersion: 1,
    scope: fixture.manifest.scope, recordedAt: CGT_EVALUATION_TIME, checksum: await experientialArtifactChecksum(baseBytes),
    baseArtifactId: null, kind: 'base', method: null, storageUri: 'memory:cgt/scripted-base',
    runtime: { servedModel: 'cgt-scripted-base', provider: 'ollama', base: 'http://127.0.0.1:11434/v1' }, trainingRunId: null, state: 'staged', sizeBytes: baseBytes.byteLength }));
  const baseReplay = JSON.parse(await readFile(join(root, 'benchmark/fixtures/cgt/base-replay.json'), 'utf8')) as CgtBaseReplayFixture;
  const security = JSON.parse(await readFile(join(root, 'benchmark/fixtures/cgt/security.json'), 'utf8')) as CgtSecurityFixtures;
  if (!checkBase(baseReplay).valid || !checkSecurity(security).valid || new Set(baseReplay.queries.map(query => query.id)).size !== 12
    || JSON.stringify(security.fixtures.map(value => value.id)) !== JSON.stringify(policy.security.fixtures)) throw Error('cgt evaluation fixture: invalid census');
  const sources = new Map<string, unknown>();
  for (const item of security.fixtures) if (item.source) {
    if (!CGT_EVALUATION_FIXTURE_FILES.includes(item.source)) throw Error('cgt security: unregistered source path');
    sources.set(item.id, JSON.parse(await readFile(join(root, item.source), 'utf8')));
  }
  return { policy, dataset: datasetPlan.dataset, observations, baseline, baseReplay, security, sources };
}
export type CgtEvaluationFixture = Awaited<ReturnType<typeof cgtEvaluationFixture>>;

export async function cgtCandidateArtifact(candidateId: CgtCandidateId, fixture: CgtFixture, baseline: ExperientialArtifact): Promise<ExperientialArtifact> {
  const content = 'cgt-scripted-candidate/v1:' + candidateId + ':' + fixture.fixtureId;
  const bytes = new TextEncoder().encode(candidateId === 'candidate-oversized' ? content.padEnd(4097, '.') : content);
  return requireExperiential(await sealExperientialRecord('artifact', { document: 'experiential-artifact', schemaVersion: 1,
    scope: fixture.manifest.scope, recordedAt: CGT_EVALUATION_TIME, checksum: await experientialArtifactChecksum(bytes),
    baseArtifactId: baseline.id, kind: 'adapter', method: 'lora', storageUri: 'memory:cgt/' + candidateId,
    runtime: { ...baseline.runtime, servedModel: candidateId }, trainingRunId: await canonicalSha256({ fixture: 'scripted-training-placeholder', candidateId }),
    state: 'staged', sizeBytes: bytes.byteLength }));
}

export function cgtBaseReplayAnswer(query: CgtBaseReplayFixture['queries'][number]): string {
  switch (query.operation) {
    case 'upper': return query.input.toUpperCase();
    case 'lower': return query.input.toLowerCase();
    case 'reverse': return [...query.input].reverse().join('');
    case 'length': return String([...query.input].length);
  }
}
export const cgtGateMechanismsMeasured = (evaluations: readonly CgtCandidateEvaluation[]): boolean =>
  evaluations.length === CGT_CANDIDATES.length && evaluations.every((value, index) => value.candidateId === CGT_CANDIDATES[index]
    && value.evidence.retrieval.validationRetrievable === 0 && value.evaluation.rows.length === 5)
  && ([['candidate-memorizer', 'learning'], ['candidate-forgetting', 'retention'], ['candidate-tainted', 'security'], ['candidate-oversized', 'operations']] as const)
    .every(([id, family]) => evaluations.find(value => value.candidateId === id)?.evaluation.failures.some(failure => failure.gate === family) === true);
