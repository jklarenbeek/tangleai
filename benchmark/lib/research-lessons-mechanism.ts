/** Measured rows retain native provenance and never substitute oracle truth for a candidate. */
import { composeSkillSystem, skillReadTool, draftsOf, sealSkillBundle, type SkillSnapshot } from '@tangleai/trace2skill';
import { createMemoryOutcomeStore } from '@tangleai/outcomes';
import { createMemoryResearchPersistence, createResearchStoreAdapter, createLessonRefiner, injectLessons, lessonDecayWeight,
  lessonInputHash, lessonScopeKey, planProjectCreate, researchValue, researchRevisionOf, researchIssue, sealResearchLesson, sealLessonValidationRun,
  type ResearchCode,
  type LessonSpend, type LessonValidationRow, type ResearchIssue, type ResearchLessonV2, type ResearchStore } from '@tangleai/research';
import { LESSON_FIXTURE_TIME, LESSON_FIXTURE_TRUTH, zeroLessonSpend, materializeLessonCorrection, proposeFixtureLesson,
  lessonOutcomeHost } from '../../apps/research-runner/src/lessons.ts';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { LoadedLessonFixture } from './research-lessons-fixture.ts';
import type { LessonTopicMeasurement, LessonNativeMeasurement, LessonCounts } from './research-lessons.types.ts';

export type LessonTopicRunner = (snapshot: SkillSnapshot) => Promise<LessonTopicMeasurement[]>;
export async function researchLessonFixtureProcedure(fixture: LoadedLessonFixture): Promise<SkillSnapshot> {
  const result = await sealSkillBundle(draftsOf(fixture.procedure.files), { ...fixture.procedure.bundle,
    scopeKey: lessonScopeKey(fixture.registration.scope) });
  if (!result.valid) throw Error('The native scoped procedure refused: ' + JSON.stringify(result.issues));
  return result.value;
}
export const sumLessonSpend = (...rows: LessonSpend[]): LessonSpend => rows.reduce((sum, row) => ({
  calls: sum.calls + row.calls, tokens: sum.tokens + row.tokens, physical: sum.physical + row.physical,
  replayed: sum.replayed + row.replayed, ms: sum.ms + row.ms,
  cost: sum.cost === null || row.cost === null ? null : sum.cost + row.cost,
}), { ...zeroLessonSpend(), cost: 0 } as LessonSpend);
export function nativeLessonMeasurement(fixtureKind: LessonNativeMeasurement['fixtureKind']): LessonNativeMeasurement {
  return { fixtureKind, phase: 'proposal', proposalIds: [], stagedIds: [], validatedIds: [], candidateBundleHash: null,
    candidateSetHash: null, validationRun: null, versionId: null, evaluationId: null, activationEventId: null,
    injections: [], code: null, cause: null, issues: [], matched: false, proposerSpend: zeroLessonSpend(), validationSpend: zeroLessonSpend(),
    decay: [], procedureReads: [] };
}
export function nativeLessonCounts(native: LessonNativeMeasurement): LessonCounts {
  return { proposed: native.proposalIds.length, staged: native.stagedIds.length, validated: native.validatedIds.length,
    rejected: Number(native.code !== null), promoted: native.activationEventId ? native.validatedIds.length : 0,
    rolledBack: 0, expired: native.decay.filter(row => row.weight === 0).length ? 1 : 0,
    uncorroborated: Number(native.code === 'TRSH2006'), leaked: Number(native.code === 'TRSH2005') };
}
export function nativeLessonRefusal(native: LessonNativeMeasurement, issue: ResearchIssue, expected?: string) {
  issue = researchIssue(issue.code as ResearchCode, issue.path, issue.detail, issue.cause);
  native.code = issue.code; native.cause = issue.cause?.code ?? null; native.issues.push(issue);
  native.matched = expected !== undefined && issue.code === expected;
}
export async function retainLessonValidation(options: { store: ResearchStore; lesson: ResearchLessonV2; snapshot: SkillSnapshot;
  registrationId: string; rows: LessonValidationRow[] }) {
  const { store, lesson, snapshot, rows, registrationId } = options;
  researchValue(await store.lessons.putProcedure(snapshot));
  const lessonSetHash = await researchRevisionOf({ bundleHash: snapshot.bundle.id, lessonIds: [lesson.id],
    decayHypothesisId: lesson.decay.hypothesisId, rows: Object.fromEntries(rows.map(row => [row.inputHash, row.output])) });
  const revision = await researchRevisionOf({ evaluator: 'registered-research-validity/v1', registrationId });
  const run = researchValue(await sealLessonValidationRun({ scope: lesson.scope, baseBundleHash: lesson.proposal.baseHash,
    bundleHash: snapshot.bundle.id, lessonSetHash, proposalIds: [lesson.id], topicIds: rows.map(row => row.topicId), rows,
    identityId: revision, evaluatorRevision: revision, registrationId, promptVersions: [revision],
    startedAt: LESSON_FIXTURE_TIME, finishedAt: LESSON_FIXTURE_TIME, issues: [] }));
  return store.lessons.putValidation(run);
}
export async function measureResearchLessonMechanism(loaded: LoadedResearchFixture, fixture: LoadedLessonFixture,
  hypothesisId: 'none' | 'age-linear' | 'severity-weighted-age', runTopics: LessonTopicRunner) {
  const persistence = createMemoryResearchPersistence(), store = createResearchStoreAdapter(persistence), native = nativeLessonMeasurement('topic-quality');
  try {
    const procedure = await researchLessonFixtureProcedure(fixture);
    const origin = await materializeLessonCorrection({ store, scope: fixture.registration.scope, id: 'lesson-origin-' + hypothesisId,
      procedure, contract: loaded.topics[0].contract, plan: loaded.topics[0].plan,
      finding: 'Check the registered metric name, unit and direction before admitting a result.' });
    const proposed = await proposeFixtureLesson({ store, scope: fixture.registration.scope, runId: origin.project.id,
      procedure, edit: fixture.beneficial.proposal.edit, decayHypothesisId: hypothesisId });
    if (proposed.issues.length || proposed.proposals.length !== 1 || proposed.spend.tokens === null || proposed.spend.physical === null)
      throw Error('The registered proposer did not admit one bounded correction: ' + JSON.stringify(proposed));
    native.proposerSpend = { ...zeroLessonSpend(), calls: proposed.spend.calls, tokens: proposed.spend.tokens,
      physical: proposed.spend.physical, replayed: proposed.spend.replayed, ms: proposed.spend.ms };
    let lesson = proposed.proposals[0];
    const targets = [];
    for (const [index, topic] of loaded.topics.entries()) {
      const project = { ...origin.project, id: 'lesson-consumer-' + hypothesisId + '-' + index,
        lessonContext: { topicId: topic.id, taskFamily: fixture.registration.scope.taskFamily, input: {
          topicHash: fixture.registration.topics[index].sha256, contractHash: topic.contract.contractHash, planHash: topic.plan.planHash } } };
      researchValue(await store.createProject(researchValue(planProjectCreate(project)))); targets.push(project);
    }
    // Relevance is a retained observation of the public metric contract, never a hidden answer.
    const observations = targets.map((project, index) => ({ runId: project.id, age: index + 1, contradictions: 0, negativeTransfer: 0,
      relevance: Number(loaded.topics[index].contract.metrics.every(metric => Boolean(metric.id && metric.unit && metric.direction))) }));
    if (hypothesisId !== 'none') {
      const { id: _id, revision: _revision, ...body } = lesson;
      lesson = researchValue(await sealResearchLesson({ ...body, decay: { ...body.decay, relevanceRows: observations } }));
      researchValue(await store.lessons.putProposal(lesson));
    }
    native.proposalIds = [...new Set([...proposed.proposals.map(row => row.id), lesson.id])].sort();
    for (const row of observations) native.decay.push({ runId: row.runId, age: row.age, relevance: row.relevance, hypothesisId,
      weight: researchValue(lessonDecayWeight(lesson, hypothesisId, row.runId)) });
    const refiner = createLessonRefiner({ store, scope: fixture.registration.scope, now: () => LESSON_FIXTURE_TIME,
      read: async () => ({ snapshot: procedure, set: null }), forbidden: fixture.registration.topics.map(row => row.id) });
    const preview = researchValue(await refiner.materialize({ proposalIds: [lesson.id] }));
    native.phase = 'materialization'; native.candidateBundleHash = preview.snapshot.bundle.id;
    const baseline = await runTopics(procedure), candidate = await runTopics(preview.snapshot);
    native.validationSpend = sumLessonSpend(...baseline.map(row => row.spend), ...candidate.map(row => row.spend));
    const rows: LessonValidationRow[] = [];
    for (const [index, row] of candidate.entries()) {
      const input = targets[index].lessonContext.input;
      rows.push({ topicId: row.topicId, input, inputHash: lessonInputHash(input), topicContentHash: await researchRevisionOf(input),
        output: row.output, baselineOutput: baseline[index].output, score: row.primary, baselineScore: baseline[index].primary,
        truth: LESSON_FIXTURE_TRUTH, spend: sumLessonSpend(row.spend, baseline[index].spend) });
    }
    const validation = researchValue(await retainLessonValidation({ store, lesson, snapshot: preview.snapshot, rows, registrationId: fixture.registration.revision }));
    native.validationRun = validation; native.phase = 'validation';
    const staged = researchValue(await refiner.commit({ proposalIds: [lesson.id], validationRunIds: [validation.id] }));
    native.phase = 'staging'; native.candidateSetHash = staged.set.id;
    native.stagedIds = staged.staged.map(row => row.id); native.validatedIds = staged.validated.map(row => row.id);
    const host = await lessonOutcomeHost({ store, outcomeStore: createMemoryOutcomeStore(), scope: fixture.registration.scope,
      baseBundleHash: procedure.bundle.id, validationRunIds: [validation.id], lessonSetIds: [staged.set.id], lesson });
    const evaluated = await host.candidate(staged.set.id, validation.id, 'registered-topic-quality');
    Object.assign(native, { versionId: evaluated.versionId, evaluationId: evaluated.evaluationId,
      activationEventId: evaluated.activationEventId, phase: evaluated.activationEventId ? 'activation' : 'approval' });
    if (evaluated.refused.length) nativeLessonRefusal(native, { code: 'TRSH2007', path: '/approval',
      detail: 'The native outcome gate refused this measured candidate.', cause: evaluated.refused[0] });
    const injections = [], procedures = [];
    for (const project of targets) {
      const injected = researchValue(await injectLessons({ store, outcomes: host.service, profile: fixture.registration.scope,
        runId: project.id, baseBundleHash: procedure.bundle.id }));
      if (!injected.procedure) throw Error('Missing frozen fixture procedure.');
      if (injected.procedure.injection) native.injections.push(injected.procedure.injection);
      const composed = composeSkillSystem('', injected.procedure.snapshot);
      if (!composed.valid) throw Error('Native procedure preload refused: ' + JSON.stringify(composed.issues));
      const root = composed.value;
      const read = skillReadTool(injected.procedure.snapshot).execute({ path: 'SKILL.md' });
      if (read.content !== root) throw Error('Native preload and file consumer disagree.');
      native.procedureReads.push({ runId: project.id, bundleHash: injected.procedure.snapshot.bundle.id, rootHash: await researchRevisionOf({ root }) });
      injections.push(injected); procedures.push(injected.procedure);
    }
    // A refused candidate leaves the real checked head off. The measured run keeps that refusal.
    const actual = await runTopics(procedures[0].snapshot);
    const actualBundleHash = procedures[0].snapshot.bundle.id;
    if (procedures.some(row => row.snapshot.bundle.id !== actualBundleHash)) throw Error('The frozen topic batch changed procedure.');
    const actualSetHash = procedures[0].set?.id ?? await researchRevisionOf({ bundleHash: actualBundleHash, lessonIds: [], decayHypothesisId: 'none', rows: {} });
    return { native, topics: actual, baseline, baseBundleHash: procedure.bundle.id, bundleHash: actualBundleHash, lessonSetHash: actualSetHash,
      eligibilityIssues: evaluated.eligibilityIssues, noActive: injections.reduce((n, row) => n + (row.refused.OUTC1004 ?? 0), 0),
      preparationSpend: sumLessonSpend(native.proposerSpend, native.validationSpend),
      counts: nativeLessonCounts(native), proposedRequests: proposed.requests };
  } finally { await persistence.close(); }
}
