/**
 * The held-out half: a candidate is judged only on tasks that never shaped it,
 * every gate clause is named on its own, and a verdict already recorded is
 * replayed rather than minted a second time.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryTrace2SkillStore, DEFAULT_EVALUATION_POLICY, eligibilityIssuesOf, evaluateCandidate,
  evaluationPolicyVersionOf, evaluationRunOf, runHeldOut, settleCandidateStatus,
  type EvaluationPolicy, type HeldOutDeps, type HeldOutResult, type SkillChatClient,
} from '@tangleai/trace2skill';
import { lifecycleRecords, runRecord, taskRecords, testAdapter } from './fixture.ts';

const IDS = ['task-02', 'task-04'];
const TASKS = IDS.map((id, index) => ({ id, prompt: `count ${id}`, input: 'a,b\n1,2\n', answer: String(index + 7) }));
const ANSWERS = new Map(TASKS.map(task => [task.id, task.answer]));

/** A wire that only knows the answer when the directory it was handed carries the added page. */
function directorySensitive(taskId: string): SkillChatClient {
  return {
    endpoint: { provider: 'scripted' },
    async complete(request: unknown) {
      const body = request as { messages?: Array<{ role: string, content: string }> };
      const system = body.messages?.find(message => message.role === 'system')?.content ?? '';
      const content = system.includes('units.md') ? ANSWERS.get(taskId) ?? '' : 'no idea';
      return { message: { role: 'assistant', content }, finishReason: 'stop', usage: { total_tokens: 64 } };
    },
  };
}

async function base() {
  const records = await lifecycleRecords();
  const store = createMemoryTrace2SkillStore();
  assert.ok((await store.putSnapshot(records.frozen)).valid);
  assert.ok((await store.putStagedCandidate(records.evolved, records.candidate)).valid);
  const adapter = testAdapter(TASKS);
  const deps: HeldOutDeps = {
    store, adapter, modelIdentity: 'scripted', now: () => 0,
    client: (task) => directorySensitive(task.id),
  };
  const run = runRecord({ s0Hash: records.frozen.bundle.id, testHash: '7'.repeat(64) });
  return { records, store, adapter, deps, run };
}

it('a held-out pass refuses an evolve task before it writes or spends anything', async () => {
  const { records, store, deps, run } = await base();
  const before = store.stats().writes;
  const refused = await runHeldOut(run, 'frozen-s0', records.frozen, taskRecords(IDS, 'evolve'), deps);
  assert.ok(!refused.valid);
  assert.equal(refused.issues[0].code, 'TT2S1006');
  assert.equal(store.stats().writes, before, 'a refused evaluation writes no run record');

  const evaluated = await evaluateCandidate(run, {
    candidate: records.candidate, snapshot: records.evolved, baseline: records.frozen,
    baselineCondition: 'frozen-s0', tasks: taskRecords(IDS, 'evolve'),
    expectedHead: { versionId: records.frozen.bundle.id, revision: 1 },
  }, deps);
  assert.equal(evaluated.evaluation, null);
  assert.equal(evaluated.counts.refused, 1, 'the refusal is a counted value');
  assert.equal(evaluated.counts.calls, 0);
  assert.equal(evaluated.issues[0].code, 'TT2S1006');
});

it('two conditions of one run never share a derived run record', async () => {
  const { records, run } = await base();
  const baseline = await evaluationRunOf(run, 'frozen-s0', records.frozen.bundle.id);
  const candidate = await evaluationRunOf(run, 'evolved-s-star', records.evolved.bundle.id);
  const again = await evaluationRunOf(run, 'frozen-s0', records.frozen.bundle.id);
  assert.notEqual(baseline.id, candidate.id);
  assert.equal(baseline.id, again.id, 'the same condition resumes into its own record');
  assert.equal(baseline.s0Hash, records.frozen.bundle.id);
  assert.equal(candidate.s0Hash, records.evolved.bundle.id);
});

it('the candidate is scored against its parent over the held-out split and recorded once', async () => {
  const { records, store, deps, run } = await base();
  const head = { versionId: records.frozen.bundle.id, revision: 1 };
  const input = {
    candidate: records.candidate, snapshot: records.evolved, baseline: records.frozen,
    baselineCondition: 'frozen-s0', tasks: taskRecords(IDS, 'test'), expectedHead: head,
  };
  const evaluated = await evaluateCandidate(run, input, deps);
  const evaluation = evaluated.evaluation;
  assert.ok(evaluation !== null, JSON.stringify(evaluated.issues));
  assert.equal(evaluation.split, 'test');
  assert.equal(evaluation.results.length, 2);
  assert.equal(evaluation.meanDelta, 1);
  assert.equal(evaluation.eligible, true);
  assert.deepEqual(evaluation.issues, []);
  assert.equal(evaluation.candidateBundleId, records.evolved.bundle.id);
  assert.equal(evaluation.baselineBundleId, records.frozen.bundle.id);
  assert.deepEqual(evaluation.expectedHead, head);
  assert.equal(evaluation.policyVersion, await evaluationPolicyVersionOf(DEFAULT_EVALUATION_POLICY));
  assert.ok(evaluated.counts.calls > 0);

  // The record binds an expected head, so a second pass replays it instead of
  // minting a second identity for one measurement.
  const replay = await evaluateCandidate(run, { ...input, expectedHead: { versionId: 'x'.repeat(64), revision: 9 } }, deps);
  assert.equal(replay.evaluation?.id, evaluation.id);
  assert.deepEqual(replay.evaluation?.expectedHead, head);
  assert.equal(replay.counts.calls, 0);
  assert.equal(replay.counts.written, 0);
  assert.equal((await store.listBy(run.scopeKey, 'evaluations')).length, 1);
});

it('each gate clause refuses on its own and names the promise it broke', () => {
  const results = (deltas: ReadonlyArray<[number, number]>, unanswered = 0): HeldOutResult[] =>
    deltas.map(([baselineScore, candidateScore], index) => ({
      taskId: `task-0${index + 1}`, baselineScore, candidateScore,
      label: index < unanswered ? 'unanswered' as const : 'success' as const,
    }));
  const summary = (over: Partial<Parameters<typeof eligibilityIssuesOf>[1]> = {}) => ({
    results: results([[0, 1], [0, 1]]), meanDelta: 1, answered: 2, failures: 0, leakage: 0, tokens: 0, ...over,
  });
  const paths = (policy: EvaluationPolicy, over: Parameters<typeof summary>[0]): string[] =>
    eligibilityIssuesOf(policy, summary(over)).map(issue => issue.path);

  assert.deepEqual(eligibilityIssuesOf(DEFAULT_EVALUATION_POLICY, summary()), []);
  assert.deepEqual(paths(DEFAULT_EVALUATION_POLICY, { results: results([[1, 0], [1, 0]]), meanDelta: -1 }),
    ['/meanDelta', '/results/task-01', '/results/task-02']);
  assert.deepEqual(paths(DEFAULT_EVALUATION_POLICY, { results: results([[0, 1], [0, 1]], 1), answered: 1 }), ['/minAnsweredCoverage']);
  assert.deepEqual(paths({ ...DEFAULT_EVALUATION_POLICY, costCeiling: 10 }, { tokens: 11 }), ['/costCeiling']);
  assert.deepEqual(paths(DEFAULT_EVALUATION_POLICY, { failures: 2 }), ['/failures']);
  assert.deepEqual(eligibilityIssuesOf(DEFAULT_EVALUATION_POLICY, summary({ leakage: 3 })).map(issue => issue.code), ['TT2S1006']);
  assert.deepEqual(paths(DEFAULT_EVALUATION_POLICY, { results: [], meanDelta: 0, answered: 0 }), ['/results']);
  // A tolerance widens the single-task clause without widening the mean.
  assert.deepEqual(paths({ ...DEFAULT_EVALUATION_POLICY, regressionTolerance: 1 }, { results: results([[1, 0], [0, 1]]), meanDelta: 0 }), ['/meanDelta']);
});

it('the verdict is written onto the directory once and never over a settled one', async () => {
  const { records, store, deps, run } = await base();
  const evaluated = await evaluateCandidate(run, {
    candidate: records.candidate, snapshot: records.evolved, baseline: records.frozen,
    baselineCondition: 'frozen-s0', tasks: taskRecords(IDS, 'test'),
    expectedHead: { versionId: records.frozen.bundle.id, revision: 1 },
  }, deps);
  const evaluation = evaluated.evaluation;
  assert.ok(evaluation !== null);
  const first = await settleCandidateStatus(store, evaluation.candidateBundleId, evaluation);
  assert.ok(first.valid);
  assert.equal(first.value.status, 'eligible');
  const writes = store.stats().writes;
  const again = await settleCandidateStatus(store, evaluation.candidateBundleId, evaluation);
  assert.ok(again.valid);
  assert.equal(store.stats().writes, writes, 'a settled verdict is not written twice');

  // An ineligible verdict rejects the directory, and a rejected one never moves.
  const rejectedStore = createMemoryTrace2SkillStore();
  assert.ok((await rejectedStore.putStagedCandidate(records.evolved, records.candidate)).valid);
  const ineligible = { ...evaluation, eligible: false, issues: [{ code: 'TT2S1010' as const, path: '/meanDelta', detail: 'no improvement' }] };
  const rejected = await settleCandidateStatus(rejectedStore, evaluation.candidateBundleId, ineligible);
  assert.ok(rejected.valid);
  assert.equal(rejected.value.status, 'rejected');
  const stuck = await settleCandidateStatus(rejectedStore, evaluation.candidateBundleId, evaluation);
  assert.ok(!stuck.valid);
  assert.equal(stuck.issues[0].code, 'TT2S1001');
});
