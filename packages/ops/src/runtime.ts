/**
 * The operations runtime: a host's registry run in a Jaren worker. It keeps
 * the registry's schedules in the store (and only those: ids
 * `ops:<registry>:<kind>`), runs every job in the worker the host's
 * background process gives it, writes each attempt into the history, and
 * keeps a heartbeat a watcher outside it reads.
 *
 * A schedule fires a small job (`ops.fire`) whose only work is to enqueue the
 * real job by id (`run:<registry>:<kind>@<recurrence>`) with the attempts the
 * registry allows. Enqueue by id is idempotent, so a repeated fire cannot
 * double it; a `single-send` job gets one attempt, so Jaren itself
 * dead-letters an attempt a crash cut off, and the person's requeue gives it
 * exactly one more. The operation of a `single-send` job is therefore called
 * at most once per attempt the person allows.
 *
 * `started` is committed before the operation is called, so "never sent" and
 * "maybe sent" stay apart; an attempt whose process died leaves a `started`
 * without an outcome, which the next start records as `lost`.
 */
import { FIRE_KIND, maxAttemptsOf, seriesOf, type JobRegistry, type RegistryJob } from './registry.ts';
import { eventId, opsEvents, type OpsEvent } from './events.ts';

/** A contract the runtime calls a job's operation on: an `openHttpClient`, or an in-process dispatcher. */
/** The job a contract call runs for, for a client that can carry it (`invokeJob`). */
export type OpsJobRef = { id: string, attempt: number, kind: string };
/**
 * A contract the runtime calls a job's operation on: an `openHttpClient`, or an in-process dispatcher. A client
 * that also has `invokeJob` is given the job itself (its id, attempt and kind) — a browser page's tasks use it to
 * key what they do by the job; a plain client gets only the idempotency key its transport carries.
 */
export type OpsContract = {
  invoke(operation: string, input: unknown, ctx?: { idempotencyKey?: string, signal?: AbortSignal }): Promise<unknown>,
  invokeJob?(operation: string, input: unknown, ctx: { job: OpsJobRef, idempotencyKey?: string, signal?: AbortSignal }): Promise<unknown>,
};
export type OpsHandler = (payload: unknown, ctx: { job: any, signal?: AbortSignal }) => Promise<unknown>;
export type OpsRuntimeOptions = {
  /** A Jaren store opened with `jobs: { schedules: jobSchedules() }` whose model holds `OPS_EVENTS_COLLECTIONS`. */
  store: any,
  registry: JobRegistry,
  contracts?: Record<string, OpsContract>,
  handlers?: Record<string, OpsHandler>,
  /** The runtime's stable id (its heartbeat row); default `<registry>@host`. */
  id?: string,
  /** The clock events and budgets read; give the store's own when it is injected. */
  now?: () => number,
  keepDays?: number,
  heartbeatMs?: number,
  worker?: { concurrency?: number, pollInterval?: number, leaseMs?: number },
  /** What the heartbeat also says: where the store is kept and which tab owns it (a browser twin). */
  about?: { storage?: string, owner?: string, recovered?: string },
  /** Marks every event as simulated (the browser twin's moved clock). */
  simulated?: boolean,
  onEvent?: (event: OpsEvent) => void,
};
export type OpsRuntime = {
  start(): Promise<void>,
  stop(options?: { graceMs?: number }): Promise<void>,
  runNow(kind: string): Promise<{ id: string }>,
  health(): { runtime: string, at: number, running: boolean, stats: Record<string, number> | null },
  /** The worker's leases, for a provider that lets the person cancel a running job. */
  leases(): readonly any[],
  readonly registry: JobRegistry,
};

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
const fingerprint = (job: RegistryJob, zone: string | undefined) => JSON.stringify([job.schedule, job.payload ?? null, zone ?? null, maxAttemptsOf(job)]);
const dayOf = (at: number, zone: string | undefined) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const outcomeOf = (value: unknown) => {
  if (value && typeof value === 'object' && 'ok' in value && typeof (value as any).ok === 'boolean') {
    const outcome = value as any;
    if (!outcome.ok) throw Object.assign(new Error(String(outcome.error?.message ?? outcome.kind ?? 'the operation failed')), { code: outcome.error?.code });
    return outcome.value;
  }
  return value;
};

/** The runtime of `registry` over `store`. Nothing runs until `start()`. */
export function createOpsRuntime(options: OpsRuntimeOptions): OpsRuntime {
  const { store, registry } = options;
  const jobs = store.jobs;
  if (!jobs) throw new TypeError('createOpsRuntime needs a store opened with jobs');
  const now = options.now ?? Date.now;
  const id = options.id ?? `${registry.name}@host`;
  const events = opsEvents(store);
  const byKind = new Map(registry.jobs.map(j => [j.kind, j]));
  const scheduleId = (kind: string) => `ops:${registry.name}:${kind}`;
  const runId = (kind: string, tail: string) => `run:${registry.name}:${kind}@${tail}`;
  const zoneOf = (job: RegistryJob) => job.schedule?.utc ? undefined : job.schedule?.zone ?? registry.zone;
  const pending = new Set<Promise<unknown>>();
  const startedAt = new Map<string, number>();
  let reconcileErrors = 0;
  let worker: any = null, beat: ReturnType<typeof setInterval> | null = null, prune: ReturnType<typeof setInterval> | null = null, running = false;

  const record = (event: OpsEvent) => {
    const e = options.simulated ? { ...event, simulated: true } : event;
    const write = events.write(e).then(() => options.onEvent?.(e), () => {});
    pending.add(write); void write.finally(() => pending.delete(write));
    return write;
  };

  async function syncSchedules() {
    let existing: any[] = [];
    try { existing = await jobs.schedules(); }
    catch (error: any) {
      if (error?.code !== 'JD0016') throw error;
      if (registry.jobs.some(j => j.schedule)) throw coded('OPS0001', 'the registry has schedules but the store was opened without jobs.schedules');
      return;
    }
    const mine = new Map(existing.filter(s => typeof s.id === 'string' && s.id.startsWith(`ops:${registry.name}:`)).map(s => [s.id, s]));
    for (const job of registry.jobs) {
      if (!job.schedule) continue;
      const sid = scheduleId(job.kind), zone = zoneOf(job), print = fingerprint(job, zone);
      const current = mine.get(sid);
      mine.delete(sid);
      if (current?.payload?.fingerprint === print) continue;   // unchanged: a rewrite would move updatedAt and stale pending suggestions
      const s = job.schedule;
      await jobs.schedule({
        id: sid, kind: FIRE_KIND, payload: { kind: job.kind, fingerprint: print }, series: seriesOf(s),
        ...(zone ? { zone, zoneSource: 'explicit' } : {}), ...(s.utc ? {} : { policy: s.policy ?? 'rfc5545' }),
        missed: s.missed ?? 'skip', ...(s.latenessMs ? { latenessMs: s.latenessMs } : {}),
      });
    }
    for (const gone of mine.keys()) await jobs.unschedule(gone);
  }

  /** Record each attempt whose process died as `lost` (and `not-repeated` for a single-send job) once its lease is gone.
   * At start every attempt in the history is checked; on every heartbeat, those of the last two hours, so an attempt
   * cut off by a takeover inside its lease is recorded once the lease runs out, without another restart. */
  async function reconcile(since?: number) {
    for (const orphan of await events.orphans(since)) {
      if (!orphan.jobId || orphan.attempt === undefined) continue;
      const job = await jobs.get(orphan.jobId);
      if (job?.state === 'leased' && (job.leaseUntil ?? 0) > now()) continue;   // still running elsewhere
      await record({ id: eventId(orphan.jobId, orphan.attempt, 'lost'), at: now(), event: 'lost', kind: orphan.kind, jobId: orphan.jobId, attempt: orphan.attempt, message: 'the process running this attempt stopped' });
      if (orphan.kind && byKind.get(orphan.kind)?.safety === 'single-send')
        await record({ id: eventId(orphan.jobId, orphan.attempt, 'not-repeated'), at: now(), event: 'not-repeated', kind: orphan.kind, jobId: orphan.jobId, attempt: orphan.attempt });
    }
  }

  /** Retention: history and settled jobs older than `keepDays` go (Jaren's own sweep for the jobs). */
  async function retain() {
    const before = now() - (options.keepDays ?? 30) * 86_400_000;
    await events.prune(before);
    try { for (let more = true; more;) { const { removed } = await jobs.sweep({ settledBefore: before, limit: 500 }); more = removed === 500; } }
    catch { /* a store whose jobs cannot be swept keeps them; the history is still bounded */ }
  }

  const heartbeat = () => record({ id: `heartbeat:${id}`, at: now(), event: 'heartbeat', runtime: id, stats: worker?.stats() ?? {}, ...(options.about?.storage ? { storage: options.about.storage } : {}), ...(options.about?.owner ? { owner: options.about.owner } : {}), ...(options.about?.recovered ? { recovered: options.about.recovered } : {}) });

  function handlerFor(job: RegistryJob): OpsHandler {
    return async (payload, { job: record_, signal }) => {
      const attempt = record_.attempts as number, at = now(), day = dayOf(at, zoneOf(job) ?? registry.zone);
      if (job.budget && await events.startedOn(job.kind, day) >= job.budget.runsPerDay) {
        await record({ id: eventId(record_.id, attempt, 'budget'), at, event: 'budget', kind: job.kind, jobId: record_.id, attempt, day, message: `the budget of ${job.budget.runsPerDay} runs a day is spent` });
        return { budget: 'spent' };
      }
      // committed before the call: a crash after this line is "maybe sent", before it "never sent"
      await record({ id: eventId(record_.id, attempt, 'started'), at, event: 'started', kind: job.kind, jobId: record_.id, attempt, day });
      startedAt.set(`${record_.id}#${attempt}`, at);
      if ('contract' in job.handler) {
        const client = options.contracts?.[job.handler.contract];
        if (!client) throw coded('OPS0002', `no contract client '${job.handler.contract}' is given to the runtime`);
        const ctx = { ...(job.safety === 'provider-idempotent' ? { idempotencyKey: record_.id } : {}), ...(signal ? { signal } : {}) };
        return outcomeOf(client.invokeJob
          ? await client.invokeJob(job.handler.operation, payload ?? {}, { ...ctx, job: { id: record_.id, attempt, kind: job.kind } })
          : await client.invoke(job.handler.operation, payload ?? {}, ctx));
      }
      const fn = options.handlers?.[job.handler.code];
      if (!fn) throw coded('OPS0002', `no handler '${job.handler.code}' is given to the runtime`);
      return fn(payload, { job: record_, ...(signal ? { signal } : {}) });
    };
  }

  const runtime: OpsRuntime = {
    registry,
    async start() {
      if (running) return;
      await syncSchedules();
      await reconcile(now() - (options.keepDays ?? 30) * 86_400_000);   // bounded: restarts do not slow as history grows
      await retain();
      const handlers: Record<string, OpsHandler> = {
        [FIRE_KIND]: async (payload: any, { job }) => {
          const target = byKind.get(payload?.kind);
          if (!target) return;   // the registry dropped it since the schedule fired
          const recurrence = String(job.id).slice(String(job.id).indexOf('@') + 1);
          await jobs.enqueue(target.kind, target.payload ?? {}, { id: runId(target.kind, recurrence), maxAttempts: maxAttemptsOf(target) });
        },
      };
      for (const job of registry.jobs) handlers[job.kind] = handlerFor(job);
      worker = jobs.createWorker({
        handlers, tick: true,
        concurrency: options.worker?.concurrency ?? 1, pollInterval: options.worker?.pollInterval ?? 500,
        ...(options.worker?.leaseMs ? { leaseMs: options.worker.leaseMs } : {}),
        onOutcome: (o: any) => {
          if (o.kind === FIRE_KIND || !byKind.has(o.kind)) return;
          const key = `${o.jobId}#${o.attempt}`, began = startedAt.get(key);
          startedAt.delete(key);
          if (o.outcome === 'completed' && began === undefined) return;   // a budget refusal settles without starting
          void record({
            id: eventId(o.jobId, o.attempt, o.outcome), at: now(), event: o.outcome, kind: o.kind, jobId: o.jobId, attempt: o.attempt,
            ...(began !== undefined ? { durationMs: Math.max(0, now() - began) } : {}),
            ...(o.code ? { code: String(o.code).slice(0, 40) } : {}), ...(o.reason ? { message: String(o.reason).slice(0, 500) } : {}),
          });
          if (o.outcome === 'lost' && byKind.get(o.kind)?.safety === 'single-send')
            void record({ id: eventId(o.jobId, o.attempt, 'not-repeated'), at: now(), event: 'not-repeated', kind: o.kind, jobId: o.jobId, attempt: o.attempt });
        },
      });
      worker.start();
      running = true;
      await heartbeat();
      beat = setInterval(() => { void heartbeat(); void reconcile(now() - 2 * 3_600_000).catch(() => { reconcileErrors++; }); }, options.heartbeatMs ?? 30_000);
      prune = setInterval(() => { void retain(); }, 86_400_000);
      (beat as any).unref?.(); (prune as any).unref?.();
    },
    async stop({ graceMs = 5_000 } = {}) {
      if (beat) clearInterval(beat);
      if (prune) clearInterval(prune);
      beat = prune = null;
      if (worker) await worker.stop({ graceMs });
      running = false;
      while (pending.size) await Promise.allSettled([...pending]);   // drain the history before the host closes the store
    },
    async runNow(kind) {
      const job = byKind.get(kind);
      if (!job) throw coded('OS0191', `the registry has no job '${kind}'`);
      for (const state of ['pending', 'leased'] as const)
        for await (const waiting of jobs.page({ kind, state, limit: 1 })) if (waiting) throw coded('OS0192', `a '${kind}' job is already ${state === 'pending' ? 'waiting' : 'running'}`);
      const jobId = runId(kind, `now-${new Date(now()).toISOString()}`);
      await jobs.enqueue(kind, job.payload ?? {}, { id: jobId, maxAttempts: maxAttemptsOf(job) });
      return { id: jobId };
    },
    health: () => ({ runtime: id, at: now(), running, stats: worker ? { ...worker.stats(), reconcileErrors } : null }),
    leases: () => worker?.leases() ?? [],
  };
  return runtime;
}
