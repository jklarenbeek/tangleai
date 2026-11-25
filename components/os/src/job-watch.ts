/**
 * The desktop's job watcher: background work that needs a person reaches
 * them. Over the host's job queue (the `job_queue` contract, `jobs.ts`) it
 * reads, once an interval, the dead jobs, the history since its last read and
 * the runtimes' heartbeats, and files ONE inbox item per job or runtime
 * through the kernel (`fileJobFailure`, `fileRuntimeSilent`): a dead job, a
 * single-send job a crash cut off (`not-repeated`), a job that keeps failing
 * (a third failed attempt), and a background runtime that stopped reporting.
 * An item is updated, never duplicated; a runtime that reports again takes its
 * item back.
 *
 * The item is filed at once — it is in the inbox and in Jobs immediately. Its
 * NOTICE (the item's `attention`, which the dock's mail button shows) is given
 * only inside the person's working hours; outside them, or when the hours are
 * unknown, it waits (unknown time is never working time), and when a working
 * period begins every item still open is noticed again. What the person
 * decided is remembered (`remember`), so a dismissed failure is not filed
 * again after a reload unless the job failed anew.
 *
 * A queue that answers for several products (`scopes()`, a combined queue)
 * is looked at product by product: every item names its product and is keyed
 * by it, and a product whose host is not there or is starting is passed over
 * quietly while the others are still looked at.
 */
import { JOB_CODES, type JobQueue, type RegisteredJob, type JobScope } from './jobs.ts';

/** The weekdays the Calendar's working hours name. */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
/** The person's working hours: the days, and a start and end of day (`HH:MM`, end exclusive). */
export type WorkingHours = { days: Weekday[], start: string, end: string };
/** How long a runtime may be silent before the person hears of it (as the Jobs app's warning). */
export const SILENT_AFTER_MS = 90_000;

type WatchKernel = {
  fileJobFailure(input: { jobId: string, kind: string, titles?: Record<string, string>, reason: 'dead' | 'not-repeated' | 'failing', lastError?: string, attempts: number, attention: boolean, owner?: string, scope?: string, scopeTitles?: Record<string, string> }): unknown,
  fileRuntimeSilent(input: { runtime: string, lastSeen: number, attention: boolean, scope?: string, scopeTitles?: Record<string, string> }): unknown,
  withdrawDesktop(id: string): unknown,
  noticeMail(id: string): unknown,
  mail(): readonly { from: string, attention?: boolean, proposal?: { id: string, kind: string, status: string, payload?: unknown } }[],
};
export type JobWatchOptions = {
  kernel: WatchKernel,
  queue: JobQueue,
  /** The person's working hours, read at every interval (they change in the Calendar); `undefined` = unknown. */
  hours?: () => WorkingHours | undefined,
  /** The zone the hours are in (default: this browser's). */
  zone?: string,
  now?: () => number,
  intervalMs?: number,
  silentAfterMs?: number,
  /** What the person decided, kept across reloads: job id (with its product's scope, when it has one) → the attempts of the failure they decided on. */
  remember?: { load(): Record<string, number>, save(decided: Record<string, number>): void },
  setTimer?: (run: () => void, ms: number) => unknown,
  clearTimer?: (handle: unknown) => void,
};

const DAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** Whether `at` falls inside the working hours (in `zone`); unknown hours are never working time. */
export function withinHours(at: number, hours: WorkingHours | undefined, zone?: string): boolean {
  if (!hours || !hours.days?.length || !/^\d{2}:\d{2}$/.test(hours.start) || !/^\d{2}:\d{2}$/.test(hours.end)) return false;
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at); }
  catch { return false; }
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const day = DAYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))];
  const time = `${get('hour').padStart(2, '0')}:${get('minute').padStart(2, '0')}`;
  return hours.days.includes(day) && time >= hours.start && time < hours.end;
}

/** The key a decision is remembered by: the job id, with its product's scope in front when it has one. */
export const decisionKey = (jobId: string, scope?: string) => scope ? `${scope}\u001f${jobId}` : jobId;
/** The id the kernel gives a runtime's silence item, so the watcher can take it back. */
const silentId = (runtime: string, scope?: string) => `runtime-silent-${scope ? `${scope}-` : ''}${runtime}`.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 128);
const quiet = (error: any) => error?.code === JOB_CODES.unconfigured || error?.code === JOB_CODES.starting;

/** Start watching; the first look is immediate. `tick()` looks once (tests drive it); `stop()` ends the watch. */
export function watchJobs(options: JobWatchOptions): { tick(): Promise<void>, stop(): void } {
  const { kernel, queue } = options;
  const now = options.now ?? Date.now;
  const silentAfter = options.silentAfterMs ?? SILENT_AFTER_MS;
  const setTimer = options.setTimer ?? ((run, ms) => setInterval(run, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearInterval(handle as any));
  let wasWorking: boolean | null = null, stopped = false;
  // each product's own reading: its history cursor, its registered titles, its single-sends a crash cut off
  const parts = new Map<string, { after?: number, titles: Map<string, RegisteredJob> | null, notRepeated: Set<string> }>();
  const partOf = (scope: string) => { let part = parts.get(scope); if (!part) parts.set(scope, part = { titles: null, notRepeated: new Set() }); return part; };
  const decided: Record<string, number> = (() => { try { return { ...(options.remember?.load() ?? {}) }; } catch { return {}; } })();
  const ours = () => kernel.mail().filter(m => m.from === 'desktop' && (m.proposal?.kind === 'job.failed' || m.proposal?.kind === 'runtime.silent'));
  /** The products to look at: a plain queue is one unnamed product. */
  const scopes = (): (JobScope | null)[] => {
    let answer: unknown;
    try { answer = queue.scopes?.(); } catch { answer = undefined; }
    if (answer && typeof (answer as any).then === 'function') (answer as Promise<unknown>).catch(() => {});   // not a combined queue
    return Array.isArray(answer) && answer.length ? answer as JobScope[] : [null];
  };

  async function lookAt(part: JobScope | null, working: boolean) {
    const where = part ? { scope: part.scope } : {};
    const state = partOf(part?.scope ?? '');
    if (!state.titles) state.titles = await queue.registry(where).then(r => new Map(r.jobs.map(j => [j.kind, j])), () => null);
    const file = (jobId: string, kind: string, reason: 'dead' | 'not-repeated' | 'failing', attempts: number, lastError?: string) => {
      if (decided[decisionKey(jobId, part?.scope)] === attempts) return;
      const registered = state.titles?.get(kind);
      kernel.fileJobFailure({ jobId, kind, reason, attempts, attention: working,
        ...(part ? { scope: part.scope, scopeTitles: part.title } : {}),
        ...(registered ? { titles: registered.title, ...(registered.owner ? { owner: registered.owner } : {}) } : {}), ...(lastError ? { lastError } : {}) });
    };
    // the history since the last look: a single-send job a crash cut off, a job on its third failed attempt
    const { events } = await queue.events({ ...where, ...(state.after !== undefined ? { after: state.after } : {}), limit: 200 });
    for (const e of events) {
      state.after = Math.max(state.after ?? 0, e.at);
      if (e.event === 'not-repeated' && e.jobId) state.notRepeated.add(e.jobId);
    }
    for (const e of events) {
      if (e.event !== 'failed' || !e.jobId || (e.attempt ?? 0) < 3) continue;
      const job = await queue.get({ ...where, id: e.jobId }).catch(() => null);
      if (job?.state === 'failed') file(job.id, job.kind, 'failing', job.attempts, job.lastError?.message);
    }
    // the dead jobs
    const { items } = await queue.page({ ...where, state: 'dead', limit: 200 });
    for (const job of items) file(job.id, job.kind, state.notRepeated.has(job.id) ? 'not-repeated' : 'dead', job.attempts, job.lastError?.message);
    // runtimes that stopped reporting, and those that report again
    const health = await queue.health(where);
    for (const r of health.runtimes) {
      if (health.now - r.at > silentAfter) kernel.fileRuntimeSilent({ runtime: r.runtime, lastSeen: r.at, attention: working, ...(part ? { scope: part.scope, scopeTitles: part.title } : {}) });
      else kernel.withdrawDesktop(silentId(r.runtime, part?.scope));
    }
  }

  async function look() {
    const at = now();
    const working = withinHours(at, options.hours?.(), options.zone);
    // a working period begins: every item still open is noticed again
    if (working && wasWorking === false) for (const m of ours()) if (m.proposal!.status === 'pending') kernel.noticeMail(m.proposal!.id);
    wasWorking = working;
    // what the person decided is remembered, so a reload does not file it again
    let changed = false;
    for (const m of ours()) {
      const p = m.proposal!, payload = p.payload as { jobId?: string, attempts?: number, scope?: string } | undefined;
      if (p.kind !== 'job.failed' || (p.status !== 'accepted' && p.status !== 'rejected') || !payload?.jobId) continue;
      const key = decisionKey(payload.jobId, payload.scope);
      if (decided[key] !== payload.attempts) { decided[key] = payload.attempts ?? 0; changed = true; }
    }
    if (changed) try { options.remember?.save(decided); } catch { /* kept for this page */ }
    // product by product: one that is not there or is starting is passed over, the others are still looked at
    let failure: unknown = null;
    for (const part of scopes()) {
      try { await lookAt(part, working); }
      catch (error) { if (!quiet(error)) failure ??= error; }
    }
    if (failure) throw failure;
  }

  let running: Promise<void> | null = null;
  const once = () => {
    running = (async () => {
      try { await look(); }
      catch (error: any) { if (error?.code !== JOB_CODES.unconfigured && error?.code !== JOB_CODES.starting) throw error; }
    })().finally(() => { running = null; });
    return running;
  };
  /** One look; a look already under way is waited for first, so what changed since is seen. */
  const tick = async () => {
    while (running) await running.catch(() => {});
    if (stopped) return;
    return once();
  };
  // the interval never piles looks up: one under way is enough
  const run = () => { if (!running && !stopped) void once().catch(() => { /* a failed look is tried again next interval */ }); };
  const handle = setTimer(run, options.intervalMs ?? 30_000);
  run();
  return { tick, stop: () => { stopped = true; clearTimer(handle); } };
}
