/**
 * Held-out evaluation: the only place eligibility can come from.
 *
 * A candidate directory is scored against the directory it claims to improve
 * on, over the held-out split and nothing else. A task from the evolve split
 * is refused before a single call is made, because a directory evaluated on
 * the tasks that shaped it measures how well it remembers them. Both
 * conditions run the same bounded executor under their own derived run
 * record, so a pass resumes into itself and the baseline a later candidate is
 * compared with is the one the run already paid for.
 *
 * Eligibility is a gate with named clauses, never a score someone read as
 * good enough: the mean has to improve, no single task may fall further than
 * the tolerance allows, the candidate has to actually answer, the pass has to
 * stay inside its ceiling and nothing may have leaked. Every clause a
 * candidate fails is an issue on the evaluation, so a refusal says which
 * promise was broken rather than that something was wrong.
 */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { trace2SkillIssue, trace2SkillRefuse, type Trace2SkillOutcome } from './errors.ts';
import { byPath } from './identity.ts';
import { planBundleStatus } from './transitions.ts';
import { runRollouts, type RolloutDeps, type RolloutFanOut } from './rollouts.ts';
import type { SkillSnapshot } from './bundle.ts';
import type { Trace2SkillStore } from './store.ts';
import type {
  EvaluationPolicy, EvolutionRun, EvolutionTask, HeldOutResult, SkillBundle, SkillCandidate,
  SkillEvaluation, SkillHead, TaskRollout, Trace2SkillIssue,
} from './contracts.gen.ts';

/** The stage every held-out pass is keyed under; an evolve rollout of one task never replays into it. */
export const EVALUATION_STAGE = 'evaluation';

/**
 * The gate this package applies when a host names none: strict improvement,
 * no task allowed to fall at all, every held-out task answered, no ceiling.
 */
export const DEFAULT_EVALUATION_POLICY: Readonly<EvaluationPolicy> = Object.freeze({
  primaryMetric: 'mean-score',
  regressionTolerance: 0,
  minAnsweredCoverage: 1,
  costCeiling: null,
});

/** A gate's identity. An evaluation records it and a promotion must name the same one. */
export function evaluationPolicyVersionOf(policy: EvaluationPolicy): Promise<string> {
  return canonicalSha256(policy as unknown as Record<string, unknown>);
}

/**
 * The run record one held-out condition executes under. Derived rather than
 * supplied so two conditions of one run cannot share an idempotency key, and
 * content-addressed so the same condition of the same run resumes into its
 * own stored units.
 */
export async function evaluationRunOf(run: EvolutionRun, condition: string, bundleId: string): Promise<EvolutionRun> {
  const id = await canonicalSha256({ run: run.id, stage: EVALUATION_STAGE, condition, s0: bundleId });
  return { ...run, id, s0Id: bundleId, s0Hash: bundleId, status: 'running' };
}

export interface HeldOutDeps extends Omit<RolloutDeps, 'snapshot' | 'condition' | 'stage'> {
  store: Trace2SkillStore;
}

export interface HeldOutPass {
  condition: string;
  run: EvolutionRun;
  fanOut: RolloutFanOut;
}

/** Tasks the held-out split does not contain, which a default policy may never read. */
function offSplit(tasks: readonly EvolutionTask[]): EvolutionTask[] {
  return tasks.filter(task => task.split !== 'test');
}

/**
 * One condition over the held-out split. The split check runs before the run
 * record is written, so a refused evaluation costs nothing and leaves no row.
 */
export async function runHeldOut(
  run: EvolutionRun,
  condition: string,
  snapshot: SkillSnapshot | null,
  tasks: readonly EvolutionTask[],
  deps: HeldOutDeps,
): Promise<Trace2SkillOutcome<HeldOutPass>> {
  const strayed = offSplit(tasks);
  if (strayed.length > 0) {
    return trace2SkillRefuse<HeldOutPass>('TT2S1006', `/tasks/${strayed[0].id}`,
      `${strayed.length} task(s) of the evolve split reached a held-out evaluation`);
  }
  const bundleId = snapshot === null ? run.s0Hash : snapshot.bundle.id;
  const derived = await evaluationRunOf(run, condition, bundleId);
  const written = await deps.store.putRun(derived);
  if (!written.valid) return { valid: false, issues: written.issues };
  const fanOut = await runRollouts(written.value, tasks, { ...deps, snapshot, condition, stage: EVALUATION_STAGE });
  // The pass owns the run record it derived, so it is the thing that settles
  // it. `completed` here says the pass reached its end, not that every rollout
  // in it answered: a rollout that refused is a row of its own, counted in the
  // fan-out, and a pass that re-ran to the same end would otherwise be unable
  // to settle a record an earlier attempt had already called refused.
  const settled = await deps.store.markRun(written.value.id, 'completed');
  if (!settled.valid) return { valid: false, issues: settled.issues };
  return { valid: true, value: { condition, run: settled.value, fanOut } };
}

export interface EvaluationInput {
  candidate: SkillCandidate;
  /** The directory the candidate stages, already sealed and stored. */
  snapshot: SkillSnapshot;
  /** The directory it claims to improve on, and the row name that condition carries. */
  baseline: SkillSnapshot;
  baselineCondition: string;
  candidateCondition?: string;
  tasks: readonly EvolutionTask[];
  /** The head this evaluation is registered against; a promotion must find the same one. */
  expectedHead: SkillHead;
  policy?: EvaluationPolicy;
}

export interface EvaluationCounts { calls: number, written: number, reused: number, refused: number }

export interface EvaluationResult {
  evaluation: SkillEvaluation | null;
  policy: EvaluationPolicy;
  baseline: HeldOutPass | null;
  candidate: HeldOutPass | null;
  counts: EvaluationCounts;
  issues: Trace2SkillIssue[];
}

/** A held-out task as the pair of scores the gate reads. */
function pairResults(baseline: RolloutFanOut, candidate: RolloutFanOut): HeldOutResult[] {
  const scoreOf = (rollout: TaskRollout | null): number => rollout?.evaluation.score ?? 0;
  const byTask = new Map(baseline.units.map(unit => [unit.taskId, unit.rollout]));
  return [...candidate.units]
    .sort((left, right) => byPath(left.taskId, right.taskId))
    .map(unit => ({
      taskId: unit.taskId,
      baselineScore: scoreOf(byTask.get(unit.taskId) ?? null),
      candidateScore: scoreOf(unit.rollout),
      label: (unit.rollout?.label ?? 'unanswered') as HeldOutResult['label'],
    }));
}

export interface EligibilitySummary {
  results: readonly HeldOutResult[];
  meanDelta: number;
  answered: number;
  failures: number;
  leakage: number;
  tokens: number;
}

/**
 * Every clause the gate applies, each as its own issue. A candidate that
 * fails two clauses says so twice: the report prints which promise broke,
 * not that the number was disappointing.
 */
export function eligibilityIssuesOf(policy: EvaluationPolicy, summary: EligibilitySummary): Trace2SkillIssue[] {
  const issues: Trace2SkillIssue[] = [];
  const tasks = summary.results.length;
  if (tasks === 0) {
    issues.push(trace2SkillIssue('TT2S1010', '/results', 'a held-out evaluation with no task decides nothing'));
    return issues;
  }
  if (!(summary.meanDelta > 0)) {
    issues.push(trace2SkillIssue('TT2S1010', '/meanDelta',
      `the candidate does not improve the primary metric (${summary.meanDelta.toFixed(4)})`));
  }
  for (const result of summary.results) {
    if (result.baselineScore - result.candidateScore > policy.regressionTolerance) {
      issues.push(trace2SkillIssue('TT2S1010', `/results/${result.taskId}`,
        `the candidate falls ${(result.baselineScore - result.candidateScore).toFixed(4)} on this held-out task, past the tolerance`));
    }
  }
  const coverage = summary.answered / tasks;
  if (coverage < policy.minAnsweredCoverage) {
    issues.push(trace2SkillIssue('TT2S1010', '/minAnsweredCoverage',
      `the candidate answered ${coverage.toFixed(4)} of the held-out split, under the floor`));
  }
  if (policy.costCeiling !== null && summary.tokens > policy.costCeiling) {
    issues.push(trace2SkillIssue('TT2S1010', '/costCeiling',
      `the held-out pass spent ${summary.tokens} tokens, over the ceiling`));
  }
  if (summary.failures > 0) {
    issues.push(trace2SkillIssue('TT2S1010', '/failures', `${summary.failures} held-out unit(s) did not execute`));
  }
  if (summary.leakage > 0) {
    issues.push(trace2SkillIssue('TT2S1006', '/leakage', `${summary.leakage} leakage attempt(s) were counted during the evaluation`));
  }
  return issues;
}

const EMPTY_COUNTS = (): EvaluationCounts => ({ calls: 0, written: 0, reused: 0, refused: 0 });

/**
 * The whole evaluation stage. A run that already recorded an evaluation for
 * this candidate replays it: the record binds an expected head, so
 * recomputing it after the head moved would mint a second identity for one
 * measurement.
 */
export async function evaluateCandidate(run: EvolutionRun, input: EvaluationInput, deps: HeldOutDeps): Promise<EvaluationResult> {
  const policy = input.policy ?? DEFAULT_EVALUATION_POLICY;
  const counts = EMPTY_COUNTS();
  const issues: Trace2SkillIssue[] = [];
  const rows = await deps.store.listBy(run.scopeKey, 'evaluations');
  const stored = rows.find(row => !('kind' in row)
    && row.runId === run.id && row.candidateBundleId === input.candidate.bundleId) as SkillEvaluation | undefined;
  if (stored !== undefined) {
    counts.reused++;
    return { evaluation: stored, policy, baseline: null, candidate: null, counts, issues };
  }

  const before = deps.adapter.counts.leakage;
  const baseline = await runHeldOut(run, input.baselineCondition, input.baseline, input.tasks, deps);
  if (!baseline.valid) {
    counts.refused++;
    issues.push(...baseline.issues);
    return { evaluation: null, policy, baseline: null, candidate: null, counts, issues };
  }
  const candidate = await runHeldOut(run, input.candidateCondition ?? 'evolved-s-star', input.snapshot, input.tasks, deps);
  if (!candidate.valid) {
    counts.refused++;
    issues.push(...candidate.issues);
    return { evaluation: null, policy, baseline: baseline.value, candidate: null, counts, issues };
  }
  for (const pass of [baseline.value, candidate.value]) {
    counts.calls += pass.fanOut.counts.calls;
    counts.written += pass.fanOut.counts.written;
    counts.reused += pass.fanOut.counts.reused;
    counts.refused += pass.fanOut.counts.refused;
    issues.push(...pass.fanOut.issues);
  }

  const results = pairResults(baseline.value.fanOut, candidate.value.fanOut);
  const meanDelta = results.reduce((total, result) => total + (result.candidateScore - result.baselineScore), 0) / (results.length || 1);
  const tokensOf = (pass: HeldOutPass): number => pass.fanOut.rollouts.reduce((total, rollout) => total + rollout.spend.tokens, 0);
  const summary: EligibilitySummary = {
    results,
    meanDelta,
    answered: results.filter(result => result.label !== 'unanswered').length,
    failures: candidate.value.fanOut.counts.refused,
    leakage: deps.adapter.counts.leakage - before,
    tokens: tokensOf(candidate.value),
  };
  const clauses = eligibilityIssuesOf(policy, summary);
  const payload = {
    runId: run.id,
    scopeKey: run.scopeKey,
    baselineBundleId: input.baseline.bundle.id,
    candidateBundleId: input.candidate.bundleId,
    executorIdentityId: deps.modelIdentity,
    split: 'test' as const,
    testHash: run.testHash,
    results,
    meanDelta,
    costDelta: tokensOf(candidate.value) - tokensOf(baseline.value),
    failures: summary.failures,
    skips: results.filter(result => result.label === 'unanswered').length,
    leakage: summary.leakage,
    eligible: clauses.length === 0,
    policyVersion: await evaluationPolicyVersionOf(policy),
    expectedHead: input.expectedHead,
    issues: clauses,
  };
  const evaluation: SkillEvaluation = { id: await canonicalSha256(payload), ...payload };
  const written = await deps.store.putEvaluation(evaluation);
  if (!written.valid) {
    issues.push(...written.issues);
    return { evaluation: null, policy, baseline: baseline.value, candidate: candidate.value, counts, issues };
  }
  counts.written++;
  deps.trajectory?.add({
    kind: 'evaluation', evaluationId: evaluation.id, candidateBundleId: evaluation.candidateBundleId,
    meanDelta: evaluation.meanDelta, eligible: evaluation.eligible,
  });
  return { evaluation: written.value, policy, baseline: baseline.value, candidate: candidate.value, counts, issues };
}

/**
 * What the evaluation entitles the candidate directory to. Eligibility is the
 * evaluation's verdict written onto the directory once; a directory already
 * carrying that verdict is left alone, so a second pass writes nothing.
 */
export async function settleCandidateStatus(
  store: Trace2SkillStore,
  bundleId: string,
  evaluation: SkillEvaluation,
): Promise<Trace2SkillOutcome<SkillBundle>> {
  const next: SkillBundle['status'] = evaluation.eligible ? 'eligible' : 'rejected';
  const bundle = await store.getBundle(bundleId);
  if (!bundle.valid) return bundle;
  // A directory a host already activated carries the verdict and more; writing
  // the verdict again would be a second decision about a settled directory.
  if (bundle.value.status === next || bundle.value.status === 'active' || bundle.value.status === 'archived') return bundle;
  const planned = planBundleStatus(bundle.value.status, next);
  if (!planned.valid) return { valid: false, issues: planned.issues };
  return store.markBundle(bundleId, next);
}
