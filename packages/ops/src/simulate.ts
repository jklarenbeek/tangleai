/**
 * What the background work will do: a registry run over days on a separate,
 * in-memory copy with its own clock, so a person sees in seconds every run per
 * job, the runs a clock change moves and — with a chosen failure rate — how
 * retries, given-up jobs and not-repeated single-sends would look.
 *
 * Nothing real is touched: the store is `:memory:`, every job's handler is a
 * recorder (a contract operation, a page task or a host's code is never
 * called), and every history event is marked simulated. The clock moves only
 * while no attempt is in flight (a jump during a running handler would lose its
 * lease) and waits for the worker to tick at each step.
 *
 * The simulation assumes the host is up the whole time: every due run fires
 * (the schedules are simulated with a catch-up, as a host ticking every poll
 * fires each occurrence), so a lateness window — which only skips runs after
 * downtime — never applies here. A budget does: runs past `runsPerDay` count as
 * skipped.
 */
import { openStore } from '@jarenjs/db';
import { jobSchedules } from '@jarenjs/db/schedules';
import { createRuntime } from '@jarenjs/core/runtime';
import { createOpsRuntime } from './runtime.ts';
import { OPS_EVENTS_COLLECTIONS } from './events.ts';
import { FIRE_KIND, type JobRegistry } from './registry.ts';

export type SimulatedJobDay = { kind: string, fired: number, completed: number, retried: number, failed: number, dead: number, notRepeated: number, skipped: number, marks: ('gap' | 'fold')[] };
export type SimulatedDay = { date: string, jobs: SimulatedJobDay[] };
export type Simulation = { from: number, days: SimulatedDay[], totals: Omit<SimulatedJobDay, 'marks'> & { kinds: number }, wallMs: number, simulated: true };
export type SimulateOptions = {
  /** A Jaren driver that opens an in-memory database (`nodeDriver()`, or `wasmDriver(sqlite3Handle(sqlite3))`). */
  driver: any,
  /** The first instant simulated (default: now). */
  from?: number,
  /** How many days, 1–31. */
  days: number,
  /** The clock's step; every due run inside a step still fires (default one hour). */
  stepMs?: number,
  /** The share of attempts that fail, 0–1, decided by `seed` (default 0). */
  failRate?: number,
  seed?: number,
  zoneProvider: unknown,
};

const HOUR = 3_600_000, DAY = 86_400_000;
/** A deterministic share in [0, 1) for one attempt: the same job, attempt and seed always fail or never. */
function share(text: string, seed: number) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}
const dateIn = (at: number, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const wallIn = (at: number, zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(at).replace(', ', 'T');

/** Run `registry` over `days` on its own in-memory copy and answer, per day and job, what would happen. */
export async function simulateRegistry(registry: JobRegistry, options: SimulateOptions): Promise<Simulation> {
  const days = Math.max(1, Math.min(31, Math.floor(options.days)));
  const failRate = Math.max(0, Math.min(1, options.failRate ?? 0)), seed = options.seed ?? 1;
  const stepMs = Math.max(60_000, options.stepMs ?? HOUR);
  const from = options.from ?? Date.now();
  const zone = registry.zone ?? 'UTC';
  // the end is the same wall time `days` days later in the registry's zone (a clock change makes a day 23 or 25 hours)
  const to = (() => {
    const target = new Date(Date.parse(`${dateIn(from, zone)}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10) + wallIn(from, zone).slice(10);
    for (let shift = -3; shift <= 3; shift++) { const t = from + days * DAY + shift * HOUR; if (wallIn(t, zone) === target) return t; }
    return from + days * DAY;
  })();
  const started = performance.now();
  // every job becomes a recorder; every schedule catches up on what a step passed (no downtime in a simulation)
  const calls: { kind: string, jobId: string, attempt: number }[] = [];
  const sim: JobRegistry = {
    ...registry, name: 'simulation',
    jobs: registry.jobs.map(j => ({ ...j, handler: { code: `record:${j.kind}` },
      ...(j.schedule ? { schedule: { ...j.schedule, missed: { catchUp: 100_000 }, latenessMs: undefined } } : {}) })),
  };
  const handlers: Record<string, (p: unknown, ctx: { job: any }) => Promise<unknown>> = {};
  for (const j of registry.jobs) handlers[`record:${j.kind}`] = async (_p, { job }) => {
    calls.push({ kind: j.kind, jobId: job.id, attempt: job.attempts });
    if (failRate > 0 && share(`${job.id}#${job.attempts}`, seed) < failRate) throw new Error('simulated failure');
    return {};
  };
  const clock = { t: from };
  const store: any = await openStore({ $model: '0.1', collections: { ...OPS_EVENTS_COLLECTIONS } } as any, {
    driver: options.driver, runtime: createRuntime({ zoneProvider: options.zoneProvider as any, now: () => clock.t }), jobs: { schedules: jobSchedules() },
  } as any);
  const runtime = createOpsRuntime({ store, registry: sim, handlers, id: 'simulation', now: () => clock.t, simulated: true, heartbeatMs: 3_600_000, worker: { pollInterval: 1, concurrency: 1 } });
  const until = async (test: () => Promise<boolean> | boolean) => { for (let n = 0; n < 20_000 && !(await test()); n++) await new Promise(r => setTimeout(r, 0)); };
  const idle = async () => { const c = await store.jobs.counts(); return c.pending === 0 && c.leased === 0 && (runtime.health().stats?.inFlight ?? 0) === 0; };
  try {
    await runtime.start();
    for (clock.t = from; clock.t <= to;) {
      const before = runtime.health().stats?.ticks ?? 0;
      await until(() => (runtime.health().stats?.ticks ?? 0) >= before + 2);
      // retries wait out their backoff on the simulated clock: let each step's retries come due before moving on
      for (let pass = 0; pass < 12; pass++) {
        await until(idle);
        const { pending } = await store.jobs.counts();
        if (!pending) break;
        clock.t += 61_000; // past the longest backoff (60 s) while staying inside the step
        await until(idle);
      }
      if (clock.t >= to) break;
      clock.t = Math.min(to, clock.t + stepMs);   // only while idle (checked above)
    }
    await runtime.stop({ graceMs: 1000 });
    // per day and job: the run's own instant is its schedule occurrence (the fire job's runAt), else when it ran
    const rows: any[] = [];
    for await (const job of store.jobs.page({ limit: 1_000_000 })) if (job.kind !== FIRE_KIND) rows.push(job);
    const events: any[] = [];
    { const all = await store.collection('ops_events').execute({ $for: { it: '$[*]' }, $where: { $ne: ['$it.event', 'heartbeat'] }, $return: '$it' }); events.push(...(all === undefined ? [] : Array.isArray(all) ? all : [all])); }
    const ofJob = new Map<string, any[]>();
    for (const e of events) if (e.jobId) (ofJob.get(e.jobId) ?? ofJob.set(e.jobId, []).get(e.jobId)!).push(e);
    const byDay = new Map<string, Map<string, SimulatedJobDay>>();
    const cell = (date: string, kind: string) => {
      const d = byDay.get(date) ?? byDay.set(date, new Map()).get(date)!;
      return d.get(kind) ?? d.set(kind, { kind, fired: 0, completed: 0, retried: 0, failed: 0, dead: 0, notRepeated: 0, skipped: 0, marks: [] }).get(kind)!;
    };
    const safety = new Map(registry.jobs.map(j => [j.kind, j.safety]));
    for (const job of rows) {
      const fire = String(job.id).replace(/^run:simulation:/, 'ops:simulation:');
      const occurrence = fire !== job.id ? (await store.jobs.get(fire))?.runAt ?? job.createdAt : job.createdAt;
      if (occurrence < from || occurrence >= to) continue;
      const c = cell(dateIn(occurrence, zone), job.kind);
      const es = ofJob.get(job.id) ?? [];
      if (es.some(e => e.event === 'budget')) { c.skipped++; continue; }
      c.fired++;
      if (job.state === 'done') c.completed++;
      c.retried += Math.max(0, es.filter(e => e.event === 'started').length - 1);
      c.failed += es.filter(e => e.event === 'failed').length;
      if (job.state === 'dead') { c.dead++; if (safety.get(job.kind) === 'single-send') c.notRepeated++; }
      // a clock change: a floating run whose wall time is not its rule's (a gap), or a wall time that happens twice (a fold)
      const rid = String(job.id).slice(String(job.id).indexOf('@') + 1);
      const reg = registry.jobs.find(j => j.kind === job.kind);
      if (reg?.schedule?.at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rid)) {
        const z = reg.schedule.zone ?? zone;
        if (wallIn(occurrence, z) !== rid.slice(0, 16) && !c.marks.includes('gap')) c.marks.push('gap');
        if ((wallIn(occurrence - HOUR, z) === wallIn(occurrence, z) || wallIn(occurrence + HOUR, z) === wallIn(occurrence, z)) && !c.marks.includes('fold')) c.marks.push('fold');
      }
    }
    const daysOut: SimulatedDay[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([date, m]) => ({ date, jobs: [...m.values()].sort((a, b) => a.kind.localeCompare(b.kind)) }));
    const totals = { kind: '*', kinds: new Set(rows.map(r => r.kind)).size, fired: 0, completed: 0, retried: 0, failed: 0, dead: 0, notRepeated: 0, skipped: 0 };
    for (const d of daysOut) for (const j of d.jobs) for (const k of ['fired', 'completed', 'retried', 'failed', 'dead', 'notRepeated', 'skipped'] as const) totals[k] += j[k];
    return { from, days: daysOut, totals, wallMs: Math.round(performance.now() - started), simulated: true };
  } finally {
    try { await runtime.stop({ graceMs: 100 }); } catch { /* stopped */ }
    await store.close();
  }
}

/** An RFC 5545 rule's text from the rule object Jaren stores (`{ FREQ: 'WEEKLY', BYDAY: ['MO'] }`); `null` for a part it cannot spell. */
export function ruleText(rrule: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(rrule)) {
    if (!/^[A-Z]+$/.test(key)) return null;
    const v = Array.isArray(value) ? value.map(x => (typeof x === 'string' || typeof x === 'number') ? String(x) : null) : [(typeof value === 'string' || typeof value === 'number') ? String(value) : null];
    if (v.some(x => x === null)) return null;
    parts.push(`${key}=${v.join(',')}`);
  }
  return parts.length ? parts.join(';') : null;
}

/**
 * The registry a host runs, rebuilt from what the desktop can read of it — the registered jobs and their schedules
 * (`jobs.registry` and `jobs.schedules`) — so the simulation needs nothing the contract does not already answer. A job
 * whose rule cannot be spelled again is left out (and listed).
 */
export function registryFromHost(
  registered: readonly { kind: string, title: Record<string, string>, safety: 'safe-read' | 'provider-idempotent' | 'single-send', scheduled: boolean, schedule?: string }[],
  schedules: readonly { id: string, series: any, zone: string | null, policy?: string | null, missed?: unknown }[],
  zone?: string,
): { registry: JobRegistry, left: string[] } {
  const left: string[] = [];
  const jobs = registered.flatMap(job => {
    const s = job.scheduled ? schedules.find(x => x.id === job.schedule) : undefined;
    if (!s) return [];
    const rrule = s.series?.rrule && typeof s.series.rrule === 'object' ? ruleText(s.series.rrule) : null;
    const start = s.series?.dtstart;
    if (!rrule || !start) { left.push(job.kind); return []; }
    const schedule = start.kind === 'utc' && typeof start.instant === 'string' ? { utc: start.instant.replace(/\.\d{3}Z$/, 'Z'), rrule }
      : start.kind === 'floating' && typeof start.date === 'string' && typeof start.time === 'string' ? { at: { date: start.date, time: start.time.slice(0, 5) }, rrule, ...(s.zone ? { zone: s.zone } : {}), ...(s.policy ? { policy: s.policy as any } : {}) }
      : null;
    if (!schedule) { left.push(job.kind); return []; }
    return [{ kind: job.kind, title: job.title, handler: { code: 'simulated' }, safety: job.safety, schedule }];
  });
  return { registry: { $registry: '0.1', name: 'host', ...(zone ? { zone } : {}), jobs } as JobRegistry, left };
}
