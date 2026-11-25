/**
 * The desktop's Jobs: the background work a host runs, as the person sees it.
 * It reads only through the `job_queue` contract (`./jobs.ts`): the host's
 * recurring schedules, with their rule in words and their next runs, and its
 * queue by state, failures first. The person cancels, runs again or removes
 * with one confirmation in place; every answer, or the coded refusal, is said
 * in the status line. A job's payload and result never reach the desktop.
 *
 * The next runs are computed here from the schedule's own rule document with
 * Jaren's calendar, in the schedule's time zone: a run the spring clock change
 * moved and a wall time the autumn change repeats are marked. A floating rule
 * needs the host's zone data (`zoneProvider`); without it the rule is still
 * said, and the runs are not guessed.
 *
 * Where the host runs Tangle's operations runtime, Jobs shows more: a
 * registered job by its title with Run now (asked once in place when it must
 * never run twice), each job's attempts, and whether the runtime still
 * reports. A host without them answers nothing for these, and Jobs shows none.
 */
import { classifyLocal, floatingValue, formatRRule, nextOccurrences, resolveLocal, utcValue } from '@jarenjs/core/calendar';
import { createOsMessages, type OsCatalogue, type OsMessageKey } from './messages.ts';
import { JOB_CODES, type JobCounts, type JobEvent, type JobItem, type JobQueue, type JobRuntimeHealth, type JobSchedule, type JobState, type RegisteredJob } from './jobs.ts';
import type { ModuleManifest } from './manifest.ts';
import type { ShippedContext, ShippedMount } from './shell.ts';

export type JobsOptions = {
  /** The host's queue: the desktop's kernel `jobQueue()`, or `unconfiguredJobQueue()` where it has none. */
  queue: JobQueue,
  /** Where the person names a job host (the host's own Settings section); the desktop's Settings by default. */
  configure?: () => void,
  messages?: Partial<OsCatalogue>,
  /** The language `messages` is in: dates, numbers and the title of Jobs in it. */
  locale?: string,
  /** The zone data a floating rule's runs are computed with (`@jarenjs/locales/intl-zones`, for example). */
  zoneProvider?: unknown,
  id?: string,
  /** The clock (tests). */
  now?: () => number,
  /** Whether this tab's own worker runs the host's background runtime (the browser twin); said on the heartbeat line. */
  ownsRuntime?: () => boolean,
  /** How often an open, visible Jobs window reads again, in milliseconds (default 10 s). */
  refreshMs?: number,
};

type Translate = (key: OsMessageKey, values?: Record<string, string | number>) => string;
type Series = { kind?: string, dtstart?: { kind?: string, date?: string, time?: string, instant?: string, zone?: string }, rrule?: Record<string, unknown>, policy?: string };

/** The order the desktop lists states in: what needs a person first. */
export const STATE_ORDER: readonly JobState[] = ['failed', 'dead', 'leased', 'pending', 'done', 'cancelled'];
const DANGER: ReadonlySet<JobState> = new Set(['failed', 'dead']);
const RULE_KEYS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND', 'BYMONTHDAY', 'WKST']);
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const list = (value: unknown) => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(Number).filter(Number.isFinite);
const unit = (locale: string, n: number, name: string) => new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'long' }).format(n);
const join = (locale: string, items: string[]) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
const clock = (locale: string, hours: number, minutes: number) =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, hours, minutes)));
const weekday = (locale: string, code: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2027, 2, 1 + WEEKDAYS.indexOf(code))));

/** The rule's times of day: its BYHOUR × BYMINUTE, or its start's time. */
function times(series: Series, locale: string): string[] | null {
  const rule = series.rrule ?? {};
  let hours = list(rule.BYHOUR), minutes = list(rule.BYMINUTE);
  const start = series.dtstart ?? {};
  const time = start.kind === 'utc' ? (start.instant ?? '').slice(11, 16) : (start.time ?? '').slice(0, 5);
  const [h0, m0] = /^\d{2}:\d{2}$/.test(time) ? time.split(':').map(Number) : [NaN, NaN];
  if (!hours.length) hours = Number.isFinite(h0) ? [h0] : [];
  if (!minutes.length) minutes = Number.isFinite(m0) ? [m0] : [0];
  if (!hours.length || hours.length * minutes.length > 12) return null;
  return hours.flatMap(h => minutes.map(m => clock(locale, h, m)));
}

/**
 * A schedule's rule in words: every so many seconds, minutes or hours; a day,
 * days of the week or days of the month at their times. A rule it cannot say
 * plainly is shown as its RRULE text.
 */
export function describeRule(series: Series, zone: string | null, t: Translate, locale = 'en'): string {
  const rule = series?.rrule;
  const raw = () => t('jobs/rule', { rule: rule ? formatRRule(rule as any) : String(series?.kind ?? '') });
  if (!rule || series.kind !== 'recurrence' || Object.keys(rule).some(k => !RULE_KEYS.has(k))) return raw();
  const interval = Number(rule.INTERVAL ?? 1);
  const freq = String(rule.FREQ);
  const sub: Record<string, string> = { SECONDLY: 'second', MINUTELY: 'minute', HOURLY: 'hour' };
  let words: string | null = null;
  if (sub[freq] && !rule.BYDAY && !rule.BYMONTHDAY && !rule.BYHOUR && !rule.BYMINUTE) {
    const one = freq === 'SECONDLY' ? t('jobs/every-second') : freq === 'MINUTELY' ? t('jobs/every-minute') : t('jobs/every-hour');
    words = interval === 1 ? one : t('jobs/every-interval', { interval: unit(locale, interval, sub[freq]) });
  }
  else if (freq === 'DAILY' && !rule.BYDAY && !rule.BYMONTHDAY) {
    const at = times(series, locale);
    if (at) words = interval === 1 ? t('jobs/daily', { times: join(locale, at) }) : t('jobs/every-days', { interval: unit(locale, interval, 'day'), times: join(locale, at) });
  }
  else if (freq === 'WEEKLY' && !rule.BYMONTHDAY) {
    const days = (Array.isArray(rule.BYDAY) ? rule.BYDAY : rule.BYDAY ? [rule.BYDAY] : []).map(String);
    const at = times(series, locale);
    if (at && days.length && days.every(d => WEEKDAYS.includes(d))) {
      const named = join(locale, days.map(d => weekday(locale, d)));
      words = interval === 1 ? t('jobs/weekly', { days: named, times: join(locale, at) }) : t('jobs/every-weeks', { interval: unit(locale, interval, 'week'), days: named, times: join(locale, at) });
    }
  }
  else if (freq === 'MONTHLY' && interval === 1 && !rule.BYDAY) {
    const days = list(rule.BYMONTHDAY);
    const at = times(series, locale);
    if (at && days.length && days.every(d => d >= 1 && d <= 31)) words = t('jobs/monthly', { days: join(locale, days.map(d => new Intl.NumberFormat(locale).format(d))), times: join(locale, at) });
  }
  if (!words) return raw();
  const floating = series.dtstart?.kind === 'floating' || series.dtstart?.kind === 'date';
  return floating && zone ? t('jobs/in-zone', { rule: words, zone }) : words;
}

/** One run as the desktop shows it: its instant, and whether a clock change moved it (`gap`) or it falls in a repeated hour (`fold`). */
export type NextRun = { at: number, mark?: 'gap' | 'fold' };

const wallParts = (instant: number, zone: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
};

/**
 * The next `n` runs of a schedule after `from`, computed from its rule with
 * Jaren's calendar. A utc or zoned rule needs nothing more; a floating one is
 * bound in `zone` with `zoneProvider` and its policy, and `null` answers when
 * either is missing (the runs are not guessed).
 */
export function nextRuns(series: Series, zone: string | null, n: number, from: number, zoneProvider?: unknown): NextRun[] | null {
  if (series?.kind !== 'recurrence' || !series.dtstart) return null;
  const kind = series.dtstart.kind;
  try {
    if (kind === 'utc' || kind === 'zoned') {
      const start = utcValue(new Date(from + 1).toISOString().replace(/\.\d{3}Z$/, 'Z'));
      const found: any = nextOccurrences(series as any, kind === 'utc' ? start : start, n + 1, zoneProvider ? { zoneProvider } as any : undefined);
      return found.occurrences.map((o: any) => ({ at: o.instants?.start })).filter((r: NextRun) => Number.isFinite(r.at) && r.at > from).slice(0, n);
    }
    if (!zone || !zoneProvider) return null;
    const wall = wallParts(from, zone);
    // a day back, so a run the clock change moved past `from` is still found
    const back = wallParts(from - 86_400_000, zone);
    const found: any = nextOccurrences(series as any, floatingValue(back.date, back.time), n * 3 + 24, { zoneProvider } as any);
    const runs: NextRun[] = [];
    const seen = new Set<number>();
    for (const o of found.occurrences) {
      const [year, month, day] = String(o.start.date).split('-').map(Number);
      const [hours, minutes, seconds = 0] = String(o.start.time ?? '00:00').split(':').map(Number);
      const parts = { year, month, day, hours, minutes, seconds };
      const kindHere = (classifyLocal(parts as any, zone, zoneProvider as any) as any).kind;
      const { instant } = resolveLocal(parts as any, zone, { policy: (series.policy ?? 'rfc5545') as any, zoneProvider } as any) as any;
      if (!(instant > from) || seen.has(instant)) continue;
      seen.add(instant);
      runs.push(kindHere === 'gap' ? { at: instant, mark: 'gap' } : kindHere === 'fold' ? { at: instant, mark: 'fold' } : { at: instant });
      if (runs.length === n) break;
    }
    void wall;
    return runs;
  } catch { return null; }
}

/** The small job a schedule fires to enqueue the real one: kept out of the list and the waiting count. */
export const FIRE_KIND = 'ops.fire';
/** The code of a background runtime that has not answered yet (the browser twin starting or changing tabs). */
export const STARTING = 'OS0195';

/** How long the runtime may be silent before Jobs warns: three missed 30-second heartbeats. */
export const STALE_AFTER_MS = 90_000;

/** One attempt of a job as the history tells it: its start, its outcome, and whether it was not repeated or refused by a budget. */
export type AttemptRow = { attempt: number, started?: JobEvent, outcome?: JobEvent, notRepeated: boolean, budget: boolean };

/** A job's events as its attempts, oldest first. */
export function attemptRows(events: readonly JobEvent[]): AttemptRow[] {
  const rows = new Map<number, AttemptRow>();
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    const n = e.attempt ?? 0;
    const row = rows.get(n) ?? { attempt: n, notRepeated: false, budget: false };
    if (e.event === 'started') row.started = e;
    else if (e.event === 'not-repeated') row.notRepeated = true;
    else if (e.event === 'budget') row.budget = true;
    else row.outcome = e;
    rows.set(n, row);
  }
  return [...rows.values()].sort((a, b) => a.attempt - b.attempt);
}

/** How long ago the freshest runtime reported, by the host's clock; `null` when no runtime reports. */
export function runtimeAge(health: { now: number, runtimes: readonly JobRuntimeHealth[] } | null): number | null {
  if (!health?.runtimes.length) return null;
  return Math.max(0, health.now - Math.max(...health.runtimes.map(r => r.at)));
}

/** The Jobs module: its manifest and its mount. */
export function jobsModule(options: JobsOptions): { manifest: ModuleManifest, mount: ShippedMount } {
  const id = options.id ?? 'jobs';
  const t = createOsMessages(options.messages);
  const named = (en: string, text: string) => ({ en, ...(options.locale && options.locale !== 'en' && options.messages ? { [options.locale]: text } : {}) });
  const manifest: ModuleManifest = {
    $module: '0.1', id, version: '1.0.0', category: 'system',
    title: named('Jobs', t('jobs/title')), icon: { glyph: 'jobs', hue: 28 },
    host: { kind: 'shipped', mount: id },
    window: { width: 900, height: 640, minWidth: 380, minHeight: 360, singleton: true },
  };
  return { manifest, mount: (node, context) => mountJobs(node, context, options) };
}

type View = 'schedules' | 'queue';

function mountJobs(node: HTMLElement, context: ShippedContext, options: JobsOptions) {
  const doc = node.ownerDocument;
  const t = createOsMessages(options.messages);
  const locale = options.locale ?? context.locale ?? 'en';
  const now = options.now ?? (() => Date.now());
  const queue = options.queue;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) => { const e = doc.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
  const button = (className: string, text: string, onClick: () => void) => { const b = el('button', className, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };

  const root = el('div', 'tos-jobs');
  const states = el('div', 'tos-jobs-states');
  states.setAttribute('role', 'group'); states.setAttribute('aria-label', t('jobs/states'));
  const status = el('p', 'tos-jobs-status'); status.setAttribute('role', 'status');
  const view = el('div', 'tos-jobs-view');
  const pulse = el('p', 'tos-jobs-pulse');
  root.append(states, pulse, status, view);
  node.append(root);

  let current: View = 'schedules', counts: JobCounts | null = null, schedules: JobSchedule[] = [];
  let filter: JobState | null = null, items: JobItem[] = [], next: string | undefined, selected: string | null = null;
  let ticket = 0, unconfigured = false, closed = false;
  let registry: RegisteredJob[] = [], health: { now: number, runtimes: JobRuntimeHealth[] } | null = null;
  const attempts = new Map<string, JobEvent[] | null>();
  /** An optional operation (an older host has none, or refuses it): its answer, or `fallback`. */
  const optional = async <T>(call: (() => Promise<T>) | undefined, fallback: T): Promise<T> => { if (!call) return fallback; try { return await call(); } catch { return fallback; } };

  const say = (text: string, tone: '' | 'ok' | 'fail' = '', code = '') => { status.textContent = text; status.dataset.tone = tone; if (code) status.dataset.code = code; else delete status.dataset.code; };
  const stateName = (state: JobState) => state === 'pending' ? t('jobs/state-pending') : state === 'leased' ? t('jobs/state-leased') : state === 'done' ? t('jobs/state-done')
    : state === 'failed' ? t('jobs/state-failed') : state === 'dead' ? t('jobs/state-dead') : t('jobs/state-cancelled');
  const scheduleState = (state: JobSchedule['state']) => state === 'active' ? t('jobs/schedule-active') : state === 'unresolved' ? t('jobs/schedule-unresolved')
    : state === 'stalled' ? t('jobs/schedule-stalled') : t('jobs/schedule-ended');
  const relative = (at: number) => {
    const diff = at - now(), abs = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
    if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
    if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
    return rtf.format(Math.round(diff / 86_400_000), 'day');
  };
  const absolute = (at: number, zone?: string | null) => {
    try { return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) }).format(new Date(at)); }
    catch { return new Date(at).toISOString(); }
  };
  const when = (at: number, zone?: string | null) => `${relative(at)} · ${absolute(at, zone)}`;
  const time = (at: number, zone?: string | null) => { const e = el('time', '', when(at, zone)); e.dateTime = new Date(at).toISOString(); return e; };
  const duration = (ms: number) => ms < 1000 ? unit(locale, Math.round(ms), 'millisecond')
    : ms < 60_000 ? new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'long', maximumFractionDigits: 1 }).format(ms / 1000)
    : ms < 3_600_000 ? unit(locale, Math.round(ms / 60_000), 'minute') : unit(locale, Math.round(ms / 3_600_000), 'hour');
  const titleOf = (job: RegisteredJob) => job.title[locale] ?? job.title[locale.split('-')[0]] ?? job.title.en ?? job.kind;
  const registered = (schedule: JobSchedule) => registry.find(r => r.schedule === schedule.id);
  /** Whether the host's runtime still reports: quiet when it does, a warning when every runtime has been silent past 90 s. */
  const drawPulse = () => {
    pulse.replaceChildren(); delete pulse.dataset.tone;
    const age = runtimeAge(health);
    if (age === null) { pulse.hidden = true; return; }
    pulse.hidden = false;
    if (age > STALE_AFTER_MS) { pulse.dataset.tone = 'danger'; pulse.textContent = t('jobs/runtime-stale', { duration: duration(age) }); }
    else {
      const parts = [t('jobs/runtime-seen', { when: relative(now() - age) })];
      const storage = (health?.runtimes ?? []).map(r => (r as { storage?: string }).storage).find(Boolean);
      if (storage) parts.push(storage === 'memory' ? t('jobs/storage-memory') : t('jobs/storage-durable'));
      if (options.ownsRuntime?.()) parts.push(t('jobs/runs-here'));
      pulse.textContent = parts.join(' · ');
    }
  };

  const header = () => context.setHeader({
    center: { kind: 'tabs', id: 'view', label: t('jobs/views'), selected: current, items: [{ id: 'schedules', label: t('jobs/schedules') }, { id: 'queue', label: t('jobs/queue') }] },
    end: [{ kind: 'button', id: 'refresh', label: t('jobs/refresh'), glyph: 'refresh', disabled: unconfigured }],
  });

  /** A refusal said plainly, with its code on the status line. */
  const refusal = (error: any) => {
    const code = typeof error?.code === 'string' ? error.code : '';
    const detail = String(error?.message ?? error ?? '');
    if (code === JOB_CODES.unknown) say(t('jobs/unknown'), 'fail', code);
    else if (code === JOB_CODES.refused) say(t('jobs/refused', { detail }), 'fail', code);
    else if (code === JOB_CODES.held) say(t('jobs/held'), 'fail', code);
    else say(t('jobs/failed', { detail }), 'fail', code);
  };
  const showStarting = () => {
    unconfigured = true; header();
    states.replaceChildren(); pulse.hidden = true;
    say(t('jobs/starting'), '', STARTING);
    const box = el('div', 'tos-jobs-empty');
    box.append(el('p', '', t('jobs/starting-detail')));
    view.replaceChildren(box);
  };
  const showUnconfigured = (code: string, error?: any) => {
    unconfigured = true; header();
    states.replaceChildren(); pulse.hidden = true;
    say(error?.twin ? t('jobs/twin-failed', { detail: String(error.message ?? '') }) : t('jobs/unconfigured'), 'fail', code);
    const box = el('div', 'tos-jobs-empty');
    box.append(el('p', '', t('jobs/unconfigured-detail')), button('tos-jobs-configure', t('jobs/configure'), () => (options.configure ?? (() => context.openSettings()))()));
    view.replaceChildren(box);
  };

  const drawStates = () => {
    states.replaceChildren();
    if (!counts) return;
    for (const state of STATE_ORDER) {
      // the schedules' own enqueue jobs are not the person's work: they are said once below, not counted here
      const count = Math.max(0, (counts[state] ?? 0) - (state === 'pending' ? counts.pendingKinds?.[FIRE_KIND] ?? 0 : 0));
      const b = button('tos-jobs-state-count', '', () => { current = 'queue'; filter = state; selected = null; header(); void loadQueue(true); });
      b.dataset.state = state;
      if (DANGER.has(state) && count > 0) b.dataset.tone = 'danger';
      b.setAttribute('aria-pressed', String(current === 'queue' && filter === state));
      b.append(el('span', 'tos-jobs-state-label', stateName(state)), el('span', 'tos-jobs-state-number', new Intl.NumberFormat(locale).format(count)));
      states.append(b);
    }
  };

  /** An action asked once, in place: the action's own button confirms, Keep takes it back. */
  const confirmIn = (box: HTMLElement, question: string, action: string, run: () => Promise<void>) => {
    box.replaceChildren();
    const ask = el('div', 'tos-jobs-confirm');
    ask.setAttribute('role', 'group'); ask.setAttribute('aria-label', question);
    const yes = button('tos-jobs-danger', action, () => { yes.disabled = true; void run(); });
    ask.append(el('span', '', question), yes, button('tos-jobs-plain', t('jobs/keep'), () => render()));
    box.append(ask);
    yes.focus();
  };

  const steer = async (call: () => Promise<{ changed: boolean }>, done: string) => {
    try {
      const answer = await call();
      say(answer.changed ? done : t('jobs/unchanged'), answer.changed ? 'ok' : '');
    } catch (error) { refusal(error); }
    await load();
  };
  const runNow = async (job: RegisteredJob, title: string) => {
    try {
      if (!queue.run) throw Object.assign(new Error('this host cannot run a job now'), { code: JOB_CODES.unknown });
      await queue.run({ kind: job.kind });
      say(t('jobs/run-ok', { title }), 'ok');
    } catch (error: any) {
      if (error?.code === JOB_CODES.refused) say(t('jobs/run-busy', { title }), 'fail', error.code);
      else refusal(error);
    }
    await load();
  };

  const drawSchedules = () => {
    if (!schedules.length) { view.replaceChildren(el('p', 'tos-jobs-none', t('jobs/no-schedules'))); return; }
    const ul = el('ul', 'tos-jobs-schedules');
    ul.setAttribute('aria-label', t('jobs/schedules'));
    for (const s of schedules) {
      const li = el('li', 'tos-jobs-schedule'); li.dataset.id = s.id;
      const top = el('div', 'tos-jobs-schedule-top');
      const badge = el('span', 'tos-jobs-badge', scheduleState(s.state)); badge.dataset.state = s.state;
      const reg = registered(s), title = reg ? titleOf(reg) : s.kind;
      if (reg) li.dataset.kind = reg.kind;
      top.append(el('h3', 'tos-jobs-kind', title), badge);
      li.append(top, el('p', 'tos-jobs-rule', describeRule(s.series as Series, s.zone, t, locale)));
      if (s.state === 'stalled') li.append(el('p', 'tos-jobs-note', t('jobs/stalled-detail', { code: String((s.stall as any)?.code ?? (s.stall as any)?.limit ?? '') })));
      if (s.state === 'unresolved') li.append(el('p', 'tos-jobs-note', t('jobs/unresolved-detail')));
      if (s.state === 'active') {
        const runs = nextRuns(s.series as Series, s.zone, 3, now(), options.zoneProvider);
        const block = el('div', 'tos-jobs-next');
        block.append(el('h4', '', t('jobs/next-runs')));
        if (runs === null) block.append(el('p', 'tos-muted', s.nextRunAt ? when(s.nextRunAt, s.zone) : t('jobs/next-unknown')));
        else if (!runs.length) block.append(el('p', 'tos-muted', t('jobs/no-next')));
        else {
          const ol = el('ol', '');
          for (const run of runs) {
            const item = el('li', '');
            item.append(time(run.at, s.zone));
            if (run.mark) { const mark = el('span', 'tos-jobs-mark', run.mark === 'gap' ? t('jobs/moved') : t('jobs/repeated')); mark.dataset.mark = run.mark; item.append(' ', mark); }
            ol.append(item);
          }
          block.append(ol);
        }
        li.append(block);
      }
      const facts = el('p', 'tos-jobs-facts');
      facts.append(s.lastRunAt ? t('jobs/last-run', { when: when(s.lastRunAt, s.zone) }) : t('jobs/never-run'), ' · ', t('jobs/fired', { count: new Intl.NumberFormat(locale).format(s.counts.fired) }));
      // skipped alone undercounts a downtime backlog (Jaren passes it uncounted): said only beside it
      if (typeof s.counts.uncounted === 'number') facts.append(' · ', t('jobs/skipped', { skipped: s.counts.skipped, uncounted: s.counts.uncounted }));
      li.append(facts);
      const actions = el('div', 'tos-jobs-actions');
      if (reg) {
        // a registered job runs now; one that must never run twice is asked once, in place
        const go = () => runNow(reg, title);
        actions.append(button('tos-jobs-plain', t('jobs/run-now'), () => reg.safety === 'single-send'
          ? confirmIn(actions, t('jobs/run-single-confirm', { title }), t('jobs/run-now'), go) : void go()));
      }
      // the host's registry owns its schedules: they are not removed from here
      else actions.append(button('tos-jobs-plain', t('jobs/remove'), () => confirmIn(actions, t('jobs/remove-confirm', { title: s.kind }), t('jobs/remove'),
        () => steer(() => queue.unschedule({ id: s.id }), t('jobs/removed', { title: s.kind })))));
      li.append(actions);
      ul.append(li);
    }
    const ticks = schedules.filter(s => s.id.startsWith('ops:')).reduce((n, s) => n + (s.counts?.fired ?? 0), 0);
    if (ticks > 0) { const note = el('p', 'tos-jobs-ticks', t('jobs/ticks', { count: new Intl.NumberFormat(locale).format(ticks) })); view.replaceChildren(ul, note); }
    else view.replaceChildren(ul);
  };

  const field = (dl: HTMLElement, label: string, value: string | Node) => { const dd = el('dd', ''); dd.append(value); dl.append(el('dt', '', label), dd); };
  const drawQueue = () => {
    const box = el('div', 'tos-jobs-queue');
    if (!items.length) { box.append(el('p', 'tos-jobs-none', t('jobs/no-jobs'))); view.replaceChildren(box); return; }
    const ol = el('ol', 'tos-jobs-list');
    ol.setAttribute('aria-label', t('jobs/list'));
    for (const job of items) {
      const li = el('li', '');
      const b = button('tos-jobs-item', '', () => { selected = selected === job.id ? null : job.id; render(); });
      b.dataset.id = job.id; b.setAttribute('aria-expanded', String(selected === job.id));
      const idText = el('span', 'tos-jobs-id', job.id); idText.dir = 'ltr';
      b.append(el('span', 'tos-jobs-kind', job.kind), idText,
        el('span', 'tos-jobs-attempts', t('jobs/attempts', { attempts: job.attempts, max: job.maxAttempts })),
        el('span', 'tos-jobs-when', t('jobs/run-at', { when: when(job.runAt) })));
      if (job.lastError) b.append(el('span', 'tos-jobs-error', job.lastError.message.split('\n')[0]));
      li.append(b);
      if (selected === job.id) li.append(detail(job));
      ol.append(li);
    }
    box.append(ol);
    if (next) box.append(button('tos-jobs-more', t('jobs/more'), () => void loadQueue(false)));
    view.replaceChildren(box);
  };
  const detail = (job: JobItem) => {
    const section = el('section', 'tos-jobs-detail');
    section.setAttribute('aria-label', t('jobs/detail'));
    const dl = el('dl', '');
    const idValue = el('span', '', job.id); idValue.dir = 'ltr';
    field(dl, t('jobs/field-id'), idValue); field(dl, t('jobs/field-kind'), job.kind); field(dl, t('jobs/field-state'), stateName(job.state));
    field(dl, t('jobs/field-attempts'), `${new Intl.NumberFormat(locale).format(job.attempts)} / ${new Intl.NumberFormat(locale).format(job.maxAttempts)}`);
    field(dl, t('jobs/field-run-at'), time(job.runAt));
    if (job.leaseUntil) field(dl, t('jobs/field-lease'), time(job.leaseUntil));
    field(dl, t('jobs/field-created'), time(job.createdAt)); field(dl, t('jobs/field-updated'), time(job.updatedAt));
    if (job.lastError) { const pre = el('pre', 'tos-jobs-error-text', job.lastError.message); field(dl, t('jobs/field-error'), pre); if (job.lastError.code) pre.dataset.code = job.lastError.code; }
    section.append(dl);
    section.append(history(job));
    const actions = el('div', 'tos-jobs-actions');
    if (job.state === 'pending' || job.state === 'failed' || job.state === 'leased')
      actions.append(button('tos-jobs-plain', t('jobs/cancel'), () => confirmIn(actions, t('jobs/cancel-confirm', { id: job.id }), t('jobs/cancel'), () => steer(() => queue.cancel({ id: job.id }), t('jobs/cancelled-ok', { id: job.id })))));
    if (job.state === 'failed' || job.state === 'dead' || job.state === 'cancelled')
      actions.append(button('tos-jobs-plain', t('jobs/requeue'), () => confirmIn(actions, t('jobs/requeue-confirm', { id: job.id }), t('jobs/requeue'), () => steer(() => queue.requeue({ id: job.id }), t('jobs/requeued-ok', { id: job.id })))));
    if (actions.childElementCount) section.append(actions);
    return section;
  };

  /** Read a job's attempts again, keeping what is shown until the answer comes. */
  const refreshAttempts = (jobId: string) => {
    if (!queue.events || !attempts.has(jobId)) return;
    void optional(() => queue.events!({ jobId, limit: 200 }), null as { events: JobEvent[] } | null).then((answer) => {
      if (closed || !answer) return;
      attempts.set(jobId, answer.events);
      if (selected === jobId) render();
    });
  };
  /** A job's attempts as the runtime recorded them, oldest first; nothing when the host keeps none. */
  const history = (job: JobItem) => {
    const box = el('div', 'tos-jobs-history');
    const events = attempts.get(job.id);
    if (events === undefined) {
      attempts.set(job.id, null);
      void optional(queue.events ? () => queue.events!({ jobId: job.id, limit: 200 }) : undefined, { events: [] as JobEvent[] })
        .then(({ events: found }) => { if (closed) return; attempts.set(job.id, found); if (selected === job.id) render(); });
      return box;
    }
    if (!events?.length) return box;
    box.append(el('h4', '', t('jobs/attempts-title')));
    const ol = el('ol', 'tos-jobs-attempt-list');
    for (const { attempt: n, started, outcome, notRepeated, budget } of attemptRows(events)) {
      const li = el('li', 'tos-jobs-attempt'); li.dataset.attempt = String(n);
      const head = el('div', 'tos-jobs-attempt-head');
      head.append(el('span', 'tos-jobs-attempt-n', t('jobs/attempt-n', { n })));
      if (started) head.append(time(started.at));
      if (started || outcome) {
        const label = !outcome ? t('jobs/outcome-started') : outcome.event === 'completed' ? t('jobs/outcome-completed') : outcome.event === 'failed' ? t('jobs/outcome-failed')
          : outcome.event === 'lost' ? t('jobs/outcome-lost') : t('jobs/outcome-cancelled');
        const badge = el('span', 'tos-jobs-outcome', label); badge.dataset.outcome = outcome?.event ?? 'started';
        head.append(badge);
        if (outcome?.durationMs !== undefined) head.append(el('span', 'tos-muted', t('jobs/took', { duration: duration(outcome.durationMs) })));
      }
      li.append(head);
      // a lost attempt's label already says why; any other outcome shows the first line of what the host said
      const reason = outcome?.event === 'lost' ? undefined : outcome?.message?.split('\n')[0];
      if (reason || (outcome?.code && outcome.event !== 'lost')) { const p = el('p', 'tos-jobs-attempt-error', reason ?? ''); if (outcome?.code) p.dataset.code = outcome.code; li.append(p); }
      if (notRepeated) { const p = el('p', 'tos-jobs-note', t('jobs/not-repeated')); p.dataset.event = 'not-repeated'; li.append(p); }
      if (budget) { const p = el('p', 'tos-jobs-note', t('jobs/budget-spent')); p.dataset.event = 'budget'; li.append(p); }
      ol.append(li);
    }
    box.append(ol);
    return box;
  };

  const render = () => { if (unconfigured || closed) return; drawStates(); drawPulse(); if (current === 'schedules') drawSchedules(); else drawQueue(); };

  async function loadQueue(reset: boolean) {
    const mine = ++ticket;
    try {
      let page = await queue.page({ ...(filter ? { state: filter } : {}), limit: 50, ...(!reset && next ? { after: next } : {}) });
      let shown = page.items.filter(job => job.kind !== FIRE_KIND);
      // a page of only schedule ticks says nothing: read on, a few pages at most
      for (let more = 0; !shown.length && page.next && more < 4; more++) {
        page = await queue.page({ ...(filter ? { state: filter } : {}), limit: 50, after: page.next });
        shown = page.items.filter(job => job.kind !== FIRE_KIND);
      }
      if (mine !== ticket || closed) return;
      items = reset ? shown : [...items, ...shown]; next = page.next;
      render();
    } catch (error: any) { if (mine === ticket && !closed) { if (error?.code === STARTING) showStarting(); else if (error?.code === JOB_CODES.unconfigured) showUnconfigured(error.code, error); else refusal(error); } }
  }

  async function load() {
    const mine = ++ticket;
    if (!counts) say(t('jobs/loading'));
    try {
      const [c, s, r, h] = await Promise.all([queue.counts(), queue.schedules(),
        optional(queue.registry ? () => queue.registry!() : undefined, { jobs: [] as RegisteredJob[] }),
        optional(queue.health ? () => queue.health!() : undefined, null as { now: number, runtimes: JobRuntimeHealth[] } | null)]);
      if (mine !== ticket || closed) return;
      unconfigured = false; counts = c; schedules = s.schedules; registry = r.jobs; health = h;
      if (selected) refreshAttempts(selected);
      if (filter === null) filter = STATE_ORDER.find(state => (c[state] ?? 0) > 0) ?? 'pending';
      if (status.textContent === t('jobs/loading')) say('');
      header();
      if (current === 'queue') { await loadQueue(true); return; }
      render();
    } catch (error: any) {
      if (mine !== ticket || closed) return;
      if (error?.code === STARTING) showStarting();
      else if (error?.code === JOB_CODES.unconfigured) showUnconfigured(error.code, error); else refusal(error);
    }
  }

  context.onHeader(({ item, value }: any) => {
    if (item === 'view' && (value === 'schedules' || value === 'queue')) {
      current = value; header();
      if (current === 'queue') void loadQueue(true); else render();
    }
    else if (item === 'refresh') void load();
    else return { refused: `Jobs has no '${item}'` };
  });
  // read again while it is on screen, and when it comes back
  const every = options.refreshMs ?? 10_000;
  const timer = setInterval(() => { if (context.visible && !closed) void load(); }, every);
  const offVisibility = context.onVisibility((visible) => { if (visible) void load(); });
  header();
  void load();
  return () => { closed = true; ticket++; clearInterval(timer); offVisibility(); root.remove(); };
}
