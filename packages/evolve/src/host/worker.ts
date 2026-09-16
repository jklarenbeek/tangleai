/**
 * The effect worker: the one place an experiment reaches a process.
 *
 * A MAS segment is never handed the suite job lease, and the effect store
 * asserts that a lease's `jobId` is the plan's — so the work an
 * experiment's stages describe cannot happen inside the workflow. It
 * happens here: claim the job, run the plan under its own lease, and
 * answer the wait the workflow is parked on.
 *
 * Two details carry the whole crash story.
 *
 * `responseKey` is the effect record id, not a fresh token. A worker that
 * dies after `external.run` and before it answers will, on the next pass,
 * prepare the same semantic plan id, find every leg already settled,
 * replay it WITHOUT spawning, and answer with the same key — which the
 * store recognises as the same response rather than a conflict. That is
 * why a crash in that window costs nothing and duplicates nothing.
 *
 * An unresolved leg is the one case this worker does NOT answer. It
 * leaves the interaction waiting and the run parked, because nobody knows
 * whether the effect happened, and inventing a settlement would turn "we
 * cannot account for this" into a confident record. A person reconciles
 * it.
 *
 * Nothing imported here comes from `@tangleai/store`: that package
 * depends on this one, so every collaborator arrives as an injected duck.
 */

import { refuseOne, ok, type EvolveOutcome } from '../errors.ts';
import type { EffectPlan, EffectResources, EffectRunResult } from './driver.ts';
import { sealBaseRoot, baseSealHolds } from './measure.ts';
import type { WorktreeHost } from './worktree.ts';

/** The job kind every experiment effect is queued under. */
export const EVOLVE_EFFECT_KIND = 'evolve-effect';

/** What a dispatch put on the queue for this worker to find. */
export interface EvolveEffectJob {
  plan: EffectPlan;
  runId: string;
  /** The awaiting interaction's node path, e.g. `await-gate`. */
  interactionPath: string;
  /**
   * Present only for the base sample batch. That batch runs in the
   * OPERATOR's own root, so it is bracketed: the root must answer the
   * registered revision on a clean tree with identical tracked bytes,
   * before and after. An instrument that wrote into the base has voided
   * every number in the run, flattering ones included.
   */
  seal?: { repositoryRoot: string, baseRevision: string };
}

/** What the worker tells the waiting stage. */
export interface EvolveSettlementMessage {
  operationId: string;
  state: 'confirmed' | 'rejected' | 'unresolved';
  recordId: string;
  evidence: Record<string, unknown>;
}

/** The driver half the worker uses: run, with a lease it already holds. */
export interface WorkerDriver {
  run(plan: EffectPlan, resources?: EffectResources): Promise<EvolveOutcome<EffectRunResult>>;
}

/** The MAS store members the worker touches. Injected, never imported. */
export interface WorkerInteractionStore {
  getInteraction(id: string): Promise<{ revision: number, status: string } | undefined>;
  respondInteraction(
    id: string, response: unknown, expectedRevision: number, responseKey: string,
  ): Promise<{ ok: boolean } | unknown>;
}

/** The queue members the worker touches. */
export interface WorkerJobQueue {
  claim(options: { kinds: string[], owner: string, leaseMs: number }): Promise<unknown>;
}

export interface EvolveEffectWorkerOptions {
  jobs: WorkerJobQueue;
  driver: WorkerDriver;
  interactions: WorkerInteractionStore;
  host: WorktreeHost;
  owner: string;
  leaseMs?: number;
  /** `<runId>:i:<path>` — the suite's own interaction addressing. */
  interactionIdOf: (runId: string, path: string) => string;
}

export interface WorkerPass {
  /** Plans this pass ran to a settlement. */
  settled: string[];
  /** Plans left unanswered because nobody can account for them. */
  unresolved: string[];
  /** Legs that replayed rather than running. Duplicate spend, counted. */
  replayed: number;
}

export function createEvolveEffectWorker(options: EvolveEffectWorkerOptions) {
  const { jobs, driver, interactions, host, owner, interactionIdOf } = options;
  const leaseMs = options.leaseMs ?? 60000;

  /**
   * Run one queued effect and answer its wait.
   *
   * Takes the job rather than claiming it, so a test can drive claims one
   * at a time with an injected clock instead of racing a poll loop.
   */
  async function settle(
    job: EvolveEffectJob, lease: unknown,
  ): Promise<EvolveOutcome<EvolveSettlementMessage>> {
    const { plan } = job;

    // The base batch is bracketed. The seal is taken here, in the worker,
    // because taking it SPAWNS git and a workflow segment may not.
    let before: { revision: string, digest: string } | null = null;
    if (job.seal !== undefined) {
      const sealed = await sealBaseRoot({ host, ...job.seal });
      if (!sealed.ok) return sealed as EvolveOutcome<EvolveSettlementMessage>;
      before = sealed.value;
    }

    const run = await driver.run(plan, { lease });

    if (!run.ok) {
      // TEVO1009 is the unresolved case and the only one this worker
      // refuses to summarise: it leaves the wait standing.
      const unresolved = run.issues.some(one => one.code === 'TEVO1009');
      if (unresolved) {
        return refuseOne<EvolveSettlementMessage>('TEVO1009', '/plan/' + plan.id,
          'The effect did not resolve; the wait stands for a person to reconcile.');
      }
      return run as EvolveOutcome<EvolveSettlementMessage>;
    }

    let sealHeld: boolean | undefined;
    if (job.seal !== undefined && before !== null) {
      const after = await sealBaseRoot({ host, ...job.seal });
      if (!after.ok) return after as EvolveOutcome<EvolveSettlementMessage>;
      sealHeld = baseSealHolds(before, after.value);
    }

    const rejected = run.value.legs.some(leg => leg.state === 'rejected');
    return ok({
      operationId: plan.id,
      state: rejected ? 'rejected' : 'confirmed',
      // The effect record id, used as the response key. A replayed run
      // answers with the same key, so the store reads it as the same
      // response instead of a conflict.
      recordId: plan.id,
      evidence: {
        legs: run.value.legs,
        replayed: run.value.prepared === 0,
        ...(sealHeld === undefined ? {} : { sealHeld }),
      },
    });
  }

  return {
    settle,

    /** Claim and settle at most `limit` queued effects. No polling. */
    async drain(limit = 1): Promise<WorkerPass> {
      const pass: WorkerPass = { settled: [], unresolved: [], replayed: 0 };

      for (let taken = 0; taken < limit; taken++) {
        const claimed = await jobs.claim({ kinds: [EVOLVE_EFFECT_KIND], owner, leaseMs });
        if (claimed === undefined || claimed === null) break;

        const held = claimed as { lease?: unknown, payload?: unknown };
        const lease = held.lease ?? claimed;
        const job = held.payload as EvolveEffectJob | undefined;
        if (job === undefined || typeof job !== 'object') break;

        const answer = await settle(job, lease);
        if (!answer.ok) {
          // Unanswered on purpose. Nothing retries it and nothing removes
          // the worktree; the experiment is reconciled by a person.
          pass.unresolved.push(job.plan.id);
          continue;
        }
        if (answer.value.evidence.replayed === true) pass.replayed += 1;

        const interactionId = interactionIdOf(job.runId, job.interactionPath);
        const waiting = await interactions.getInteraction(interactionId);
        if (waiting === undefined) {
          pass.unresolved.push(job.plan.id);
          continue;
        }
        // A resolved interaction accepts nothing further; answering one
        // that already holds this exact key is the replay case and the
        // store settles it by key rather than by a second write.
        await interactions.respondInteraction(
          interactionId, answer.value, waiting.revision, answer.value.recordId,
        );
        pass.settled.push(job.plan.id);
      }

      return pass;
    },
  };
}
