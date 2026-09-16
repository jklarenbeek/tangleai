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

/**
 * What this worker is running, and which wait its answer belongs to.
 *
 * It is ASSEMBLED, never carried: the fenced effect store owns the job and
 * writes its payload itself — one field, the operation id — so there is no
 * room in the queue for a dispatch to smuggle the rest, and trying would
 * mean two writers on one job identity. The plan comes back out of the
 * effect record and the address out of the run, both durable, both
 * readable after a crash that lost every process that knew them.
 */
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

/**
 * The queue members the worker touches.
 *
 * It CLOSES the jobs it claims, and closes them only once it has answered
 * the wait — because the job is the only thing that can bring the worker
 * back. A job closed at the moment the effect finished would leave a
 * standing wait with no claimable identity behind it, which is exactly the
 * crash this design is supposed to make free.
 *
 * There is no third verb, and none is wanted. A job this pass could not
 * finish is simply left alone: its lease lapses and it becomes claimable
 * again, which is the same path a worker that died would take. Failing it
 * instead would spend one of the attempts that stand between the operation
 * and the dead-letter queue, for a pass that found nothing wrong.
 */
export interface WorkerJobQueue {
  claim(options: { kinds: string[], owner: string, leaseMs: number }): Promise<unknown>;
  complete(lease: unknown, result?: unknown): Promise<unknown>;
}

/** The effect record, which is where the plan actually lives. */
export interface WorkerEffectReader {
  get(id: string): Promise<{ plan?: EffectPlan } | null | undefined>;
}

/** Where a settled operation's answer belongs. */
export interface EffectAddress {
  runId: string;
  interactionPath: string;
  seal?: { repositoryRoot: string, baseRevision: string };
}

export interface EffectAddressing {
  /**
   * The wait this operation answers, or `undefined` when there is none to
   * answer. Undefined is not a failure: it is the honest result when the
   * run is not parked, and the worker leaves the operation alone rather
   * than answering something that did not ask.
   */
  address(operationId: string): Promise<EffectAddress | undefined>;
}

/** What the host must look up for the addressing rule to apply. */
export interface EffectAddressingOptions {
  /** The paths this run is parked on right now. */
  waitingPaths(runId: string): Promise<string[]>;
  /** Which run is executing this experiment. The host created it. */
  runIdFor(experimentId: string): Promise<string | undefined>;
  /** The operator root the base batch is bracketed against. */
  baseSealFor(experimentId: string): Promise<{ repositoryRoot: string, baseRevision: string } | undefined>;
}

/**
 * Address an operation by the wait its run is ACTUALLY parked on.
 *
 * Deriving the path from the stage name instead would be wrong wherever
 * the topology nests: `await-gate-rerun` lives inside the flake switch's
 * branch, so its recorded path carries that region's prefix, and an
 * interaction id assembled from a bare node id would address nothing at
 * all. Reading the wait is also the only version that stays correct if
 * the graph is rearranged.
 *
 * Two waits at once is refused rather than resolved. A run parked on more
 * than one wait cannot say which of them this operation answers, and
 * picking either would be a guess recorded as a fact.
 */
export function createEffectAddressing(options: EffectAddressingOptions): EffectAddressing {
  return {
    async address(operationId) {
      // `<experimentId>/<stage>`, split at the LAST separator so an
      // experiment id that contains one still resolves to its own stage.
      const cut = operationId.lastIndexOf('/');
      if (cut <= 0) return undefined;
      const experimentId = operationId.slice(0, cut);
      const stage = operationId.slice(cut + 1);

      const runId = await options.runIdFor(experimentId);
      if (runId === undefined) return undefined;

      const waiting = await options.waitingPaths(runId);
      if (waiting.length !== 1) return undefined;

      // Only the base batch runs in the operator's own root, and only it
      // is bracketed. Sealing anything else would ask the worker to prove
      // a worktree did not change, which is what a worktree is for.
      const seal = stage === 'measure-base' ? await options.baseSealFor(experimentId) : undefined;
      return {
        runId,
        interactionPath: waiting[0],
        ...(seal === undefined ? {} : { seal }),
      };
    },
  };
}

export interface EvolveEffectWorkerOptions {
  jobs: WorkerJobQueue;
  effects: WorkerEffectReader;
  addressing: EffectAddressing;
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
  /**
   * Plans nothing is waiting for YET, put back untouched.
   *
   * Not a failure and emphatically not `unresolved`: a dispatch writes the
   * intent and its job in one transaction and the run parks on the paired
   * wait a moment later, so a worker that claims in between has simply
   * arrived early. Running the effect then would spend a process nobody
   * could be told about, and calling it unresolved would escalate an
   * ordinary race to a person.
   */
  deferred: string[];
  /** Plans left unanswered because nobody can account for them. */
  unresolved: string[];
  /** Legs that replayed rather than running. Duplicate spend, counted. */
  replayed: number;
}

export function createEvolveEffectWorker(options: EvolveEffectWorkerOptions) {
  const { jobs, effects, addressing, driver, interactions, host, owner, interactionIdOf } = options;
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

    // Will this pass actually run anything? A plan whose every leg already
    // settled replays out of the record, and what replays must not be
    // bracketed: sealing a batch this pass does not take would compare the
    // base root to itself and report a seal about work that happened in
    // another process, on another day.
    const held = await effects.get(plan.id).catch(() => null) as
      { legs?: Array<{ state: string }> } | null;
    const legs = held?.legs ?? [];
    const replays = legs.length > 0 && legs.every(one => one.state === 'confirmed' || one.state === 'rejected');

    // The base batch is bracketed. The seal is taken here, in the worker,
    // because taking it SPAWNS git and a workflow segment may not.
    let before: { revision: string, digest: string } | null = null;
    if (job.seal !== undefined && !replays) {
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

    // `null`, not absent and certainly not `true`: this pass replayed a
    // batch it did not take, so whether the base held while that batch ran
    // is something NOBODY now knows. Saying so costs one experiment its
    // certainty; saying nothing would let an instrument that wrote into
    // the operator's own repository pass unnoticed, as long as the answer
    // was lost — a rare pair of failures, and exactly the pair a seal is
    // for. The readback reads anything but `true` as uncertain.
    let sealHeld: boolean | null | undefined;
    if (job.seal !== undefined) {
      if (before === null) sealHeld = null;
      else {
        const after = await sealBaseRoot({ host, ...job.seal });
        if (!after.ok) return after as EvolveOutcome<EvolveSettlementMessage>;
        sealHeld = baseSealHolds(before, after.value);
      }
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
      const pass: WorkerPass = { settled: [], deferred: [], unresolved: [], replayed: 0 };

      for (let taken = 0; taken < limit; taken++) {
        const claimed = await jobs.claim({ kinds: [EVOLVE_EFFECT_KIND], owner, leaseMs });
        if (claimed === undefined || claimed === null) break;

        const held = claimed as { lease?: unknown, payload?: { operationId?: unknown } };
        const lease = held.lease ?? claimed;
        const operationId = held.payload?.operationId;
        if (typeof operationId !== 'string') break;

        // The plan is the record's, not the payload's. A worker that took
        // the plan from a message would be running whatever the message
        // said; taking it from the record means it runs the intent the
        // fence actually admitted.
        const record = await effects.get(operationId).catch(() => null);
        const plan = record?.plan;
        if (plan === undefined) { pass.unresolved.push(operationId); continue; }

        // Nothing is waiting for this yet — or, just as possible, the wait
        // was already answered and the job is a redelivery. Either way the
        // work does not belong to this pass: put the job back unclaimed
        // and leave the effect alone.
        const address = await addressing.address(operationId);
        if (address === undefined) { pass.deferred.push(operationId); continue; }
        const job: EvolveEffectJob = { plan, ...address };

        const answer = await settle(job, lease);
        if (!answer.ok) {
          // Unanswered on purpose, and left claimable: an operation nobody
          // can account for has to stay reachable, or the person
          // reconciling it has nothing to reconcile with.
          pass.unresolved.push(job.plan.id);
          continue;
        }
        if (answer.value.evidence.replayed === true) pass.replayed += 1;

        const interactionId = interactionIdOf(job.runId, job.interactionPath);
        const waiting = await interactions.getInteraction(interactionId);
        if (waiting === undefined) { pass.unresolved.push(job.plan.id); continue; }
        // A resolved interaction accepts nothing further; answering one
        // that already holds this exact key is the replay case and the
        // store settles it by key rather than by a second write.
        await interactions.respondInteraction(
          interactionId, answer.value, waiting.revision, answer.value.recordId,
        );

        // Only now. Everything up to here is replayable from the record;
        // closing the job is what says the answer actually landed.
        await jobs.complete(lease, { operationId: job.plan.id, state: answer.value.state })
          .catch(() => undefined);
        pass.settled.push(job.plan.id);
      }

      return pass;
    },
  };
}
