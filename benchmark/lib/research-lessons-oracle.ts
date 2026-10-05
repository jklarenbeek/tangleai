/** Independent authored controls exercise existing evidence, compiler and outcome boundaries. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { validateClaimEvidence } from '@tangleai/context';
import { eligibilityIssues, EMPTY_HEAD, DEFAULT_OUTCOME_POLICY, type ArtifactVersion,
  type Evaluation, type EvaluationRegistration, type CaseResult } from '@tangleai/outcomes';
import { createExactMatchAdapter } from '@tangleai/outcomes/adapters/exact-match';
import { compilePatch, applyCompiled, draftsOf, sealSkillBundle, type SkillPatch, type SkillSnapshot } from '@tangleai/trace2skill';
import { validateResearchShape } from '@tangleai/research';
import type { LoadedLessonFixture, LessonNegativeBundle } from './research-lessons-fixture.ts';

const same = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
const at = '2026-01-01T00:00:00.000Z';
const category = (value: number): CaseResult['category'] => value === 1 ? 'success' : value === .5 ? 'partial' : 'failure';
export interface LessonOracleRefusal { code: string | null; cause: string | null; issues: string[] }

/** These are synthetic utility controls, not a persisted activation or a learned adapter. */
export async function lessonOracleEligibility(candidate: readonly number[], baseline: readonly number[], domains: readonly string[]) {
  if (candidate.length !== baseline.length || candidate.length !== domains.length || candidate.length === 0
    || [...candidate, ...baseline].some(value => ![0, .5, 1].includes(value))) throw TypeError('Invalid authored utility control.');
  const hash = await canonicalSha256({ document: 'research-lesson-outcome-control', candidate, baseline, domains });
  const adapter = await createExactMatchAdapter();
  const common = { schemaVersion: 1 as const, scopeId: hash, artifactKey: 'research-lesson-oracle', recordedAt: at };
  const version: ArtifactVersion = { ...common, id: hash, kind: 'artifactVersion', parentVersionId: null,
    payload: adapter.staticPayload, payloadSchema: adapter.identity.artifactSchema,
    adapter: adapter.identity, reflectionId: hash, mode: 'create', policyId: hash,
    policy: { ...DEFAULT_OUTCOME_POLICY }, issues: [], expectedHead: { ...EMPTY_HEAD } };
  const registration: EvaluationRegistration = { ...common, id: hash, kind: 'evaluationRegistration', slotId: 'authored-control',
    versionId: hash, expectedHead: { ...EMPTY_HEAD }, trainingScoreIds: [hash], evaluatorRevision: hash,
    gatePolicyId: hash, maxPhysicalRequests: 0, maxCost: 0,
    cases: await Promise.all(candidate.map(async (_value, i) => {
      const source = { sourceId: 'truth-' + i, scopeId: hash, subject: 'authored-control', issuer: 'authored-evaluator',
        observedAt: at, decisionId: null, payload: { category: category(candidate[i]) } };
      return { id: 'case-' + i, domain: domains[i], input: { token: 'case-' + i }, source: { ...source, digest: await canonicalSha256(source) } };
    })) };
  const caseResults: CaseResult[] = await Promise.all(candidate.map(async (utility, i) => ({ id: 'case-' + i,
    contentDigest: await canonicalSha256(registration.cases[i]), output: { label: category(utility) },
    baselineOutput: { label: category(baseline[i]) }, category: category(utility), baselineCategory: category(baseline[i]),
    utility, baselineUtility: baseline[i] })));
  const evaluation: Evaluation = { ...common, id: hash, kind: 'evaluation', versionId: hash, registrationId: hash,
    expectedHead: { ...EMPTY_HEAD }, trainingScoreIds: [hash], caseResults, caseReportId: await canonicalSha256(caseResults),
    evaluatorRevision: hash, gatePolicyId: hash, eligible: false, issues: [],
    meanDelta: caseResults.reduce((sum, row) => sum + row.utility - row.baselineUtility, 0) / caseResults.length,
    physicalRequests: 0, cost: 0 };
  return eligibilityIssues(evaluation, registration, version);
}

export async function probeResearchLessonNegative(fixture: LoadedLessonFixture, negative: LessonNegativeBundle): Promise<LessonOracleRefusal> {
  const lesson = negative.lesson, fail = (code: string, cause: string | null = null, issues: string[] = []): LessonOracleRefusal => ({ code, cause, issues });
  if (!validateResearchShape('ResearchLessonV2', lesson).valid) return fail('TRSH2001');
  const { id, revision, ...body } = lesson;
  if (id !== revision || revision !== await canonicalSha256(body)) return fail('TRSH2001');
  if (!same(lesson.scope, fixture.registration.scope)) return fail('TRSH2003');
  const evidence = validateClaimEvidence(lesson.origin.envelope,
    { artifacts: negative.admittedOrigin ? fixture.beneficial.origin.envelope.artifacts : [] });
  if (!evidence.valid) return fail('TRSH2002', evidence.errors[0]?.code ?? 'EVIDENCE_INVALID');
  if (lesson.origin.kind === 'retrieved-web' && !lesson.corroboration?.originIds.length) return fail('TRSH2006');
  if (fixture.registration.topics.some(topic => lesson.origin.topicIds.includes(topic.id)
    || lesson.origin.topicContentHashes.includes(topic.sha256))) return fail('TRSH2005');
  if (negative.activeBundleHash !== lesson.proposal.baseHash) return fail('TRSH2007');
  if (negative.asyncValidator) {
    const guarded = createGuardedRefiner({ read: async () => ({}), apply: value => value,
      validateProposal: async () => true, validateCandidate: () => true, planCommit: value => value, commit: async () => true });
    const prepared = guarded.prepare({}, {});
    if (prepared.valid) throw Error('The native synchronous guarded boundary accepted a thenable.');
    const error = prepared.errors[0];
    return fail('TRSH2004', error?.code ?? null, [error?.message ?? 'Native asynchronous-validator refusal omitted a reason.']);
  }
  // The minority domain makes positive aggregate transfer insufficient for the volatile control.
  const issues = await lessonOracleEligibility(negative.candidateUtilities, negative.baselineUtilities, ['majority', 'majority', 'minority']);
  return issues.length ? fail('TRSH2007', issues[0].code, issues.map(issue => issue.detail)) : { code: null, cause: null, issues: [] };
}

/** Compile and seal with the skill owner; this analytic ceiling earns no activation authority. */
export async function compileResearchLessonOracle(fixture: LoadedLessonFixture): Promise<SkillSnapshot> {
  const lesson = fixture.beneficial;
  const body: Omit<SkillPatch, 'id'> = { runId: await canonicalSha256({ oracle: fixture.registration.revision, origin: lesson.origin.runId }), baseHash: lesson.proposal.baseHash,
    sourceRolloutIds: [], sourcePatchIds: [], supportCount: 1, ...lesson.proposal.edit,
    changelog: [], validation: { state: 'compiled', issues: [] } };
  const patch: SkillPatch = { id: await canonicalSha256(body), ...body };
  const frozen = { bundle: fixture.procedure.bundle, files: draftsOf(fixture.procedure.files) };
  const compiled = compilePatch(frozen, patch, { forbidden: fixture.registration.topics.map(topic => topic.id) });
  if (!compiled.valid) throw Error('Lesson oracle compilation refused: ' + JSON.stringify(compiled.issues));
  const applied = applyCompiled(frozen.files, compiled.value);
  if (!applied.valid) throw Error('Lesson oracle application refused: ' + JSON.stringify(applied.issues));
  const sealed = await sealSkillBundle(applied.value, { scopeKey: frozen.bundle.scopeKey, mode: frozen.bundle.mode,
    parentId: frozen.bundle.id, origin: 'evolved', status: 'staged' });
  if (!sealed.valid) throw Error('Lesson oracle sealing refused: ' + JSON.stringify(sealed.issues));
  return sealed.value;
}
