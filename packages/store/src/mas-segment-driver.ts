/** Drive one native queued segment without creating a second scheduler or timer. */
import { segmentJobIdOf, type MasRun, type MasStore, type MasSegmentHost } from '@tangleai/mas';
import { enqueueMasSegment, createMasSegmentHandlers } from './mas-jobs.ts';
import type { TangleDb } from './db.ts';

export function createMasSegmentDriver(db: TangleDb, store: MasStore, options: { owner: string; leaseMs: number }) {
  const jobs = db.jobs;
  if (!jobs) throw new TypeError('Native segment driving requires an open job store');
  if (!options.owner || !Number.isFinite(options.leaseMs) || options.leaseMs <= 0) throw new TypeError('An owner and positive segment lease are required');
  return {
    settled: async (run: MasRun) => (await jobs.get(segmentJobIdOf(run.id, run.segment)))?.state === 'done',
    enqueue: (run: MasRun) => enqueueMasSegment(db, { runId: run.id, segment: run.segment, workflowVersionId: run.workflowVersionId,
      registryRevision: run.registryRevision, executableRevision: run.executableRevision }),
    async drive(executableRevision: string, execute: (segment: MasSegmentHost) => Promise<void>, signal: AbortSignal): Promise<boolean> {
      const handlers = createMasSegmentHandlers(store, { executableRevisions: [executableRevision], owner: options.owner, execute });
      const kind = Object.keys(handlers)[0], job = await jobs.claim({ kinds: [kind], owner: options.owner, leaseMs: options.leaseMs });
      if (!job) return false;
      try {
        const result = await handlers[kind](job.payload, { job, checkpoints: jobs.checkpointsFor(job), signal });
        await jobs.complete(job.lease, result ?? null); return true;
      } catch (cause) { await jobs.fail(job.lease, cause); throw cause; }
    },
  };
}
