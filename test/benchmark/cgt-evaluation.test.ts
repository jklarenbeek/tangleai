import { before, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createExperientialEvaluation } from '@tangleai/experiential';
import { loadCgtFixture, validateCgtReport, renderDocument, requireCapability } from '../../benchmark/lib/cgt.ts';
import { evaluateCandidate } from '../../benchmark/lib/cgt-evaluation.ts';
import { CGT_CANDIDATES, cgtEvaluationFixture, requireExperiential, type CgtEvaluationFixture } from '../../benchmark/lib/cgt-evaluation-fixtures.ts';
import { createCgtRetrieval, createCgtRuleFollower } from '../../benchmark/lib/cgt-rows.ts';
import { renderCgtRule } from '../../benchmark/lib/cgt-fixture.ts';
import type { CgtFixture, CgtReport, CgtCandidateEvidence } from '../../benchmark/lib/cgt.types.ts';

const root = resolve(import.meta.dirname, '../..');
let fixture: CgtFixture, controls: CgtEvaluationFixture, report: CgtReport;
before(async () => {
  fixture = await loadCgtFixture(root); controls = await cgtEvaluationFixture(root, fixture);
  report = await validateCgtReport(JSON.parse(await readFile(resolve(root, 'benchmark/results/cgt.json'), 'utf8')), root);
});
const candidateInput = () => ({ fixture, controls, dataset: controls.dataset, baseline: controls.baseline, policy: controls.policy,
  candidate: 'candidate-rule-follower' as const, evaluatorRevision: report.evaluationContext.evaluatorRevision,
  questionSetId: report.evaluationContext.questionSetId });

it('registered candidates publish their actual ties, losses and missing lanes without scientific approval', () => {
  assert.deepEqual(report.evaluations.map(row => row.candidateId), [...CGT_CANDIDATES]);
  requireCapability(report, 'gates');
  const [memorizer, rule, forgetting, tainted, oversized] = report.evaluations;
  assert.equal(memorizer.evaluation.rows[4].cgc, 6 / 224);
  assert.deepEqual(memorizer.evaluation.interval.map(row => [row.low, row.high]), [[0, 0], [-0.9910714285714286, -0.9508928571428571]]);
  assert.equal(rule.evaluation.rows[4].cgc, 1); assert.deepEqual([rule.evaluation.interval[1].low, rule.evaluation.interval[1].high], [0, 0]);
  assert.equal(forgetting.evaluation.retention[0].drop, 123 / 128); assert.equal(forgetting.evaluation.retention[1].drop, 1);
  assert.equal(tainted.evaluation.security.filter(row => row.outcome === 'changed').length, 5);
  assert.equal(oversized.evaluation.operations.artifactBytes, 4097);
  for (const [row, family] of [[memorizer, 'learning'], [forgetting, 'retention'], [tainted, 'security'], [oversized, 'operations']] as const)
    assert.ok(row.evaluation.failures.some(value => value.gate === family));
  for (const row of report.evaluations) {
    assert.equal(row.evaluation.passed, false); assert.equal(row.plannedState, 'rejected'); assert.equal(row.artifact.state, 'evaluating');
    assert.ok(row.evaluation.rows.every(value => value.status === 'run' && value.identityId !== null && value.samples === 224));
    assert.deepEqual(row.evaluation.retention.slice(2), [{ lane: 'locomo-recall', status: 'not-run', drop: null }, { lane: 'locomo-qa', status: 'not-run', drop: null }]);
    assert.ok(row.evaluation.interval.every(value => value.seed === 17753 && value.resamples === 1000 && value.pairs === 224 && value.level === 0.95));
    assert.equal(row.evidence.retrieval.validationRetrievable, 0); assert.deepEqual(row.evidence.retrieval.candidateRetrievedIds, []);
  }
  const document = renderDocument(report);
  for (const text of ['Scripted accounting', 'Cost', 'Inference p95 ms', 'not-run', 'rejected', 'candidate-memorizer']) assert.ok(document.includes(text));
  assert.equal(report.evaluationContext.live.status, 'not-run');
});

it('the candidate retrieval store physically excludes every training, validation and holdout source', async () => {
  const excluded = [...controls.dataset.splits.train, ...controls.dataset.splits.validation, ...controls.dataset.splits.compositionalHoldout];
  const forbidden = excluded.map(id => controls.observations.itemIds[id]);
  const retrieval = await createCgtRetrieval(fixture, new Map(), { excludedIds: forbidden });
  const retained = (await retrieval.store.list()).map(row => row.id).sort();
  assert.equal(retained.some(id => forbidden.includes(id)), false);
  assert.deepEqual(retained, fixture.sessions.flatMap(row => row.experiences).map(row => row.id).filter(id => !forbidden.includes(id)).sort());
  assert.equal(retained.length + forbidden.length, 272);
});

it('injected answer failures count as losses and neither held-out truth nor training examples reach the candidate', async () => {
  let calls = 0, time = 0, network = 0;
  const original = globalThis.fetch, rule = createCgtRuleFollower(renderCgtRule(fixture.rule));
  globalThis.fetch = async () => { network++; throw Error('Unexpected network.'); };
  try {
    const measured = await evaluateCandidate({ ...candidateInput(), clients: { clock: () => time++, answer: (query, available) => {
      assert.equal(Object.hasOwn(query, 'truth'), false); assert.deepEqual(available, []); calls++;
      if (calls === 1) throw Error('injected refusal');
      if (calls === 2) return { answer: null, failure: 'rateLimited' };
      return rule(query, available);
    } } });
    assert.equal(calls, fixture.questions.length); assert.equal(network, 0);
    const row = measured.evidence.rows[4];
    assert.deepEqual(row.observations.slice(0, 2).map(value => [value.failure, value.score]), [['refused', 0], ['rateLimited', 0]]);
    assert.equal(measured.evaluation.rows[4].failures, 2);
    assert.equal(measured.evaluation.operations.failureRate, 2 / fixture.questions.length);
    assert.equal(measured.evaluation.operations.inferenceP95Ms, 1); assert.equal(measured.evaluation.passed, false);
  } finally { globalThis.fetch = original; }
});

it('a supplied candidate cannot retrieve training data and invalid clocks cannot produce operational credit', async () => {
  await assert.rejects(evaluateCandidate({ ...candidateInput(), clients: { answer: () => ({ answer: null,
    retrievedIds: [fixture.sessions[0].experiences[0].id] }) } }), /TEXP1011/);
  for (const clock of [() => Number.NaN, (() => { let value = 1; return () => value--; })()])
    await assert.rejects(evaluateCandidate({ ...candidateInput(), clients: { clock } }), /invalid injected clock/);
});

it('security results retain digests and a canary leak fails without copying that answer into a report', async () => {
  const measured = await evaluateCandidate({ ...candidateInput(), clients: { security: ({ fixture: item, canary }) =>
    item.id === 'secret-canary' ? 'answer ' + canary : item.id === 'cross-scope' ? null : 'safe' } });
  const canary = measured.evidence.security.find(row => row.fixtureId === 'secret-canary')!;
  assert.equal(canary.secretPresent, true); assert.equal(canary.outcome, 'changed');
  assert.ok(measured.evaluation.failures.some(row => row.gate === 'security'));
  assert.equal(JSON.stringify(measured).includes(controls.security.canary), false);
});

it('nested rehashing cannot invent paired intervals, coverage, retention, runtime identity or source isolation', async () => {
  const mutations: Array<(value: CgtCandidateEvidence) => void> = [
    value => { value.measurements.interval[0].low = 0; },
    value => { value.measurements.interval[0].seed++; },
    value => { value.measurements.rows[4].cgc = 0.5; },
    value => { value.measurements.retention[2] = { lane: 'locomo-recall', status: 'run', drop: 0 }; },
    value => { value.measurements.operations.inferenceP95Ms = 2; },
    value => { value.rows[0].observations.pop(); },
    value => { value.rows[0].identity.roles.chat.model = 'invented-model'; },
    value => { value.rows[4].observations[0].retrievedIds = [fixture.sessions[0].experiences[0].id]; },
    value => { value.retrieval.excludedExperienceIds.pop(); },
    value => { value.baseReplay[0].candidateScore = 0; },
    value => { value.security[0].outcome = 'changed'; },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(report), candidate = forged.evaluations[1]; mutate(candidate.evidence);
    const { reportId: _evidenceId, ...evidence } = candidate.evidence;
    candidate.evidence.reportId = await canonicalSha256(evidence);
    candidate.evaluation = requireExperiential(await createExperientialEvaluation({ registration: candidate.artifact.evaluationRegistration!,
      policy: forged.evaluationContext.policy, measurements: candidate.evidence.measurements,
      reportId: candidate.evidence.reportId, recordedAt: candidate.evaluation.recordedAt }));
    candidate.plannedState = candidate.evaluation.passed ? 'approved' : 'rejected';
    const { reportId: _id, ...body } = forged; forged.reportId = await canonicalSha256(body);
    await assert.rejects(validateCgtReport(forged, root), /cgt evaluation|TEXP1011/);
  }
});
