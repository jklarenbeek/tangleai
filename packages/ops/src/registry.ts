/**
 * The job registry: the JSON document a host writes to say which background
 * jobs it runs — what each calls, how safe it is to repeat, when it runs, how
 * many attempts it may take, what it may spend and who owns it. The runtime
 * runs exactly what it says; a document it cannot run is refused with the
 * place (a JSON Pointer) and the reason.
 *
 * Every job declares how safe it is to repeat, with the attempt categories of
 * `@jarenjs/core/retry`: `safe-read` (only reads), `provider-idempotent` (the
 * operation takes the job id as its idempotency key), `single-send` (it must
 * never run twice: one attempt, no catch-up; a lost attempt is a person's
 * decision).
 */
import { compileRecurrence, floatingValue, utcValue } from '@jarenjs/core/calendar';

export type JobSafety = 'safe-read' | 'provider-idempotent' | 'single-send';
export type RegistrySchedule = {
  /** A floating start: the wall clock in `zone` (daily, weekly, or wall-clock rules). */
  at?: { date: string, time: string },
  /** A fixed start in UTC, `YYYY-MM-DDTHH:MM:SSZ` (intervals counted in elapsed time). */
  utc?: string,
  rrule: string,
  zone?: string,
  policy?: 'rfc5545' | 'later' | 'reject',
  missed?: 'skip' | 'once' | { catchUp: number },
  latenessMs?: number,
};
export type RegistryJob = {
  kind: string,
  title: Record<string, string>,
  description?: Record<string, string>,
  handler: { contract: string, operation: string } | { code: string },
  safety: JobSafety,
  payload?: Record<string, unknown>,
  schedule?: RegistrySchedule,
  limits?: { maxAttempts?: number, leaseMs?: number },
  budget?: { runsPerDay: number },
  owner?: string,
};
export type JobRegistry = { $registry: '0.1', name: string, zone?: string, jobs: RegistryJob[] };
export type RegistryProblem = { pointer: string, message: string };

/** The kind the runtime's schedules fire; a registry job may not take it. */
export const FIRE_KIND = 'ops.fire';
const KIND = /^[a-z][a-z0-9._-]{0,63}$/;
const NAME = /^[a-z][a-z0-9-]{0,39}$/;
const LANG = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}(:\d{2})?$/, UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const texts = (v: unknown) => isRecord(v) && typeof v.en === 'string' && v.en.length > 0 && v.en.length <= 200
  && Object.entries(v).every(([k, t]) => LANG.test(k) && typeof t === 'string' && t.length <= 2000);

/** The compiled recurrence a registry schedule stands for (the series Jaren stores). */
export function seriesOf(schedule: RegistrySchedule): unknown {
  const dtstart = schedule.utc ? utcValue(schedule.utc) : floatingValue(schedule.at!.date, schedule.at!.time.slice(0, 5));
  return compileRecurrence({ dtstart, rrule: schedule.rrule });
}

/** Whether a document is a registry the runtime can run; every problem with its pointer. */
export function checkRegistry(value: unknown): { ok: true, registry: JobRegistry } | { ok: false, problems: RegistryProblem[] } {
  const problems: RegistryProblem[] = [];
  const say = (pointer: string, message: string) => { problems.push({ pointer, message }); };
  if (!isRecord(value)) return { ok: false, problems: [{ pointer: '', message: 'a registry is an object' }] };
  for (const key of Object.keys(value)) if (!['$registry', 'name', 'zone', 'jobs'].includes(key)) say(`/${key}`, 'is not a registry member');
  if (value.$registry !== '0.1') say('/$registry', "is '0.1'");
  if (typeof value.name !== 'string' || !NAME.test(value.name)) say('/name', 'is a lower-case name of letters, digits and hyphens');
  if (value.zone !== undefined && (typeof value.zone !== 'string' || !value.zone)) say('/zone', 'is a time zone name');
  if (!Array.isArray(value.jobs)) say('/jobs', 'is a list');
  const seen = new Set<string>();
  (Array.isArray(value.jobs) ? value.jobs : []).forEach((job: unknown, i: number) => {
    const at = `/jobs/${i}`;
    if (!isRecord(job)) { say(at, 'is an object'); return; }
    for (const key of Object.keys(job)) if (!['kind', 'title', 'description', 'handler', 'safety', 'payload', 'schedule', 'limits', 'budget', 'owner'].includes(key)) say(`${at}/${key}`, 'is not a job member');
    if (typeof job.kind !== 'string' || !KIND.test(job.kind) || job.kind === FIRE_KIND) say(`${at}/kind`, `is a kind of lower-case letters, digits, dots and hyphens, not '${FIRE_KIND}'`);
    else if (seen.has(job.kind)) say(`${at}/kind`, `'${job.kind}' is registered twice`);
    else seen.add(job.kind);
    if (!texts(job.title)) say(`${at}/title`, 'has an English text (en) and texts per language');
    if (job.description !== undefined && !texts(job.description)) say(`${at}/description`, 'has an English text (en) and texts per language');
    const h = job.handler;
    const contractHandler = isRecord(h) && typeof h.contract === 'string' && h.contract.length > 0 && typeof h.operation === 'string' && h.operation.length > 0 && Object.keys(h).length === 2;
    const codeHandler = isRecord(h) && typeof h.code === 'string' && h.code.length > 0 && Object.keys(h).length === 1;
    if (!contractHandler && !codeHandler) say(`${at}/handler`, 'is { contract, operation } or { code }');
    if (!['safe-read', 'provider-idempotent', 'single-send'].includes(job.safety as string)) say(`${at}/safety`, "says how safe it is to repeat: 'safe-read', 'provider-idempotent' or 'single-send'");
    if (job.payload !== undefined && !isRecord(job.payload)) say(`${at}/payload`, 'is an object');
    if (job.owner !== undefined && (typeof job.owner !== 'string' || !job.owner)) say(`${at}/owner`, 'is a role name');
    const limits = job.limits;
    if (limits !== undefined) {
      if (!isRecord(limits) || Object.keys(limits).some(k => !['maxAttempts', 'leaseMs'].includes(k))) say(`${at}/limits`, 'has maxAttempts and leaseMs');
      else {
        if (limits.maxAttempts !== undefined && !(Number.isInteger(limits.maxAttempts) && (limits.maxAttempts as number) >= 1 && (limits.maxAttempts as number) <= 20)) say(`${at}/limits/maxAttempts`, 'is a whole number from 1 to 20');
        if (limits.leaseMs !== undefined && !(Number.isInteger(limits.leaseMs) && (limits.leaseMs as number) >= 1000)) say(`${at}/limits/leaseMs`, 'is a whole number of milliseconds from 1000');
        if (job.safety === 'single-send' && limits.maxAttempts !== undefined && limits.maxAttempts !== 1) say(`${at}/limits/maxAttempts`, 'is 1 for a single-send job: it must never run twice');
      }
    }
    const budget = job.budget;
    if (budget !== undefined && !(isRecord(budget) && Object.keys(budget).length === 1 && Number.isInteger(budget.runsPerDay) && (budget.runsPerDay as number) >= 1)) say(`${at}/budget`, 'is { runsPerDay } with a whole number from 1');
    const s = job.schedule;
    if (s !== undefined) {
      if (!isRecord(s)) { say(`${at}/schedule`, 'is an object'); return; }
      for (const key of Object.keys(s)) if (!['at', 'utc', 'rrule', 'zone', 'policy', 'missed', 'latenessMs'].includes(key)) say(`${at}/schedule/${key}`, 'is not a schedule member');
      const floating = isRecord(s.at), fixed = typeof s.utc === 'string';
      if (floating === fixed) say(`${at}/schedule`, 'starts either at a wall clock (at, with a zone) or at a UTC instant (utc)');
      if (floating && !(typeof (s.at as any).date === 'string' && DATE.test((s.at as any).date) && typeof (s.at as any).time === 'string' && TIME.test((s.at as any).time))) say(`${at}/schedule/at`, 'is { date: YYYY-MM-DD, time: HH:MM }');
      if (floating && (typeof s.zone !== 'string' || !s.zone) && typeof value.zone !== 'string') say(`${at}/schedule/zone`, 'is needed for a wall-clock start (or the registry zone)');
      if (fixed && !UTC.test(s.utc as string)) say(`${at}/schedule/utc`, 'is YYYY-MM-DDTHH:MM:SSZ');
      if (fixed && s.zone !== undefined) say(`${at}/schedule/zone`, 'is not taken by a UTC start');
      if (typeof s.rrule !== 'string' || !s.rrule) say(`${at}/schedule/rrule`, 'is an RFC 5545 rule');
      if (s.policy !== undefined && !['rfc5545', 'later', 'reject'].includes(s.policy as string)) say(`${at}/schedule/policy`, "is 'rfc5545', 'later' or 'reject'");
      const missed = s.missed;
      const missedOk = missed === undefined || missed === 'skip' || missed === 'once' || (isRecord(missed) && Object.keys(missed).length === 1 && Number.isInteger(missed.catchUp) && (missed.catchUp as number) >= 1);
      if (!missedOk) say(`${at}/schedule/missed`, "is 'skip', 'once' or { catchUp }");
      else if (job.safety === 'single-send' && missed !== undefined && missed !== 'skip') say(`${at}/schedule/missed`, "is 'skip' for a single-send job: a missed run is never caught up");
      if (s.latenessMs !== undefined && !(Number.isInteger(s.latenessMs) && (s.latenessMs as number) > 0)) say(`${at}/schedule/latenessMs`, 'is a positive whole number of milliseconds');
      if (floating !== fixed && typeof s.rrule === 'string' && s.rrule) {
        try { seriesOf(s as RegistrySchedule); }
        catch (error: any) { say(`${at}/schedule/rrule`, `is refused by the calendar: ${String(error?.message ?? error).slice(0, 200)}`); }
      }
    }
  });
  return problems.length ? { ok: false, problems } : { ok: true, registry: value as JobRegistry };
}

/** The attempts a job may take: 1 for single-send, else its limit or Jaren's default of 5. */
export const maxAttemptsOf = (job: RegistryJob) => job.safety === 'single-send' ? 1 : job.limits?.maxAttempts ?? 5;
