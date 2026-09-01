/**
 * MAS durable segments over the suite queue — composition, not a queue.
 *
 * Enqueue is the suite's own idempotent caller-supplied-id enqueue with
 * the derived segment id `<masRunId>:<segment>` and the versioned kind
 * `mas:<executableRevision>`; re-enqueueing one segment is the suite's
 * no-op, and an unknown versioned kind is simply never claimed by a
 * worker that does not register it. The worker is
 * `store.jobs.createWorker`; the checkpoint store every region hands
 * `compileDag` is a thin NAMESPACE adaptation over the suite's
 * `context.checkpointsFor(context.job)` — load filters by
 * `<region>/<branch>/<iteration>/`, save prefixes the lowered node id
 * and delegates (keeping the suite's lease guard and JSON validation),
 * a region result is a prefixed delegated save, and only a terminal
 * outcome for the whole runnable segment calls the suite store's
 * `complete`, which atomically records the segment result, marks the
 * job done and prunes that segment's checkpoint rows. It grows no map,
 * table or serialization of its own.
 *
 * Before any checkpoint loads, the handler reads the MAS run and
 * refuses `TMAS2002` unless the job id, payload, workflow version,
 * registry snapshot and executable revision all agree — Jaren DAG
 * resume under different document bytes is undefined, so a mismatch
 * never reaches a checkpoint.
 */

import {
  masIssue,
  masJobKindOf,
  segmentJobIdOf,
  type MasIssue,
  type MasRun,
  type MasStore,
} from '@tangleai/mas';

import type { TangleDb } from './db.ts';

export interface MasSegmentPayload {
  runId: string;
  segment: number;
  workflowVersionId: string;
  registryRevision: string;
  executableRevision: string;
  /** The typed resume event for a post-interaction segment, or null for segment 0. */
  resume: unknown;
}

export interface EnqueueMasSegmentPlan {
  runId: string;
  segment: number;
  workflowVersionId: string;
  registryRevision: string;
  executableRevision: string;
  resume?: unknown;
}

/** Idempotent per segment: the suite keeps one row per caller-supplied id. */
export async function enqueueMasSegment(db: TangleDb, plan: EnqueueMasSegmentPlan): Promise<string> {
  const jobs = db.jobs;
  if (jobs === undefined) throw new TypeError('enqueueMasSegment: the store was opened without { jobs }');
  const payload: MasSegmentPayload = {
    runId: plan.runId,
    segment: plan.segment,
    workflowVersionId: plan.workflowVersionId,
    registryRevision: plan.registryRevision,
    executableRevision: plan.executableRevision,
    resume: plan.resume ?? null,
  };
  return jobs.enqueue(masJobKindOf(plan.executableRevision), payload, { id: segmentJobIdOf(plan.runId, plan.segment) });
}

/** The suite checkpoint store contract compileDag consumes. */
export interface RegionCheckpointStore {
  load(runId: string): unknown;
  save(runId: string, nodeId: string, value: unknown): unknown;
  complete(runId: string, result: unknown): unknown;
}

interface SuiteCheckpoints {
  load(runId: string): unknown;
  save(runId: string, nodeId: string, value: unknown): unknown;
  complete(runId: string, result: unknown): unknown;
}

/**
 * The namespace adaptation: one region incarnation's view of the
 * segment's suite checkpoint rows. Region-level `complete` records a
 * prefixed result via delegated save and deliberately does NOT mark the
 * job done.
 */
export function namespacedRegionCheckpoints(suite: SuiteCheckpoints, segmentJobId: string, namespace: string): RegionCheckpointStore {
  const prefix = `${namespace}/`;
  return {
    async load(runId: string) {
      if (runId !== segmentJobId) {
        throw new Error(`the region checkpoint store is bound to segment '${segmentJobId}', not '${runId}'`);
      }
      const stored = await Promise.resolve(suite.load(segmentJobId)) as { values: Record<string, unknown> } | null;
      if (stored === null) return null;
      const values: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(stored.values)) {
        if (key.startsWith(prefix)) values[key.slice(prefix.length)] = value;
      }
      return Object.keys(values).length === 0 ? null : { values };
    },
    save(runId: string, nodeId: string, value: unknown) {
      if (runId !== segmentJobId) {
        throw new Error(`the region checkpoint store is bound to segment '${segmentJobId}', not '${runId}'`);
      }
      return suite.save(segmentJobId, `${prefix}${nodeId}`, value);
    },
    complete(runId: string, result: unknown) {
      if (runId !== segmentJobId) {
        throw new Error(`the region checkpoint store is bound to segment '${segmentJobId}', not '${runId}'`);
      }
      return suite.save(segmentJobId, `${prefix}__region`, result);
    },
  };
}

export interface MasSegmentContext {
  run: MasRun;
  payload: MasSegmentPayload;
  segmentJobId: string;
  claimSeq: number;
  signal: AbortSignal;
  /** One region incarnation's namespaced checkpoint view. */
  checkpointsFor(namespace: string): RegionCheckpointStore;
  /**
   * The segment's terminal outcome: atomically records the result, marks
   * the suite job done and prunes this segment's checkpoint rows. Called
   * exactly once per runnable segment — whole-run completion/failure or a
   * durable interaction wait.
   */
  completeSegment(result: unknown): Promise<void>;
}

export type MasSegmentExecutor = (context: MasSegmentContext) => Promise<void>;

export interface MasWorkerOptions {
  /** The executable revisions this worker can run — its registered kinds. */
  executableRevisions: string[];
  execute: MasSegmentExecutor;
  concurrency?: number;
  pollInterval?: number;
  leaseMs?: number;
  owner?: string;
  backoffBase?: number;
  backoffCap?: number;
  stopGraceMs?: number;
}

export interface MasWorker {
  start(): MasWorker;
  stop(options?: { graceMs?: number }): Promise<{ drained: boolean, inFlight: number }>;
  stats(): { claims: number, completions: number, failures: number, polls: number, wakes: number, claimErrors: number, inFlight: number };
}

/** A refusal the queue records as the job's failure value. */
export class MasSegmentRefusal extends Error {
  issue: MasIssue;
  constructor(issue: MasIssue) {
    super(`${issue.code} ${issue.path} — ${issue.detail}`);
    this.issue = issue;
  }
}

/**
 * The semantic resume reconciler over the published queue — not another
 * queue. `respondInteraction` accepts exactly one typed response and
 * moves the run to `resume_pending` with a reserved zero-padded segment
 * id; the enqueue of that derived id happens OUTSIDE the semantic
 * transaction (the suite queue cannot be assumed to join it), so this
 * scan makes the seam idempotent: it enqueues every reserved segment
 * (the suite's caller-supplied-id no-op absorbs a crash after enqueue)
 * and CAS-advances `resume_pending -> queued`. The second identical
 * reconciliation changes zero rows and reports zero; every enqueue,
 * skip and conflict is a counted value.
 */
export async function ensurePendingMasSegments(db: TangleDb, masStore: MasStore): Promise<{
  examined: number,
  enqueued: number,
  queued: number,
  skipped: number,
}> {
  const counts = { examined: 0, enqueued: 0, queued: 0, skipped: 0 };
  const runs = await masStore.listResumePendingRuns();
  for (const run of runs) {
    counts.examined += 1;
    const trace = await masStore.readTrace(run.id);
    const responded = trace?.interactions.find((interaction) => interaction.status === 'responded' && interaction.resumeSegment !== null);
    if (responded === undefined || responded.resumeSegment === null) {
      counts.skipped += 1;
      continue;
    }
    await enqueueMasSegment(db, {
      runId: run.id,
      segment: responded.resumeSegment,
      workflowVersionId: run.workflowVersionId,
      registryRevision: run.registryRevision,
      executableRevision: run.executableRevision,
      resume: { interaction: responded.id, responseKey: responded.responseKey },
    });
    counts.enqueued += 1;
    const advanced = await masStore.transitionRun(run.id, { kind: 'queue-segment' });
    if (advanced.ok) counts.queued += 1;
    else counts.skipped += 1;
  }
  return counts;
}

export interface MasHandlerContext {
  job: { id: string };
  checkpointsFor: (job: unknown) => SuiteCheckpoints;
  signal: AbortSignal;
}

export type MasSegmentHandlers = Record<string, (payload: unknown, context: MasHandlerContext) => Promise<unknown>>;

/**
 * The versioned segment handlers a worker registers — exported so the
 * crash matrix can drive one claim at a time deterministically through
 * `store.jobs.claim` with an injected clock, without a polling loop.
 */
export function createMasSegmentHandlers(masStore: MasStore, options: Pick<MasWorkerOptions, 'executableRevisions' | 'execute' | 'owner'>): MasSegmentHandlers {
  if (options.executableRevisions.length === 0) throw new TypeError('createMasSegmentHandlers: at least one executable revision is required');
  const owner = options.owner ?? 'mas-worker';

  const handlers: MasSegmentHandlers = {};
  for (const executableRevision of options.executableRevisions) {
    handlers[masJobKindOf(executableRevision)] = async (rawPayload, context) => {
      const payload = rawPayload as MasSegmentPayload;
      const segmentJobId = segmentJobIdOf(payload.runId, payload.segment);
      if (context.job.id !== segmentJobId) {
        throw new MasSegmentRefusal(masIssue('TMAS2002', '/id', `the job id '${context.job.id}' does not derive from its payload ('${segmentJobId}')`));
      }
      const run = await masStore.getRun(payload.runId);
      if (run === undefined) {
        throw new MasSegmentRefusal(masIssue('TMAS2002', '/runId', `run '${payload.runId}' does not exist`));
      }
      if (run.workflowVersionId !== payload.workflowVersionId
        || run.registryRevision !== payload.registryRevision
        || run.executableRevision !== payload.executableRevision
        || run.executableRevision !== executableRevision) {
        throw new MasSegmentRefusal(masIssue('TMAS2002', '/executableRevision', 'the run identities do not agree with the queued segment; resuming under different document bytes is undefined and refused before any checkpoint loads'));
      }
      const suite = context.checkpointsFor(context.job);

      // A committed terminal outcome whose job completion was lost: close
      // the segment without executing a region.
      if (run.segment === payload.segment
        && (run.status === 'completed' || run.status === 'failed' || run.status === 'waiting_for_input' || run.status === 'resume_pending')) {
        await Promise.resolve(suite.complete(segmentJobId, { status: run.status }));
        return { status: run.status, reclaimed: true };
      }

      const claimed = await masStore.claimRunSegment(payload.runId, owner);
      if (!claimed.ok) throw new MasSegmentRefusal(claimed.issue);
      let completed = false;
      await options.execute({
        run: claimed.value,
        payload,
        segmentJobId,
        claimSeq: claimed.value.claim.seq,
        signal: context.signal,
        checkpointsFor: (namespace) => namespacedRegionCheckpoints(suite, segmentJobId, namespace),
        completeSegment: async (result) => {
          await Promise.resolve(suite.complete(segmentJobId, result));
          completed = true;
        },
      });
      if (!completed) {
        throw new MasSegmentRefusal(masIssue('TMAS2003', '/segment', 'the segment executor returned without a terminal outcome; a runnable segment ends completed, failed or durably waiting'));
      }
      return null;
    };
  }
  return handlers;
}

export function createMasSegmentWorker(db: TangleDb, masStore: MasStore, options: MasWorkerOptions): MasWorker {
  const jobs = db.jobs;
  if (jobs === undefined) throw new TypeError('createMasSegmentWorker: the store was opened without { jobs }');
  const owner = options.owner ?? 'mas-worker';
  const handlers = createMasSegmentHandlers(masStore, { executableRevisions: options.executableRevisions, execute: options.execute, owner });

  return jobs.createWorker({
    handlers: handlers as never,
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    ...(options.pollInterval !== undefined ? { pollInterval: options.pollInterval } : {}),
    ...(options.leaseMs !== undefined ? { leaseMs: options.leaseMs } : {}),
    owner,
    ...(options.backoffBase !== undefined ? { backoffBase: options.backoffBase } : {}),
    ...(options.backoffCap !== undefined ? { backoffCap: options.backoffCap } : {}),
    ...(options.stopGraceMs !== undefined ? { stopGraceMs: options.stopGraceMs } : {}),
  }) as MasWorker;
}
