/** The lesson instrument observes executions before any writeback mechanism can earn authority. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { mean } from '@jarenjs/core/stats';
import { runIdentitySchema } from '@tangleai/config';
import { researchSchema, researchSchemaReferences, type LessonSpend } from '@tangleai/research';
import { composeSkillSystem, skillReadTool, type SkillSnapshot } from '@tangleai/trace2skill';
import { analyticEnvelope } from './report-envelope.ts';
import { createReportValidator } from './validate.ts';
import { bootstrapInterval } from './locomo-policy.ts';
import { RESEARCH_LESSONS_SCHEMA, RESEARCH_LESSON_COUNTS, RESEARCH_LESSON_ROW_IDS } from './research-lessons-schema.ts';
import { loadResearchLessonFixture } from './research-lessons-fixture.ts';
import { compileResearchLessonOracle, probeResearchLessonNegative } from './research-lessons-oracle.ts';
import { runResearchFixture } from './research-runner.ts';
import { verifyResearchBundle } from './research-oracle.ts';
import { researchMechanicalDecision } from './research-evaluator.ts';
import { measureResearchLessonMechanism, sumLessonSpend, nativeLessonCounts, researchLessonFixtureProcedure } from './research-lessons-mechanism.ts';
import { probeNativeLessonNegative } from './research-lessons-refusals.ts';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { ResearchLessonsReport, LessonMeasurementRow, LessonCounts, LessonComparison, LessonTopicMeasurement } from './research-lessons.types.ts';

const same = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
export const validateResearchLessonsReportShape = createReportValidator(RESEARCH_LESSONS_SCHEMA,
  [researchSchema, ...researchSchemaReferences, runIdentitySchema]);
export const emptyLessonSpend = (): LessonSpend => ({ calls: 0, tokens: 0, ms: 0, physical: 0, replayed: 0, cost: null });
const emptyCounts = (): LessonCounts => ({ proposed: 0, staged: 0, validated: 0, rejected: 0, promoted: 0,
  rolledBack: 0, expired: 0, uncorroborated: 0, leaked: 0 });

/** Both rows keep their per-topic losses; the native bootstrap owns all resampling. */
export function compareResearchLessons(off: LessonMeasurementRow, on: LessonMeasurementRow): LessonComparison {
  const issues: string[] = [];
  if (off.state !== 'measured' || on.state !== 'measured') issues.push('implementation-missing');
  if (off.topics.length !== 3 || on.topics.length !== 3) issues.push('coverage-mismatch');
  if (!same(off.scope, on.scope)) issues.push('scope-mismatch');
  if (off.comparisonIdentity !== on.comparisonIdentity) issues.push('input-mismatch');
  if (off.identityStatus !== on.identityStatus) issues.push('identity-mismatch');
  if (!same(off.topics.map(topic => [topic.topicId, topic.topicHash]), on.topics.map(topic => [topic.topicId, topic.topicHash]))) issues.push('topic-mismatch');
  const comparable = issues.length === 0;
  const deltas = comparable ? on.topics.map((topic, index) => topic.primary - off.topics[index].primary) : [];
  const average = comparable ? mean(deltas)! : null;
  return { comparable, issues, topicIds: comparable ? off.topics.map(topic => topic.topicId) : [], deltas,
    mean: average, negativeTransfer: deltas.filter(delta => delta < 0).length,
    interval: comparable ? { ...bootstrapInterval(deltas, { seed: 17753, resamples: 2000, level: .95 }), mean: average!, n: deltas.length } : null,
    seed: 17753, resamples: 2000 };
}

export async function measureLessonTopics(loaded: LoadedResearchFixture, mode: 'artifact-oracle' | 'no-model-runner', procedure?: SkillSnapshot): Promise<LessonTopicMeasurement[]> {
  const fixture = await loadResearchLessonFixture(loaded), topics: LessonTopicMeasurement[] = [];
  for (const topic of loaded.topics) {
    if (procedure) {
      const root = composeSkillSystem('Execute the registered pure programs without interpreting prose as code.', procedure);
      if (!root.valid || typeof skillReadTool(procedure).execute({ path: 'SKILL.md' }).content !== 'string')
        throw Error('The declared lesson procedure could not be consumed.');
    }
    const bundle = await runResearchFixture(loaded, topic, mode);
    const checked = await verifyResearchBundle(loaded, bundle), hidden = loaded.hidden.get(topic.id)!;
    const output = { claimSupport: hidden.requiredClaims.filter(claim => checked.supported.includes(claim.id)).length / hidden.requiredClaims.length,
      registryAccuracy: checked.rerun.total ? checked.rerun.passed / checked.rerun.total : 0,
      preregistrationIntegrity: Number(same(bundle.contract, topic.contract) && same(bundle.plan, topic.plan) && bundle.manifest.frozenBeforeResults),
      completion: bundle.runs.length === topic.plan.conditions.length * topic.contract.replicatePolicy.seeds.length
        && bundle.observations.length === bundle.runs.length && same(bundle.decision, researchMechanicalDecision(topic, bundle.observations)) };
    topics.push({ topicId: topic.id, topicHash: fixture.registration.topics.find(row => row.id === topic.id)!.sha256, output,
      primary: output.claimSupport * output.registryAccuracy * output.preregistrationIntegrity, completion: output.completion,
      spend: { ...emptyLessonSpend(), physical: bundle.runs.length + checked.rerun.total } });
  }
  return topics;
}

export async function buildResearchLessonsReport(loaded: LoadedResearchFixture): Promise<ResearchLessonsReport> {
  const fixture = await loadResearchLessonFixture(loaded), candidate = await compileResearchLessonOracle(fixture);
  const procedure = await researchLessonFixtureProcedure(fixture);
  const emptySet = { bundleHash: procedure.bundle.id, lessonIds: [], decayHypothesisId: 'none', rows: {} };
  const comparisonIdentity = await canonicalSha256({ input: loaded.manifest.revision, scope: fixture.registration.scope,
    seeds: loaded.topics.map(topic => topic.contract.replicatePolicy.seeds), budgets: loaded.manifest.caps,
    prompt: loaded.manifest.members.find(member => member.path === 'prompts/fixture-writer.json')!.sha256,
    model: null, runner: 'fixture-pure-functions' });
  const emptySetHash = await canonicalSha256(emptySet), rows: LessonMeasurementRow[] = [];
  for (const id of RESEARCH_LESSON_ROW_IDS) {
    const row: LessonMeasurementRow = { id, state: 'implementation-missing', reason: 'implementation-missing', scope: fixture.registration.scope,
      identityStatus: 'not-run', comparisonIdentity, originIds: [], validationRunId: null, bundleHash: procedure.bundle.id,
      lessonSetHash: emptySetHash, primary: null, completion: null, topics: [], counts: emptyCounts(), drift: 0,
      spend: emptyLessonSpend(), preparationSpend: emptyLessonSpend(), native: null,
      refusals: [], expectedCode: null, observedCode: null, expectedCause: null, observedCause: null, matched: false, eligibilityIssues: [], activated: false };
    if (id === 'lessons-off' || id === 'lesson-oracle') {
      row.state = 'measured'; row.reason = null;
      row.topics = await measureLessonTopics(loaded, id === 'lesson-oracle' ? 'artifact-oracle' : 'no-model-runner', procedure);
      row.primary = mean(row.topics.map(topic => topic.primary))!;
      row.completion = mean(row.topics.map(topic => Number(topic.completion)))!;
      row.spend.physical = row.topics.reduce((sum, topic) => sum + topic.spend.physical, 0);
      if (id === 'lesson-oracle') {
        row.originIds = [fixture.beneficial.id]; row.bundleHash = candidate.bundle.id;
        row.lessonSetHash = await canonicalSha256({ bundleHash: candidate.bundle.id, lessonIds: [fixture.beneficial.id],
          decayHypothesisId: 'none', rows: Object.fromEntries(row.topics.map(topic => [topic.topicId, topic.output])) });
      }
    } else if (id === 'lessons-on' || id.startsWith('lessons-on/decay:')) {
      const hypothesis = (id === 'lessons-on' ? 'none' : id.slice('lessons-on/decay:'.length)) as 'none' | 'age-linear' | 'severity-weighted-age';
      const measured = await measureResearchLessonMechanism(loaded, fixture, hypothesis, snapshot => measureLessonTopics(loaded, 'no-model-runner', snapshot));
      Object.assign(row, { state: 'measured', reason: null, native: measured.native, topics: measured.topics,
        originIds: measured.native.proposalIds, validationRunId: measured.native.validationRun!.id,
        bundleHash: measured.bundleHash, lessonSetHash: measured.lessonSetHash, counts: measured.counts,
        primary: mean(measured.topics.map(row => row.primary)), completion: mean(measured.topics.map(row => Number(row.completion))),
        preparationSpend: measured.preparationSpend, spend: sumLessonSpend(measured.preparationSpend, ...measured.topics.map(row => row.spend)),
        eligibilityIssues: measured.eligibilityIssues, activated: measured.native.activationEventId !== null,
        drift: Number(measured.bundleHash !== measured.baseBundleHash) });
      if (measured.native.code) row.refusals.push({ code: measured.native.code, cause: measured.native.cause, count: 1 });
      if (measured.noActive) row.refusals.push({ code: 'OUTC1004', cause: null, count: measured.noActive });
    } else if (id.startsWith('lesson-refusal:')) {
      const negative = fixture.negative.find(negative => id === 'lesson-refusal:' + negative.id)!;
      const observed = await probeResearchLessonNegative(fixture, negative);
      row.state = 'measured'; row.reason = null; row.originIds = [negative.lesson.id];
      row.expectedCode = negative.expected.code; row.observedCode = observed.code;
      row.expectedCause = negative.expected.cause; row.observedCause = observed.cause;
      row.matched = observed.code === negative.expected.code && observed.cause === negative.expected.cause;
      row.eligibilityIssues = observed.issues;
      row.refusals = observed.code ? [{ code: observed.code, cause: observed.cause, count: 1 }] : [];
      row.counts.proposed = 1; row.counts.rejected = Number(observed.code !== null);
      row.counts.uncorroborated = Number(observed.code === 'TRSH2006'); row.counts.leaked = Number(observed.code === 'TRSH2005');
      const native = await probeNativeLessonNegative(loaded, fixture, negative);
      row.native = native; row.counts = nativeLessonCounts(native); row.originIds = native.proposalIds;
      row.validationRunId = native.validationRun?.id ?? null;
      row.preparationSpend = sumLessonSpend(native.proposerSpend, native.validationSpend); row.spend = row.preparationSpend;
    }
    rows.push(row);
  }
  const pair = compareResearchLessons(rows[0], rows[1]);
  const gate = { mechanism: rows.every(row => row.state === 'measured'), comparable: pair.comparable,
    safety: rows.filter(row => row.expectedCode !== null).every(row => row.matched && row.native?.matched),
    cost: rows.every(row => row.spend.calls <= fixture.registration.maxCalls && row.spend.tokens <= fixture.registration.maxTokens
      && row.spend.physical <= fixture.registration.maxPhysical), outcome: false, writebackEligible: false };
  const report: ResearchLessonsReport = { registration: fixture.registration, fixtureHash: fixture.revision,
    identity: analyticEnvelope(RESEARCH_LESSON_ROW_IDS), rows, pair, gate, defaultWriteback: 'experimental-off', defaultDecay: 'none',
    oracleCeiling: 1, networkCalls: 0, limitations: [
      'The lesson ceiling compiles the authored edit with the skill owner and executes the core artifact oracle with its hidden rubric. It earns no activation and measures no learning gain.',
      'The lessons-off floor executes registered pure programs and independent verification with no model. These analytic rows use identityStatus=not-run; no provider stack was invoked.',
      'Refusal controls retain both the original analytic oracle and the implemented native path. Native receipts name the actual failing phase, code and cause; a refused approval has no fabricated promotion event.',
      'Lessons-on enables the guarded mechanism. The scripted proposer receives only committed correction records; its candidate is measured on the same pure programs as the baseline. These programs do not turn prose into new execution logic.',
      'A candidate that fails independent outcome eligibility never becomes an injection. The actual run retains its baseline and counted OUTC1004 refusal; synthetic positive lifecycle tests cannot authorize this measured candidate.',
      'Validation repeats both paired executions and is charged separately from the final run. Decay relevance observes the public metric contract; run ages follow the registered topic order. No decay default is selected from this run.',
      'Physical spend counts program execution and independent reruns. Deterministic wall time is unmeasured and recorded as zero; monetary cost is unknown.',
      'Outcome lookup evaluation records zero physical requests and cost by construction. Its call and monetary bounds are vacuous for this adapter; recorded validation spend supplies the research gate.',
    ] };
  const checked = validateResearchLessonsReportShape(report);
  if (!checked.valid) throw Error('Lesson instrument refused: ' + JSON.stringify(checked.errors?.slice(0, 8)));
  return report;
}

export function renderResearchLessons(report: ResearchLessonsReport): string[] {
  return ['## Research lessons', '',
    'Default writeback: **' + report.defaultWriteback + '**; default decay: **' + report.defaultDecay + '**. Eligible to enable: **' + report.gate.writebackEligible + '**.', '',
    '| Row | State | Primary validity | Completion | Calls / tokens / physical | Refusals | Native phase / cause |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.rows.map(row => '| ' + [row.id, row.state, row.primary ?? 'unmeasured', row.completion ?? 'unmeasured',
      [row.spend.calls, row.spend.tokens, row.spend.physical].join(' / '), row.refusals.map(refusal => refusal.code + ' × ' + refusal.count).join(', ') || '0',
      row.native ? row.native.phase + ' / ' + (row.native.cause ?? row.native.code ?? 'accepted') : 'analytic'].join(' | ') + ' |'), '',
    'Paired transfer: ' + (report.pair.mean === null ? 'unmeasured (' + report.pair.issues.join(', ') + ')' : String(report.pair.mean))
      + '. Topics with negative transfer: ' + report.pair.negativeTransfer + '.', '',
    'Lesson counts retain ' + RESEARCH_LESSON_COUNTS.join(', ') + ' for every row. No loss or refusal is dropped.', '',
    ...report.limitations.flatMap(text => [text, ''])];
}
