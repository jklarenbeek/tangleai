/** The registered five-row comparison uses one scorer and the shared native paired bootstrap. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { mulberry32, randomInt } from '@jarenjs/core/random';
import { mean, quantile } from '@jarenjs/core/stats';
import { equalsJson } from '@jarenjs/core/object';
import { identityIdOf, validateRunIdentity } from '@tangleai/config';
import { createExperientialEvaluation, planExperientialEvaluation, recordExperientialEvaluation, sealExperientialRecord,
  checkExperientialRecord, evaluationMetricsOf, EXPERIENTIAL_EVALUATION_ROWS, type ExperientialEvaluationMetrics } from '@tangleai/experiential';
import { bootstrapInterval } from './locomo-policy.ts';
import { readAiEnv, envConfigIdentity } from './ai-env.ts';
import { lookupKey, questionOf, renderCgtRule } from './cgt-fixture.ts';
import { createCgtRetrieval, createCgtRuleFollower, type CgtAnswerer } from './cgt-rows.ts';
import { observeCgtAnswer, scoreAnswer, summarizeCgt, type CgtAnswer } from './cgt-scorer.ts';
import { CGT_CANDIDATES, CGT_EVALUATION_TIME, cgtEvaluationFixture, cgtCandidateArtifact, cgtBaseReplayAnswer, requireExperiential,
  type CgtCandidateId, type CgtEvaluationFixture } from './cgt-evaluation-fixtures.ts';
import type { CgtFixture, CgtCandidateEvaluation, CgtCandidateEvidence, CgtCandidateRow, CgtSecurityFixture, CgtReport } from './cgt.types.ts';

export interface CgtEvaluationClients {
  answer?: CgtAnswerer;
  baseReplay?: (query: CgtEvaluationFixture['baseReplay']['queries'][number]) => string | Promise<string>;
  security?: (input: { fixture: CgtSecurityFixture; source: unknown; canary: string }) => string | null | Promise<string | null>;
  clock?: () => number;
}

function evaluationIdentity(rowId: typeof EXPERIENTIAL_EVALUATION_ROWS[number], candidate: CgtCandidateId, queryBudget: number) {
  return envConfigIdentity(readAiEnv({ TANGLE_AI_PROVIDER: 'ollama', TANGLE_AI_MODEL: 'cgt-scripted-' + rowId + '-' + candidate,
    TANGLE_AI_MAX_CALLS: String(queryBudget), TANGLE_AI_MAX_CONCURRENCY: '1' }), null, 'scripted');
}

export async function evaluateCandidate(input: {
  fixture: CgtFixture; dataset: CgtEvaluationFixture['dataset']; candidate: CgtCandidateId; baseline: CgtEvaluationFixture['baseline'];
  controls: CgtEvaluationFixture; clients?: CgtEvaluationClients; policy: CgtEvaluationFixture['policy']; evaluatorRevision: string; questionSetId: string;
}): Promise<CgtCandidateEvaluation> {
  const { fixture, dataset, candidate, baseline, controls, policy, evaluatorRevision, questionSetId } = input;
  if (dataset.id !== controls.dataset.id || baseline.id !== controls.baseline.id || policy.id !== controls.policy.id)
    throw Error('cgt evaluation: registered inputs differ');
  const experiences = fixture.sessions.flatMap(session => session.experiences), mapping = controls.observations.itemIds;
  const excludedExperienceIds = [...dataset.splits.train, ...dataset.splits.validation, ...dataset.splits.compositionalHoldout].sort();
  const forbiddenItemIds = excludedExperienceIds.map(id => mapping[id]);
  if (forbiddenItemIds.some(id => !id)) throw Error('TEXP1011 cgt: a training or validation experience lacks its source item');
  const random = mulberry32(fixture.manifest.seed + 1), vocabulary = fixture.rule.vocabulary;
  const randomAnswers = new Map(fixture.questions.map(query => [query.id, vocabulary[randomInt(random, 0, vocabulary.length)]]));
  const retrieval = await createCgtRetrieval(fixture, randomAnswers);
  const candidateRetrieval = await createCgtRetrieval(fixture, randomAnswers, { excludedIds: forbiddenItemIds });
  const retainedItems = new Set((await candidateRetrieval.store.list()).map(unit => unit.id));
  const retainedExperienceIds = Object.keys(mapping).filter(id => retainedItems.has(mapping[id])).sort();
  const validationRetrievable = forbiddenItemIds.filter(id => retainedItems.has(id)).length;
  if (validationRetrievable) throw Error('TEXP1011 cgt: validation or training remains retrievable');
  const trainIds = new Set(dataset.splits.train.map(id => mapping[id])), trained = experiences.filter(item => trainIds.has(item.id));
  const rule = createCgtRuleFollower(renderCgtRule(fixture.rule));
  const candidateAnswer: CgtAnswerer = input.clients?.answer ?? ((question, available) => candidate === 'candidate-memorizer'
    ? { answer: trained.find(value => lookupKey(value) === lookupKey(question))?.truth ?? randomAnswers.get(question.id) }
    : candidate === 'candidate-forgetting' && question.conceptIds.length === 1 ? { answer: randomAnswers.get(question.id) } : rule(question, available));
  const answerers: Record<typeof EXPERIENTIAL_EVALUATION_ROWS[number], CgtAnswerer> = {
    'frozen-none': question => ({ answer: randomAnswers.get(question.id) }), 'frozen-retrieval': retrieval.answer,
    'frozen-distilled-rule': rule, 'active-artifact-no-retrieval': rule, 'candidate-no-retrieval': candidateAnswer,
  };
  const artifact = await cgtCandidateArtifact(candidate, fixture, baseline);
  const head = requireExperiential(await sealExperientialRecord('head', { document: 'experiential-head', schemaVersion: 1,
    scope: dataset.scope, recordedAt: CGT_EVALUATION_TIME, profile: 'cgt-scripted-evaluation', head: { versionId: null, revision: 0 }, eventId: null }));
  const plan = requireExperiential(await planExperientialEvaluation({ artifact, baseline, dataset, policy, head, evaluatorRevision, questionSetId,
    sampleCount: fixture.questions.filter(item => item.partition === 'novel').length, recordedAt: CGT_EVALUATION_TIME }));
  const rows: CgtCandidateRow[] = [], times: number[] = [], clock = input.clients?.clock ?? (() => 0);
  const queryBudget = fixture.questions.length + controls.baseReplay.queries.length + controls.security.fixtures.length;
  for (const rowId of EXPERIENTIAL_EVALUATION_ROWS) {
    const identity = await evaluationIdentity(rowId, candidate, queryBudget);
    const observations = [];
    for (const item of fixture.questions) {
      const before = clock(); let answer: CgtAnswer;
      try { answer = await answerers[rowId](questionOf(item), rowId === 'frozen-retrieval' ? structuredClone(experiences) : []); }
      catch { answer = { answer: null, failure: 'refused' }; }
      const elapsed = clock() - before;
      if (!Number.isFinite(elapsed) || elapsed < 0) throw Error('cgt evaluation: invalid injected clock');
      if (rowId === 'candidate-no-retrieval') times.push(elapsed);
      const observed = observeCgtAnswer(item, answer, vocabulary);
      if (rowId !== 'frozen-retrieval' && observed.retrievedIds.length) throw Error('TEXP1011 cgt: retrieval is disabled for this row');
      observations.push(observed);
    }
    rows.push({ rowId, identity, observations });
  }
  const summaries = rows.map(row => ({ row, summary: summarizeCgt(row.observations) }));
  const candidateRow = rows.find(row => row.rowId === 'candidate-no-retrieval')!, candidateSummary = summarizeCgt(candidateRow.observations);
  const baselineSummary = summarizeCgt(rows.find(row => row.rowId === 'active-artifact-no-retrieval')!.observations);
  const intervals = policy.controls.map(control => {
    const row = rows.find(row => row.rowId === control)!, pairs = candidateRow.observations.filter(value => value.partition === 'novel')
      .map(value => value.score - row.observations.find(other => other.queryId === value.queryId)!.score);
    return { control, ...bootstrapInterval(pairs, policy.interval), resamples: policy.interval.resamples, seed: policy.interval.seed,
      level: policy.interval.level, pairs: pairs.length };
  });
  const baseReplay: CgtCandidateEvidence['baseReplay'] = [];
  for (const query of controls.baseReplay.queries) {
    const expected = cgtBaseReplayAnswer(query);
    const answer = input.clients?.baseReplay ? await input.clients.baseReplay(query) : candidate === 'candidate-forgetting' ? 'forgotten' : expected;
    baseReplay.push({ queryId: query.id, truth: query.truth, candidate: answer, baseline: expected,
      candidateScore: scoreAnswer(answer, query.truth), baselineScore: scoreAnswer(expected, query.truth) });
  }
  if (baseReplay.some(row => row.baselineScore !== 1)) throw Error('cgt base replay: independent authored truth disagrees with its baseline');
  const security: CgtCandidateEvidence['security'] = [];
  for (const item of controls.security.fixtures) {
    const source = controls.sources.get(item.id) ?? item.input;
    const answer = input.clients?.security ? await input.clients.security({ fixture: item, source, canary: controls.security.canary })
      : candidate === 'candidate-tainted' ? item.id === 'secret-canary' ? controls.security.canary : item.attackAnswer
        : item.id === 'cross-scope' ? null : 'safe';
    const secretPresent = typeof answer === 'string' && answer.includes(controls.security.canary), refused = answer === null;
    const outcome = refused ? 'refused' as const : !secretPresent && answer === item.expected ? 'unchanged' as const : 'changed' as const;
    security.push({ fixtureId: item.id, sourceDigest: await canonicalSha256(source), answerDigest: await canonicalSha256(answer),
      expectedDigest: await canonicalSha256(item.expected), secretPresent, refused, outcome });
  }
  const measurements: ExperientialEvaluationMetrics = { scope: dataset.scope, gatePolicyId: policy.id, migrationExperiment: false,
    rows: summaries.map(({ row, summary }) => ({ rowId: row.rowId, status: 'run', cgc: summary.cgc, retention: summary.retention,
      failures: Object.values(summary.failures).reduce((sum, value) => sum + value, 0), cost: null, identityId: row.identity.identityId, samples: summary.sampleCount.novel })),
    interval: intervals, retention: [{ lane: 'cgt-replay', status: 'run', drop: baselineSummary.retention! - candidateSummary.retention! },
      { lane: 'base-replay', status: 'run', drop: mean(baseReplay.map(row => row.baselineScore))! - mean(baseReplay.map(row => row.candidateScore))! },
      { lane: 'locomo-recall', status: 'not-run', drop: null }, { lane: 'locomo-qa', status: 'not-run', drop: null }],
    security: security.map(({ fixtureId, outcome }) => ({ fixtureId, outcome })),
    operations: { status: 'run', artifactBytes: artifact.sizeBytes, trainingMs: 0, inferenceP95Ms: quantile(times, 0.95, { method: 'nearest-rank' })!,
      failureRate: Object.values(candidateSummary.failures).reduce((sum, value) => sum + value, 0) / candidateRow.observations.length,
      cost: 0, runtimeProvider: artifact.runtime.provider }, cost: null };
  const body = { candidateId: candidate, evaluatorRevision, questionSetId, settings: { seed: fixture.manifest.seed,
      randomSeed: fixture.manifest.seed + 1, K: fixture.manifest.retrievalK, experienceBudget: experiences.length, queryBudget }, rows, baseReplay, security, candidateElapsedMs: times,
    retrieval: { excludedExperienceIds, retainedExperienceIds, forbiddenItemIds, candidateRetrievedIds: candidateRow.observations.flatMap(row => row.retrievedIds), validationRetrievable }, measurements };
  const evidence = { ...body, reportId: await canonicalSha256(body) };
  const evaluation = requireExperiential(await createExperientialEvaluation({ registration: plan.registration, policy, measurements,
    reportId: evidence.reportId, recordedAt: CGT_EVALUATION_TIME }));
  const result = requireExperiential(await recordExperientialEvaluation({ artifact: plan.after, baseline, dataset, policy, evaluation }));
  return { candidateId: candidate, tier: 'scripted', status: 'run', artifact: plan.after, evaluation, evidence,
    plannedState: result.after.state as 'approved' | 'rejected' };
}

export async function measureCgtCandidates(root: string, fixture: CgtFixture, evaluatorRevision: string) {
  const controls = await cgtEvaluationFixture(root, fixture), questionSetId = await canonicalSha256(fixture.questions);
  const evaluations: CgtCandidateEvaluation[] = [];
  for (const candidate of CGT_CANDIDATES) evaluations.push(await evaluateCandidate({ fixture, dataset: controls.dataset, candidate,
    baseline: controls.baseline, controls, policy: controls.policy, evaluatorRevision, questionSetId }));
  return { evaluations, evaluationContext: { policy: controls.policy, dataset: controls.dataset, baseline: controls.baseline, evaluatorRevision, questionSetId,
    live: { status: 'not-run' as const, reason: 'No live training, candidate inference, LoCoMo chat regression or activation has been authorized or executed.' } } };
}

/** Reconcile every retained observation and paired interval before trusting the native gate result. */
export async function validateCgtCandidates(report: CgtReport, fixture: CgtFixture, root: string): Promise<void> {
  const context = report.evaluationContext, expected = await cgtEvaluationFixture(root, fixture);
  if (!equalsJson(context.policy, expected.policy) || !equalsJson(context.dataset, expected.dataset) || !equalsJson(context.baseline, expected.baseline)
    || context.evaluatorRevision !== await canonicalSha256(report.source.files) || context.questionSetId !== await canonicalSha256(fixture.questions))
    throw Error('cgt evaluation: frozen policy, dataset, baseline or evaluator differs');
  const experiences = fixture.sessions.flatMap(session => session.experiences), allowed = new Set(experiences.map(item => item.id));
  const excluded = [...context.dataset.splits.train, ...context.dataset.splits.validation, ...context.dataset.splits.compositionalHoldout].sort();
  const forbidden = excluded.map(id => expected.observations.itemIds[id]);
  const retained = Object.keys(expected.observations.itemIds).filter(id => !excluded.includes(id)).sort();
  for (const [index, candidate] of report.evaluations.entries()) {
    const { evidence, evaluation, artifact } = candidate, { reportId, ...body } = evidence;
    if (candidate.candidateId !== CGT_CANDIDATES[index] || evidence.candidateId !== candidate.candidateId || reportId !== await canonicalSha256(body)
      || evaluation.reportId !== reportId || evidence.evaluatorRevision !== context.evaluatorRevision || evidence.questionSetId !== context.questionSetId
      || !equalsJson(evidence.measurements, evaluationMetricsOf(evaluation))) throw Error('cgt evaluation: evidence identity or record differs');
    const plannedArtifact = await cgtCandidateArtifact(candidate.candidateId, fixture, context.baseline);
    const { evaluationRegistration, state, ...immutable } = artifact;
    const { state: _state, ...expectedArtifact } = plannedArtifact;
    if (!equalsJson(immutable, expectedArtifact) || state !== 'evaluating' || evaluationRegistration?.questionSetId !== context.questionSetId)
      throw Error('cgt evaluation: candidate receipt differs');
    requireExperiential(await checkExperientialRecord('artifact', artifact));
    const decision = requireExperiential(await recordExperientialEvaluation({ artifact, baseline: context.baseline, dataset: context.dataset,
      policy: context.policy, evaluation }));
    if (candidate.plannedState !== decision.after.state) throw Error('cgt evaluation: claimed state differs from the gate plan');
    if (!equalsJson(evidence.settings, { seed: fixture.manifest.seed, randomSeed: fixture.manifest.seed + 1, K: fixture.manifest.retrievalK,
      experienceBudget: experiences.length, queryBudget: fixture.questions.length + expected.baseReplay.queries.length + expected.security.fixtures.length })
      || !equalsJson(evidence.rows.map(row => row.rowId), EXPERIENTIAL_EVALUATION_ROWS)) throw Error('cgt evaluation: unmatched row settings');
    for (const [rowIndex, row] of evidence.rows.entries()) {
      const resolved = validateRunIdentity(row.identity);
      const { identityId, ...identityPayload } = row.identity;
      if (!resolved.ok || identityId !== await identityIdOf(identityPayload)
        || !equalsJson(row.identity, await evaluationIdentity(row.rowId, candidate.candidateId, evidence.settings.queryBudget))
        || !equalsJson(row.observations.map(value => value.queryId), fixture.questions.map(value => value.id)))
        throw Error('cgt evaluation: row identity or question coverage differs');
      for (const [i, observed] of row.observations.entries()) if (observed.truth !== fixture.questions[i].truth || observed.partition !== fixture.questions[i].partition
        || !equalsJson(observed, observeCgtAnswer(fixture.questions[i], { answer: observed.prediction, failure: observed.failure, retrievedIds: observed.retrievedIds }, fixture.rule.vocabulary))
        || observed.retrievedIds.some(id => !allowed.has(id)) || observed.retrievedIds.length > fixture.manifest.retrievalK
        || row.rowId !== 'frozen-retrieval' && observed.retrievedIds.length)
        throw Error('cgt evaluation: unreconciled observation');
      const summary = summarizeCgt(row.observations), recorded = evaluation.rows[rowIndex];
      if (!equalsJson(recorded, { rowId: row.rowId, status: 'run', cgc: summary.cgc, retention: summary.retention,
        failures: Object.values(summary.failures).reduce((sum, value) => sum + value, 0), cost: null,
        identityId: row.identity.identityId, samples: summary.sampleCount.novel })) throw Error('cgt evaluation: row statistics differ');
    }
    const candidateRow = evidence.rows[4], baselineRow = evidence.rows[3];
    const intervals = context.policy.controls.map(control => {
      const row = evidence.rows.find(value => value.rowId === control)!;
      const pairs = candidateRow.observations.filter(value => value.partition === 'novel').map(value => value.score - row.observations.find(other => other.queryId === value.queryId)!.score);
      return { control, ...bootstrapInterval(pairs, context.policy.interval), resamples: context.policy.interval.resamples,
        seed: context.policy.interval.seed, level: context.policy.interval.level, pairs: pairs.length };
    });
    if (!equalsJson(intervals, evaluation.interval)) throw Error('cgt evaluation: paired interval differs from observed pairs');
    if (!equalsJson(evidence.baseReplay.map(row => row.queryId), expected.baseReplay.queries.map(row => row.id))) throw Error('cgt evaluation: base replay coverage differs');
    for (const [i, row] of evidence.baseReplay.entries()) if (row.truth !== expected.baseReplay.queries[i].truth || row.baseline !== cgtBaseReplayAnswer(expected.baseReplay.queries[i])
      || row.baselineScore !== scoreAnswer(row.baseline, row.truth) || row.candidateScore !== scoreAnswer(row.candidate, row.truth)) throw Error('cgt evaluation: base replay score differs');
    const retention = [{ lane: 'cgt-replay', status: 'run', drop: summarizeCgt(baselineRow.observations).retention! - summarizeCgt(candidateRow.observations).retention! },
      { lane: 'base-replay', status: 'run', drop: mean(evidence.baseReplay.map(row => row.baselineScore))! - mean(evidence.baseReplay.map(row => row.candidateScore))! },
      { lane: 'locomo-recall', status: 'not-run', drop: null }, { lane: 'locomo-qa', status: 'not-run', drop: null }];
    if (!equalsJson(retention, evaluation.retention)) throw Error('cgt evaluation: retention is missing or fabricated');
    if (!equalsJson(evidence.security.map(row => row.fixtureId), context.policy.security.fixtures)) throw Error('cgt evaluation: security coverage differs');
    for (const [i, row] of evidence.security.entries()) {
      const item = expected.security.fixtures[i], outcome = row.refused ? 'refused' : !row.secretPresent && row.answerDigest === row.expectedDigest ? 'unchanged' : 'changed';
      if (row.expectedDigest !== await canonicalSha256(item.expected) || row.sourceDigest !== await canonicalSha256(expected.sources.get(item.id) ?? item.input)
        || row.outcome !== outcome || row.refused && row.answerDigest !== await canonicalSha256(null)) throw Error('cgt evaluation: security outcome differs');
    }
    if (!equalsJson(evaluation.security, evidence.security.map(({ fixtureId, outcome }) => ({ fixtureId, outcome })))) throw Error('cgt evaluation: security gate projection differs');
    if (!equalsJson(evidence.retrieval, { excludedExperienceIds: excluded, retainedExperienceIds: retained, forbiddenItemIds: forbidden,
      candidateRetrievedIds: [], validationRetrievable: 0 })) throw Error('TEXP1011 cgt evaluation: candidate retrieval contains excluded inputs');
    const summary = summarizeCgt(candidateRow.observations);
    if (evidence.candidateElapsedMs.length !== fixture.questions.length || !equalsJson(evaluation.operations, { status: 'run',
      artifactBytes: artifact.sizeBytes, trainingMs: 0, inferenceP95Ms: quantile(evidence.candidateElapsedMs, 0.95, { method: 'nearest-rank' })!,
      failureRate: Object.values(summary.failures).reduce((sum, value) => sum + value, 0) / candidateRow.observations.length, cost: 0,
      runtimeProvider: artifact.runtime.provider })) throw Error('cgt evaluation: operational observations differ');
  }
}
