/**
 * One effect plan, run once, under a lease.
 *
 * The plan id is SEMANTIC — `<experimentId>/<stage>` — not a fresh
 * identifier per attempt. That is the whole mechanism: a re-run after a
 * crash prepares the same id, the store recognises it, and the confirmed
 * legs replay from the record instead of happening a second time. An
 * experiment that died between spawning a gate and recording its exit code
 * therefore does not spawn it again.
 *
 * Nothing here reconciles. An unresolved leg is returned as `TEVO1009` and
 * the run stops: a person decides what an effect nobody can account for
 * meant, because automatic recovery would have to guess, and guessing is
 * how an uncertain write becomes a confident wrong record.
 */

import { refuseOne, ok, type EvolveOutcome } from '../errors.ts';
import { unresolvedRefusal } from './effects.ts';

export interface EffectPlanLeg {
  id: string;
  request: Record<string, unknown> & { safety: string };
  maxAttempts: number;
}

export interface EffectPlan {
  id: string;
  jobId: string;
  kind: string;
  actor: string;
  reason: string;
  hashVersion: string;
  legs: EffectPlanLeg[];
}

/** The fenced store members this driver uses. */
export interface FencedEffectStore {
  prepare(plan: EffectPlan): Promise<{ record: unknown, writes: number }>;
  get(id: string): Promise<unknown>;
}

export interface ExternalEffects {
  run(id: string, resources: { lease: unknown, signal?: AbortSignal }): Promise<{
    state: string, revision?: number, leg?: string, legs?: Array<{ id: string, state: string }>,
  }>;
}

export interface JobQueue {
  claim(options: { kinds: string[], owner: string, leaseMs: number }): Promise<unknown>;
  complete(lease: unknown, result?: unknown): Promise<unknown>;
  pause?(lease: unknown): Promise<unknown>;
}

export interface EffectDriverOptions {
  jobs: JobQueue;
  effects: FencedEffectStore;
  external: ExternalEffects;
  owner: string;
  leaseMs?: number;
  signal?: AbortSignal;
}

export interface EffectRunResult {
  planId: string;
  /** 1 the first time a plan is prepared, 0 when the record already held it. */
  prepared: number;
  state: string;
  legs: Array<{ id: string, state: string }>;
}

export function createEffectDriver(options: EffectDriverOptions) {
  const { jobs, effects, external, owner } = options;
  const leaseMs = options.leaseMs ?? 60000;

  return {
    async run(plan: EffectPlan): Promise<EvolveOutcome<EffectRunResult>> {
      let prepared: { record: unknown, writes: number };
      try {
        prepared = await effects.prepare(plan);
      }
      catch (error) {
        // The suite refuses a changed payload under an id it already holds.
        // Its own code is carried, because "the plan you replayed is not the
        // plan that ran" is the useful sentence, not a paraphrase.
        return refuseOne<EffectRunResult>('TEVO1002', '/plan/id',
          'This effect plan id is already held under different bytes.', {
            code: 'JL2009',
            docPath: '/plan',
            message: error instanceof Error ? error.message : String(error),
          });
      }

      // A plan the record already held is REPLAYED, not re-run: when every
      // leg is settled there is nothing left to do and no job to claim, so
      // the recorded outcome is the answer. This is the whole point of a
      // semantic plan id — a resumed experiment reads what happened instead
      // of making it happen again.
      if (prepared.writes === 0) {
        const held = await effects.get(plan.id).catch(() => null) as { legs?: Array<{ id: string, state: string }> } | null;
        const legs = held?.legs ?? [];
        if (legs.length > 0 && legs.every(leg => leg.state === 'confirmed' || leg.state === 'rejected')) {
          return ok({
            planId: plan.id,
            prepared: 0,
            state: 'complete',
            legs: legs.map(({ id, state }) => ({ id, state })),
          });
        }
      }

      let claimed: unknown;
      try {
        claimed = await jobs.claim({ kinds: [plan.kind], owner, leaseMs });
      }
      catch (error) {
        return refuseOne<EffectRunResult>('TEVO1009', '/jobs',
          'Claiming the effect job failed: ' + (error instanceof Error ? error.message : String(error)) + '.');
      }
      if (claimed === undefined || claimed === null) {
        return refuseOne<EffectRunResult>('TEVO1009', '/jobs', 'No effect job was claimable for this plan.');
      }
      // A claim answers the JOB; the fence wants the lease inside it, whose
      // `jobId` is what the store checks the record against.
      const held = claimed as { lease?: { jobId?: string } };
      const lease = held.lease ?? claimed;
      if ((lease as { jobId?: string }).jobId !== plan.jobId) {
        return refuseOne<EffectRunResult>('TEVO1009', '/jobs',
          'The claimed job is not this plan’s; another worker holds it.');
      }

      const result = await external.run(plan.id, { lease, signal: options.signal });
      const legs = result.legs ?? [];

      if (result.state === 'complete') {
        await jobs.complete(lease, result).catch(() => undefined);
        return ok({ planId: plan.id, prepared: prepared.writes, state: result.state, legs });
      }

      // Anything else pauses rather than completing: a job whose identity is
      // consumed cannot be claimed again for reconciliation.
      await jobs.pause?.(lease).catch(() => undefined);
      if (result.state === 'unresolved') {
        return unresolvedRefusal(result.leg ?? plan.id) as EvolveOutcome<EffectRunResult>;
      }
      return refuseOne<EffectRunResult>('TEVO1009', '/effects',
        'The effect run ended ' + result.state + ' and stops for review.');
    },
  };
}
