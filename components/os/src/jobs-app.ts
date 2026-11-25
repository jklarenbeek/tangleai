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
 */
import { classifyLocal, floatingValue, formatRRule, nextOccurrences, resolveLocal, utcValue } from '@jarenjs/core/calendar';
import { createOsMessages, type OsCatalogue, type OsMessageKey } from './messages.ts';
import { JOB_CODES, type JobCounts, type JobItem, type JobQueue, type JobSchedule, type JobState } from './jobs.ts';
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
  root.append(states, status, view);
  node.append(root);

  let current: View = 'schedules', counts: JobCounts | null = null, schedules: JobSchedule[] = [];
  let filter: JobState | null = null, items: JobItem[] = [], next: string | undefined, selected: string | null = null;
  let ticket = 0, unconfigured = false, closed = false;

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
  const showUnconfigured = (code: string) => {
    unconfigured = true; header();
    states.replaceChildren();
    say(t('jobs/unconfigured'), 'fail', code);
    const box = el('div', 'tos-jobs-empty');
    box.append(el('p', '', t('jobs/unconfigured-detail')), button('tos-jobs-configure', t('jobs/configure'), () => (options.configure ?? (() => context.openSettings()))()));
    view.replaceChildren(box);
  };

  const drawStates = () => {
    states.replaceChildren();
    if (!counts) return;
    for (const state of STATE_ORDER) {
      const count = counts[state] ?? 0;
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

  const drawSchedules = () => {
    if (!schedules.length) { view.replaceChildren(el('p', 'tos-jobs-none', t('jobs/no-schedules'))); return; }
    const ul = el('ul', 'tos-jobs-schedules');
    ul.setAttribute('aria-label', t('jobs/schedules'));
    for (const s of schedules) {
      const li = el('li', 'tos-jobs-schedule'); li.dataset.id = s.id;
      const top = el('div', 'tos-jobs-schedule-top');
      const badge = el('span', 'tos-jobs-badge', scheduleState(s.state)); badge.dataset.state = s.state;
      top.append(el('h3', 'tos-jobs-kind', s.kind), badge);
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
      actions.append(button('tos-jobs-plain', t('jobs/remove'), () => confirmIn(actions, t('jobs/remove-confirm', { title: s.kind }), t('jobs/remove'),
        () => steer(() => queue.unschedule({ id: s.id }), t('jobs/removed', { title: s.kind })))));
      li.append(actions);
      ul.append(li);
    }
    view.replaceChildren(ul);
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
    const actions = el('div', 'tos-jobs-actions');
    if (job.state === 'pending' || job.state === 'failed' || job.state === 'leased')
      actions.append(button('tos-jobs-plain', t('jobs/cancel'), () => confirmIn(actions, t('jobs/cancel-confirm', { id: job.id }), t('jobs/cancel'), () => steer(() => queue.cancel({ id: job.id }), t('jobs/cancelled-ok', { id: job.id })))));
    if (job.state === 'failed' || job.state === 'dead' || job.state === 'cancelled')
      actions.append(button('tos-jobs-plain', t('jobs/requeue'), () => confirmIn(actions, t('jobs/requeue-confirm', { id: job.id }), t('jobs/requeue'), () => steer(() => queue.requeue({ id: job.id }), t('jobs/requeued-ok', { id: job.id })))));
    if (actions.childElementCount) section.append(actions);
    return section;
  };

  const render = () => { if (unconfigured || closed) return; drawStates(); if (current === 'schedules') drawSchedules(); else drawQueue(); };

  async function loadQueue(reset: boolean) {
    const mine = ++ticket;
    try {
      const page = await queue.page({ ...(filter ? { state: filter } : {}), limit: 50, ...(!reset && next ? { after: next } : {}) });
      if (mine !== ticket || closed) return;
      items = reset ? page.items : [...items, ...page.items]; next = page.next;
      render();
    } catch (error: any) { if (mine === ticket && !closed) { if (error?.code === JOB_CODES.unconfigured) showUnconfigured(error.code); else refusal(error); } }
  }

  async function load() {
    const mine = ++ticket;
    if (!counts) say(t('jobs/loading'));
    try {
      const [c, s] = await Promise.all([queue.counts(), queue.schedules()]);
      if (mine !== ticket || closed) return;
      unconfigured = false; counts = c; schedules = s.schedules;
      if (filter === null) filter = STATE_ORDER.find(state => (c[state] ?? 0) > 0) ?? 'pending';
      if (status.textContent === t('jobs/loading')) say('');
      header();
      if (current === 'queue') { await loadQueue(true); return; }
      render();
    } catch (error: any) {
      if (mine !== ticket || closed) return;
      if (error?.code === JOB_CODES.unconfigured) showUnconfigured(error.code); else refusal(error);
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
