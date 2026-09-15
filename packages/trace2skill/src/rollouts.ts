/**
 * The labeled rollouts a run learns from.
 *
 * One bounded execution per task against one frozen directory, fanned out
 * under the run's concurrency and ordered by task id rather than by whoever
 * finished first — an ordering that depends on latency is not reproducible.
 * Every unit carries an idempotency key over the run, the task, the attempt
 * and everything that changes the answer, so a resumed run reuses exactly the
 * units it already paid for and a retry lands beside its predecessor instead
 * of overwriting it.
 *
 * Nothing here throws for a content failure. A refused preparation, a spent
 * run budget, a stale frozen directory and a second result under one key are
 * each a counted issue on the unit that produced it, and the fan-out keeps
 * going: a run that hides the units it could not execute cannot be read as a
 * measurement.
 */
import { mapConcurrent } from '@jarenjs/core/async';
import { MasBudgetStop } from '@tangleai/mas';
import { trace2SkillIssue, type Trace2SkillOutcome } from './errors.ts';
import { byPath, idempotencyKeyOf } from './identity.ts';
import { assertFrozenBase } from './transitions.ts';
import { createSkillExecutor, isUnansweredStop, type SkillChatClient } from './executor.ts';
import { trace2SkillPrompt } from './artifacts.ts';
import type { SkillSnapshot } from './bundle.ts';
import type { Trace2SkillTaskAdapter } from './adapter.ts';
import type { Trace2SkillStore } from './store.ts';
import type {
  EvolutionRun, EvolutionTask, TaskEvaluation, TaskRollout, Trace2SkillIssue, Trace2SkillPromptArtifact,
} from './contracts.gen.ts';

export const ROLLOUT_STAGE = 'rollout';

export interface RolloutDeps {
  store: Trace2SkillStore;
  adapter: Trace2SkillTaskAdapter;
  /**
   * The run's client, already wrapped by its shared budget account so a
   * ceiling is reserved before dispatch. A host whose wire is addressed by
   * unit rather than by request body may instead bind one client per unit;
   * every one of them shares the same account, or the run-wide ceiling stops
   * bounding the fan-out.
   */
  client: SkillChatClient | ((task: EvolutionTask) => SkillChatClient);
  /** The frozen directory, or null for the no-skill condition. */
  snapshot: SkillSnapshot | null;
  condition: string;
  /** The stage a key is scoped to; a unit of one stage never replays into another. */
  stage?: string;
  /** What the answer depends on besides the prompt: the resolved model configuration. */
  modelIdentity: string;
  /** The compiled executor pack every unit renders through; the default is the published one. */
  prompt?: Trace2SkillPromptArtifact;
  promptVersion?: string;
  attempt?: number;
  maxToolRounds?: number;
  now?: () => number;
  /** The run's orchestration log; one coarse entry per unit. */
  trajectory?: { add(entry: unknown): unknown };
}

export interface RolloutUnit {
  taskId: string;
  attempt: number;
  idempotencyKey: string;
  rollout: TaskRollout | null;
  /** True when the stored attempt answered and no call was made. */
  reused: boolean;
  calls: number;
  issues: Trace2SkillIssue[];
}

export interface RolloutCounts {
  success: number; failure: number; unanswered: number;
  refused: number; reused: number; written: number; calls: number;
}

export interface RolloutFanOut {
  units: RolloutUnit[];
  rollouts: TaskRollout[];
  counts: RolloutCounts;
  issues: Trace2SkillIssue[];
}

const EMPTY_EVALUATION = (evaluatorId: string, detail: string): TaskEvaluation => ({ evaluatorId, score: 0, detail });

/** The one fan-out: results follow task ids, and a failure never stops dispatch. */
export async function runRollouts(run: EvolutionRun, tasks: readonly EvolutionTask[], deps: RolloutDeps): Promise<RolloutFanOut> {
  const attempt = deps.attempt ?? 1;
  const ordered = [...tasks].sort((left, right) => byPath(left.id, right.id));
  const stored = await deps.store.listBy(run.id, 'rollouts');
  const known = new Map(stored.map(rollout => [rollout.idempotencyKey, rollout]));
  const s0Hash = deps.snapshot === null ? run.s0Hash : deps.snapshot.bundle.id;
  const artifact = deps.prompt ?? trace2SkillPrompt('executor');
  const promptVersion = deps.promptVersion ?? artifact.revision;

  const worker = async (task: EvolutionTask): Promise<RolloutUnit> => {
    const issues: Trace2SkillIssue[] = [];
    const key = await idempotencyKeyOf({
      runId: run.id, stage: deps.stage ?? ROLLOUT_STAGE, unit: task.id, attempt,
      inputHashes: [s0Hash, deps.adapter.toolManifestHash], identityId: deps.modelIdentity,
      promptVersion,
    });
    const unit: RolloutUnit = { taskId: task.id, attempt, idempotencyKey: key, rollout: null, reused: false, calls: 0, issues };
    const replay = known.get(key);
    if (replay !== undefined) {
      deps.trajectory?.add({ kind: 'rollout', taskId: task.id, attempt, rolloutId: replay.id, stopReason: replay.stopReason, spend: replay.spend, reused: true });
      return { ...unit, rollout: replay, reused: true };
    }

    const base = assertFrozenBase(run, s0Hash, '/s0Hash');
    if (!base.valid) { issues.push(...base.issues); return unit; }

    const prepared = deps.adapter.prepare(task.id);
    if (!prepared.valid) { issues.push(...prepared.issues); return unit; }

    const executor = createSkillExecutor({
      client: typeof deps.client === 'function' ? deps.client(task) : deps.client,
      adapter: deps.adapter, task: prepared.value, snapshot: deps.snapshot,
      budget: run.budgets, prompt: artifact, promptVersion,
      ...(deps.maxToolRounds === undefined ? {} : { maxToolRounds: deps.maxToolRounds }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
    });
    if (!executor.valid) { issues.push(...executor.issues); return unit; }

    let executed;
    try { executed = await executor.value.run(); }
    catch (cause) {
      if (!(cause instanceof MasBudgetStop)) throw cause;
      issues.push(trace2SkillIssue('TT2S1009', `/tasks/${task.id}`, `the run budget stopped this unit before dispatch (${cause.reason})`, cause));
      deps.trajectory?.add({ kind: 'rollout', taskId: task.id, attempt, rolloutId: null, stopReason: `run-${cause.reason}`, spend: { calls: 0, tokens: 0, cost: null } });
      return unit;
    }
    if (!executed.valid) { issues.push(...executed.issues); return unit; }
    const result = executed.value;
    unit.calls = result.spend.calls;

    // The stop decides whether there is an answer at all; the evaluator then
    // decides whether the answer is right. Reading them in the other order
    // would score the sentence a spent budget emits.
    const answered = !isUnansweredStop(result.stopReason) && result.finalAnswer !== '';
    const verdict = answered ? deps.adapter.evaluate(task.id, result.finalAnswer) : null;
    if (verdict !== null && !verdict.valid) { issues.push(...verdict.issues); return unit; }
    const evaluation = verdict === null
      ? EMPTY_EVALUATION(deps.adapter.evaluatorId, `the executor stopped as ${result.stopReason} without an answer`)
      : verdict.value;
    const label: TaskRollout['label'] = !answered ? 'unanswered' : evaluation.score >= 1 ? 'success' : 'failure';

    const payload = {
      runId: run.id, taskId: task.id, s0Hash, condition: deps.condition, attempt,
      messages: result.messages, reasoning: result.reasoning, steps: result.steps,
      finalAnswer: result.finalAnswer, artifacts: [], evaluation, label,
      stopReason: result.stopReason, spend: result.spend, idempotencyKey: key,
    };
    // The attempt key IS the row's address, so a second result for one unit
    // meets the immutable store rather than landing beside its predecessor.
    const rollout: TaskRollout = { id: key, ...payload };
    const written = await deps.store.putRollout(rollout);
    if (!written.valid) {
      issues.push(trace2SkillIssue('TT2S1007', `/rollouts/${key}`, 'a second result was written for one idempotency key', written.issues[0]));
      return unit;
    }
    deps.trajectory?.add({ kind: 'rollout', taskId: task.id, attempt, rolloutId: rollout.id, stopReason: rollout.stopReason, spend: rollout.spend, reused: false });
    return { ...unit, rollout: written.value };
  };

  const units = await mapConcurrent(ordered, run.concurrency, worker);
  const counts: RolloutCounts = { success: 0, failure: 0, unanswered: 0, refused: 0, reused: 0, written: 0, calls: 0 };
  const issues: Trace2SkillIssue[] = [];
  const rollouts: TaskRollout[] = [];
  for (const unit of units) {
    counts.calls += unit.calls;
    issues.push(...unit.issues);
    if (unit.rollout === null) { counts.refused++; continue; }
    rollouts.push(unit.rollout);
    if (unit.reused) counts.reused++; else counts.written++;
    counts[unit.rollout.label]++;
  }
  return { units, rollouts, counts, issues };
}

/**
 * Whether a fan-out over stored units asked the wire for anything. Every stage
 * that resumes is judged by the same two numbers, so "it replayed" means one
 * thing across the run rather than one thing per stage.
 */
export function isReplayOnly(fanOut: { counts: { calls: number, written: number } }, at = '/rollouts'): Trace2SkillOutcome<null> {
  if (fanOut.counts.calls === 0 && fanOut.counts.written === 0) return { valid: true, value: null };
  return {
    valid: false,
    issues: [trace2SkillIssue('TT2S1012', at,
      `a replay spent ${fanOut.counts.calls} calls and wrote ${fanOut.counts.written} rows`)],
  };
}
