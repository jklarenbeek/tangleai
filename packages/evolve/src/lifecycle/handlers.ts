/**
 * The task handlers, bound over the stage functions the host already owns.
 *
 * Every handler here obeys one rule: **a dispatch writes an intent and
 * enqueues; it never runs the work.** The work happens in the effect
 * worker, in another process, holding the job lease the segment is not
 * given. A handler that called `driver.run` would double-claim, and the
 * effect store would refuse it — so the split is not a style choice, it
 * is what the fence requires.
 *
 * The readbacks are the mirror: they touch no job, spawn nothing, and
 * read the effect record alone. That is what lets a resumed experiment
 * reproduce its measurement instead of taking it again.
 *
 * Nothing here decides what evidence MEANS. `evolve-decide` calls the
 * campaign's one planner, and the planner is the only place a verdict
 * becomes a decision.
 */

import type { MasTaskHandlerBinding, MasTaskInput } from '@tangleai/mas';

import type { EvolveOutcome, EvolveIssue } from '../errors.ts';
import type { EvolveBudgets, Direction } from '../contracts.gen.ts';
import { planExperimentDecision } from '../decide.ts';
import type { PreparedPatch } from '../patch.ts';
import type { EffectPlan, EffectPreparation } from '../host/driver.ts';
import type { WorktreeHost } from '../host/worktree.ts';
import type { Transcript } from '../host/classify.ts';
import { gatePlan, readGateResult, type GateLeg } from '../host/gate.ts';
import { measurePlan, readMeasurement, INSTRUMENT_COMMAND, BASE_INSTRUMENT_COMMAND } from '../host/measure.ts';
import { isolatePlan, commitPlan } from '../host/apply.ts';

import {
  decided, decide, counted, settled, uncertain, measures, readSettlement,
  type EvolveEnvelope,
} from './state.ts';
import { EVOLVE_EFFECT_STAGES, type EvolveEffectStage } from './registry.ts';

/** The queue a dispatch hands its prepared plan to. Injected, never imported. */
export interface LifecycleJobQueue {
  /** Enqueue this plan's own job. Enqueuing the same plan twice is a read. */
  enqueue(plan: EffectPlan): Promise<unknown>;
}

/** The driver half a dispatch is allowed to reach: prepare, never run. */
export interface LifecyclePreparer {
  prepare(plan: EffectPlan): Promise<EvolveOutcome<EffectPreparation>>;
}

export interface LifecycleEffectReader {
  get(id: string): Promise<unknown>;
}

/** Everything one experiment's stages need, supplied by the host. */
export interface LifecycleContext {
  preparer: LifecyclePreparer;
  jobs: LifecycleJobQueue;
  effects: LifecycleEffectReader;
  host: WorktreeHost;
  transcript: Transcript;
  experimentId: string;
  worktreePath: string;
  repositoryRoot: string;
  baseRevision: string;
  budgets: EvolveBudgets;
  gateArgs: readonly string[];
  instrumentArgs: readonly string[];
  metric: { name: string, direction: Direction };
  truth: number;
  minDelta?: number;
  /** Prepared by the caller: 04's refiner output, or its refusal. */
  prepared: EvolveOutcome<PreparedPatch>;
  /** Turn a refusal into the decision the planner would have reached. */
  decideRefusal: (issues: EvolveIssue[]) => {
    decision: 'kept' | 'abandoned' | 'refused' | 'uncertain',
    reason: EvolveEnvelope['decision'] extends null ? never : NonNullable<EvolveEnvelope['decision']>['reason'],
    code: NonNullable<EvolveEnvelope['decision']>['code'],
  };
  /** Record the outcome. Idempotent by key in the outcome service. */
  record: (env: EvolveEnvelope) => Promise<void>;
  /** Remove the worktree, keep or delete the branch, write the bundle. */
  settle: (env: EvolveEnvelope) => Promise<EvolveOutcome<{ legs: number }>>;
}

const envelopeOf = (input: MasTaskInput): EvolveEnvelope =>
  input.value.env as EvolveEnvelope;

/** The plan each effect stage dispatches. One place, so ids cannot drift. */
export function planFor(stage: EvolveEffectStage, context: LifecycleContext): EffectPlan | null {
  const { experimentId, worktreePath } = context;
  switch (stage) {
    case 'isolate':
      // The write plan is 04's, already validated against the immutable
      // surface. A dispatch cannot invent one.
      if (!context.prepared.ok) return null;
      return isolatePlan({
        experimentId, worktreePath, baseRevision: context.baseRevision,
        plan: context.prepared.value.plan,
      });
    case 'apply':
      return commitPlan({ experimentId, worktreePath, message: 'Apply ' + experimentId });
    case 'gate':
    case 'gate-rerun':
      return gatePlan({
        experimentId, leg: stage as GateLeg, args: context.gateArgs, worktreePath,
      });
    case 'measure-base':
      return measurePlan({
        experimentId, side: 'measure-base', name: BASE_INSTRUMENT_COMMAND,
        args: context.instrumentArgs, cwd: context.repositoryRoot, samples: context.budgets.samples,
      });
    case 'measure-candidate':
      return measurePlan({
        experimentId, side: 'measure-candidate', name: INSTRUMENT_COMMAND,
        args: context.instrumentArgs, cwd: worktreePath, samples: context.budgets.samples,
      });
    case 'settle':
      // Settlement is driven by the host rather than by a plan builder:
      // what it removes depends on the decision the planner just made.
      return null;
  }
}

/**
 * How many legs a stage contributes to the census when it settles.
 *
 * These are the plans' own leg counts, not an estimate: isolate carries
 * `create` and `write-files`, apply carries `commit`, and a measurement
 * side carries one leg per registered sample. The sequential path adds
 * the same numbers by hand, and the row census has to reconcile with
 * both.
 */
export function legsFor(stage: EvolveEffectStage, budgets: EvolveBudgets): number {
  if (stage === 'isolate') return 2;
  if (stage === 'measure-base' || stage === 'measure-candidate') return budgets.samples;
  // Settling is cleanup, not evidence. The sequential path counts no leg
  // for it, and the published census must reconcile with that: a kept
  // experiment reports 10 legs (2 + 1 + 1 + 3 + 3), not 11.
  if (stage === 'settle') return 0;
  return 1;
}

/** Whether this stage runs at all, given what the envelope already holds. */
export function stageRuns(stage: EvolveEffectStage, env: EvolveEnvelope): boolean {
  if (decided(env)) return false;
  if (stage === 'gate-rerun') return env.gate === 'red';
  if (stage === 'measure-base' || stage === 'measure-candidate') return measures(env);
  return true;
}

export function createEvolveLifecycleHandlers(
  context: LifecycleContext,
): Record<string, MasTaskHandlerBinding> {
  const handlers: Record<string, MasTaskHandlerBinding> = {};

  handlers['evolve-propose'] = (input: MasTaskInput) => {
    const env = envelopeOf(input);
    // 04 already decided whether this patch may be applied at all. A
    // refusal here is the whole reason nine of the sixteen registered
    // proposals never reach a worktree: they are refused before anything
    // could run, at zero process cost.
    if (!context.prepared.ok) {
      return { env: decide(env, context.decideRefusal(context.prepared.issues) as never) };
    }
    return { env };
  };

  for (const stage of EVOLVE_EFFECT_STAGES) {
    handlers['evolve-dispatch-' + stage] = async (input: MasTaskInput) => {
      const env = envelopeOf(input);
      if (!stageRuns(stage, env)) return { env };
      const plan = planFor(stage, context);
      if (plan === null) return { env };

      // Write the intent BEFORE anything reaches the world, then hand the
      // job to the queue. A plan already held replays: preparing is a read.
      const preparation = await context.preparer.prepare(plan);
      if (!preparation.ok) return { env: uncertain(env) };
      if (preparation.value.replayed !== null) return { env };

      await context.jobs.enqueue(plan);
      return { env };
    };

    handlers['evolve-read-' + stage] = async (input: MasTaskInput) => {
      const env = envelopeOf(input);
      if (!stageRuns(stage, env)) return { env };

      const answer = readSettlement(input.value.settled);
      // A leg nobody can account for is terminal and is NOT a verdict
      // about the change: the worker deliberately leaves it unanswered.
      if (answer === null || answer.state === 'unresolved') return { env: uncertain(env) };

      const plan = planFor(stage, context);
      let next = counted(env, legsFor(stage, context.budgets));
      if (plan !== null) next = settled(next, plan.id);

      if (stage === 'gate' || stage === 'gate-rerun') {
        const read = await readGateResult({
          effects: context.effects, host: context.host,
          experimentId: context.experimentId, worktreePath: context.worktreePath,
          budgets: context.budgets, leg: stage as GateLeg, transcript: context.transcript,
        });
        if (!read.ok) return { env: uncertain(next) };
        next = stage === 'gate'
          ? { ...next, gate: read.value.verdict }
          : { ...next, rerun: read.value.verdict };
        return { env: next };
      }

      if (stage === 'measure-base') {
        // The seal is the worker's, taken on both sides of the base batch.
        // A base that moved voids every number in the run, so this is not
        // a measurement failure — it is an uncertain experiment.
        const evidence = answer.evidence ?? {};
        if (evidence.sealHeld === false) return { env: uncertain(next) };
        return { env: next };
      }

      return { env: next };
    };
  }

  handlers['evolve-no-rerun'] = (input: MasTaskInput) => ({ env: envelopeOf(input) });

  handlers['evolve-read-fitness'] = async (input: MasTaskInput) => {
    const env = envelopeOf(input);
    if (!measures(env)) return { env };
    const measured = await readMeasurement({
      effects: context.effects,
      experimentId: context.experimentId,
      samples: context.budgets.samples,
      truth: context.truth,
      metric: context.metric,
      minDelta: context.minDelta,
      transcript: context.transcript,
    });
    if (!measured.ok) {
      // A base that moved or a lost leg is uncertain; anything else is an
      // ABSENCE of evidence, which the planner reads as unverifiable
      // rather than as a regression.
      const fatal = measured.issues.some(one => one.code === 'TEVO1003' || one.code === 'TEVO1009');
      return { env: fatal ? uncertain(env) : { ...env, fitness: 'unverifiable' } };
    }
    return { env: { ...env, fitness: measured.value.comparison } };
  };

  handlers['evolve-decide'] = (input: MasTaskInput) => {
    const env = envelopeOf(input);
    if (decided(env)) return { env };
    // The campaign's one planner, over records. Everything before this
    // gathered evidence; nothing before it decided what the evidence meant.
    const planned = planExperimentDecision({
      gate: env.gate, rerun: env.rerun, fitness: env.fitness,
    });
    return { env: decide(env, planned as never) };
  };

  handlers['evolve-dispatch-settle'] = async (input: MasTaskInput) => {
    const env = envelopeOf(input);
    const done = await context.settle(env);
    if (!done.ok) return { env: uncertain(env) };
    return { env: counted(env, done.value.legs) };
  };

  handlers['evolve-read-settle'] = (input: MasTaskInput) => ({ env: envelopeOf(input) });

  handlers['evolve-record'] = async (input: MasTaskInput) => {
    const env = envelopeOf(input);
    await context.record(env);
    return { env };
  };

  return handlers;
}
