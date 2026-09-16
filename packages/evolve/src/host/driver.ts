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

/**
 * What preparing a plan settled before anything reached the world.
 *
 * `replayed` is non-null exactly when the record already held every leg in
 * a terminal state: there is nothing left to do, and no job should be
 * claimed for it. A caller that claims anyway consumes a job identity for
 * work that already happened.
 */
export interface EffectPreparation {
  prepared: number;
  replayed: EffectRunResult | null;
}

/**
 * The resources a caller may already hold.
 *
 * The durable path splits the two halves across processes: a workflow task
 * writes the intent and enqueues, and a worker claims the job and runs it.
 * The worker therefore arrives holding a lease, and the driver must not
 * claim a second one — `createDbEffectStore.begin` asserts the lease's
 * `jobId` matches the plan, so a double claim is not a tidy duplicate but
 * a refusal. Passing no lease keeps the sequential behaviour: claim, run,
 * complete, all here.
 */
export interface EffectResources {
  lease?: unknown;
}

export function createEffectDriver(options: EffectDriverOptions) {
  const { jobs, effects, external, owner } = options;
  const leaseMs = options.leaseMs ?? 60000;

  /** Write the intent, and answer whether the record already settled it. */
  async function prepare(plan: EffectPlan): Promise<EvolveOutcome<EffectPreparation>> {
    let prepared: { record: unknown, writes: number };
    try {
      prepared = await effects.prepare(plan);
    }
    catch (error) {
      // The suite refuses a changed payload under an id it already holds.
      // Its own code is carried, because "the plan you replayed is not the
      // plan that ran" is the useful sentence, not a paraphrase.
      return refuseOne<EffectPreparation>('TEVO1002', '/plan/id',
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
          prepared: 0,
          replayed: {
            planId: plan.id,
            prepared: 0,
            state: 'complete',
            legs: legs.map(({ id, state }) => ({ id, state })),
          },
        });
      }
    }

    return ok({ prepared: prepared.writes, replayed: null });
  }

  /** Claim this plan's own job, refusing anything that is not it. */
  async function claimFor(plan: EffectPlan): Promise<EvolveOutcome<unknown>> {
    let claimed: unknown;
    try {
      claimed = await jobs.claim({ kinds: [plan.kind], owner, leaseMs });
    }
    catch (error) {
      return refuseOne<unknown>('TEVO1009', '/jobs',
        'Claiming the effect job failed: ' + (error instanceof Error ? error.message : String(error)) + '.');
    }
    if (claimed === undefined || claimed === null) {
      return refuseOne<unknown>('TEVO1009', '/jobs', 'No effect job was claimable for this plan.');
    }
    // A claim answers the JOB; the fence wants the lease inside it, whose
    // `jobId` is what the store checks the record against.
    const held = claimed as { lease?: { jobId?: string } };
    return ok(held.lease ?? claimed);
  }

  return {
    prepare,

    async run(plan: EffectPlan, resources: EffectResources = {}): Promise<EvolveOutcome<EffectRunResult>> {
      const preparation = await prepare(plan);
      if (!preparation.ok) return preparation as EvolveOutcome<EffectRunResult>;
      if (preparation.value.replayed !== null) return ok(preparation.value.replayed);

      let lease = resources.lease;
      if (lease === undefined) {
        const claimed = await claimFor(plan);
        if (!claimed.ok) return claimed as EvolveOutcome<EffectRunResult>;
        lease = claimed.value;
      }
      if ((lease as { jobId?: string }).jobId !== plan.jobId) {
        return refuseOne<EffectRunResult>('TEVO1009', '/jobs',
          'The claimed job is not this plan’s; another worker holds it.');
      }

      const result = await external.run(plan.id, { lease, signal: options.signal });
      const legs = result.legs ?? [];

      if (result.state === 'complete') {
        await jobs.complete(lease, result).catch(() => undefined);
        return ok({ planId: plan.id, prepared: preparation.value.prepared, state: result.state, legs });
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
