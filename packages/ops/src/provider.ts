/**
 * The `job_queue` contract over a Jaren store: what the queue and its
 * recurring schedules hold, and the person's steering calls, mapped onto
 * Jaren's own fenced operations (JOBS-FORMAT §10, §11). Tangle keeps no queue,
 * table or record of its own here; every answer is the store's.
 *
 * A job's `payload` and `result` never leave: they are the host's data. A
 * running job is cancelled only with the lease this host holds for it (the
 * worker's `leases()`, when this process runs the worker); a job another
 * process runs is refused as held, not stolen.
 */
import { JOB_CODES, type JobCounts, type JobItem, type JobQueue, type JobSchedule, type JobState } from '@tangleai/os/jobs';

/** The part of a Jaren store this provider reads: `store.jobs`, opened with `jobs` (and `jobs.schedules` for schedules). */
export type JobStore = { jobs: any };
/** A lease as a Jaren worker's `leases()` lists it. */
export type JobLease = { jobId: string, [key: string]: unknown };
export type JobQueueProviderOptions = {
  /** The scope this provider answers for; another scope is refused (`OS0194`). Absent: any scope is this store. */
  scope?: string,
  /** The leases of the worker this process runs, so a running job can be cancelled through its fence. */
  leases?: () => readonly JobLease[],
};

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
const codeOf = (error: unknown) => (error as { code?: string })?.code;

function itemOf(job: any): JobItem {
  const error = job.lastError;
  return {
    id: job.id, kind: job.kind, state: job.state as JobState,
    runAt: job.runAt, attempts: job.attempts, maxAttempts: job.maxAttempts, leaseUntil: job.leaseUntil ?? null,
    lastError: error == null ? null : typeof error === 'string' ? { message: error.slice(0, 2000) }
      : { message: String(error.message ?? JSON.stringify(error)).slice(0, 2000), ...(typeof error.code === 'string' ? { code: error.code.slice(0, 40) } : {}) },
    createdAt: job.createdAt, updatedAt: job.updatedAt,
  };
}

function scheduleOf(record: any): JobSchedule {
  const counts = record.counts ?? {};
  return {
    id: record.id, kind: record.kind, series: record.series, zone: record.zone ?? null, policy: record.policy ?? null,
    missed: record.missed, latenessMs: record.latenessMs ?? null, state: record.state,
    nextRunAt: record.nextRunAt ?? null, nextRecurrenceId: record.nextRecurrenceId ?? null,
    lastRunAt: record.lastRunAt ?? null, lastRecurrenceId: record.lastRecurrenceId ?? null,
    counts: { fired: counts.fired ?? 0, skipped: counts.skipped ?? 0, ...(typeof counts.uncounted === 'number' ? { uncounted: counts.uncounted } : {}) },
    stall: record.stall ?? null, createdAt: record.createdAt, updatedAt: record.updatedAt,
  };
}

/** The queue of `store`, answering the `job_queue` contract's operations. */
export function jobQueueProvider(store: JobStore, options: JobQueueProviderOptions = {}): JobQueue {
  const jobs = store.jobs;
  if (!jobs) throw new TypeError('jobQueueProvider needs a store opened with jobs');
  const inScope = (input: { scope?: string } | undefined) => {
    if (options.scope !== undefined && input?.scope !== undefined && input.scope !== options.scope)
      throw coded(JOB_CODES.scope, `this host serves the scope ${options.scope}, not ${input.scope}`);
  };
  const known = async (id: string) => {
    const job = await jobs.get(id);
    if (!job) throw coded(JOB_CODES.unknown, `there is no job ${id}`);
    return job;
  };
  return {
    async counts(input) {
      inScope(input);
      const c = await jobs.counts();
      return { pending: c.pending ?? 0, leased: c.leased ?? 0, done: c.done ?? 0, failed: c.failed ?? 0, dead: c.dead ?? 0, cancelled: c.cancelled ?? 0, pendingKinds: c.pendingKinds ?? {} } as JobCounts;
    },
    async page(input = {}) {
      inScope(input);
      const limit = input.limit ?? 100;
      const items: JobItem[] = [];
      for await (const job of jobs.page({ ...(input.state ? { state: input.state } : {}), ...(input.kind ? { kind: input.kind } : {}), ...(input.after ? { after: input.after } : {}), limit }))
        items.push(itemOf(job));
      return items.length === limit ? { items, next: items[items.length - 1].id } : { items };
    },
    async get(input) {
      inScope(input);
      return itemOf(await known(input.id));
    },
    async schedules(input) {
      inScope(input);
      try { return { schedules: (await jobs.schedules()).map(scheduleOf) }; }
      catch (error) { if (codeOf(error) === 'JD0016') return { schedules: [] }; throw error; }
    },
    async cancel(input) {
      inScope(input);
      const job = await known(input.id);
      if (job.state === 'cancelled') return { changed: false };
      if (job.state === 'done' || job.state === 'dead') throw coded(JOB_CODES.refused, `job ${input.id} is ${job.state}`);
      if (job.state === 'leased') {
        const lease = options.leases?.().find(l => l.jobId === input.id);
        if (!lease) throw coded(JOB_CODES.held, `job ${input.id} is running in another process`);
        return { changed: await jobs.cancel(input.id, { lease }) };
      }
      return { changed: await jobs.cancel(input.id) };
    },
    async requeue(input) {
      inScope(input);
      const job = await known(input.id);
      if (job.state === 'pending') return { changed: false };
      if (job.state === 'done') throw coded(JOB_CODES.refused, `job ${input.id} is done`);
      try { return { changed: await jobs.requeue(input.id) }; }
      catch (error) { if (codeOf(error) === 'JD2068') throw coded(JOB_CODES.refused, `job ${input.id} is running`); throw error; }
    },
    async unschedule(input) {
      inScope(input);
      let removed = false;
      try { removed = await jobs.unschedule(input.id); }
      catch (error) { if (codeOf(error) !== 'JD0016') throw error; }
      if (!removed) throw coded(JOB_CODES.unknown, `there is no schedule ${input.id}`);
      return { changed: true };
    },
  };
}

const ERROR_NAMES: Record<string, string> = { [JOB_CODES.unknown]: 'unknown', [JOB_CODES.refused]: 'refused', [JOB_CODES.held]: 'held', [JOB_CODES.scope]: 'scope' };

/** The handlers `serveHttp` (or a port) takes for `JOB_QUEUE_CONTRACT`: a coded refusal becomes the contract's declared error. */
export function jobQueueHandlers(queue: JobQueue): Record<string, (input: any, ctx: any) => Promise<unknown>> {
  const wrap = (call: (input: any) => Promise<unknown>) => async (input: any, ctx: any) => {
    try { return await call(input); }
    catch (error) {
      const name = ERROR_NAMES[codeOf(error) ?? ''];
      if (name) return ctx.fail(name, {}, { detail: (error as Error).message });
      throw error;
    }
  };
  return {
    'jobs.counts': wrap((i) => queue.counts(i)), 'jobs.page': wrap((i) => queue.page(i)), 'jobs.get': wrap((i) => queue.get(i)),
    'jobs.schedules': wrap((i) => queue.schedules(i)), 'jobs.cancel': wrap((i) => queue.cancel(i)),
    'jobs.requeue': wrap((i) => queue.requeue(i)), 'jobs.unschedule': wrap((i) => queue.unschedule(i)),
  };
}
