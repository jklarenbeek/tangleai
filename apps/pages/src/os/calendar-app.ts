/**
 * The Calendar application: a month you can read at a glance, the selected
 * day beside it, an editor that stays in place, and "find a time" over your
 * working hours. It serves a `calendar` contract (agenda, add, free), so the
 * assistant and other applications can read and book it like any service.
 *
 * The background work's upcoming runs are a quiet, read-only layer the person
 * can hide: each run by its job's title, a schedule that runs more often than
 * daily as one line a day with its count. Runs are never busy time, and they
 * export on their own (titles and times only).
 */
import type { ShippedMount } from '@tangleai/os/shell';
import type { JobQueue, JobSchedule, RegisteredJob } from '@tangleai/os/jobs';
import { scheduledRuns, type ScheduledRun } from '@tangleai/os/jobs-app';
import {
  COLOURS, WEEKDAYS, addDays, calendarZoneProvider, checkEvent, emptyCalendar, exportIcal, exportRunsIcal, importIcal, freeSlots, isoDate, occurrences, parseDate, repeatHint, seed, supportedRepeats,
  type CalendarDocument, type CalendarEvent, type Colour, type Occurrence, type Repeat,
} from './calendar-model.ts';
import { t } from './i18n.ts';

const SLOT = 'tangle-calendar';
/** What a repeat choice says, in the menu and beside a repeating event. */
const repeatLabels = (): Record<Repeat, string> => ({ none: t('calendar/repeat-none'), daily: t('calendar/repeat-daily'), weekdays: t('calendar/repeat-weekdays'), weekly: t('calendar/repeat-weekly'), monthly: t('calendar/repeat-monthly'), yearly: t('calendar/repeat-yearly') });
/** A colour's accessible name. */
const colourLabels = (): Record<Colour, string> => ({ teal: t('calendar/colour-teal'), blue: t('calendar/colour-blue'), violet: t('calendar/colour-violet'), rose: t('calendar/colour-rose'), amber: t('calendar/colour-amber'), slate: t('calendar/colour-slate') });

export const CALENDAR_CONTRACT = {
  $contract: '0.1', id: 'calendar',
  operations: {
    'calendar.agenda': {
      kind: 'read', doc: 'The events between a start date and a number of days, recurring ones expanded, in order.',
      input: { type: 'object', additionalProperties: false, properties: { from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, days: { type: 'integer', minimum: 1, maximum: 62 } } },
      output: { type: 'array' },
    },
    'calendar.add': {
      kind: 'command', doc: 'Add an event. Times are local wall-clock times (HH:MM); repeat is none, daily, weekdays, weekly, monthly or yearly.',
      input: {
        type: 'object', additionalProperties: false, required: ['title', 'date'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          start: { type: 'string', pattern: '^\\d{2}:\\d{2}$' }, end: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
          allDay: { type: 'boolean' }, repeat: { enum: ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'] }, notes: { type: 'string', maxLength: 2000 },
        },
      },
      output: { type: 'object' },
    },
    'calendar.free': {
      kind: 'read', doc: 'Free times of a length within the working hours of the coming days, earliest first. Time that no working hours cover is never offered.',
      input: { type: 'object', additionalProperties: false, required: ['minutes'], properties: { minutes: { type: 'integer', minimum: 15, maximum: 480 }, days: { type: 'integer', minimum: 1, maximum: 31 } } },
      output: { type: 'array' },
    },
  },
};

export type CalendarOptions = {
  /** The desktop's job queue (`kernel.jobQueue()`): its schedules are drawn as the background-work layer. */
  jobs?: () => JobQueue,
  /** Zone data for floating schedule rules (the Calendar's own by default). */
  zoneProvider?: unknown,
};

export function calendarMount(options: CalendarOptions = {}): ShippedMount {
  return (node, context) => {
    const doc = node.ownerDocument;
    const win = doc.defaultView!;
    const locale = context.locale || 'en';
    const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...children: (Node | string | null | undefined | false)[]) => {
      const el = doc.createElement(tag);
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k in el && typeof v !== 'string') (el as any)[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
      for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
      return el;
    };
    const read = (): CalendarDocument => { try { const v = JSON.parse(win.localStorage.getItem(SLOT) ?? 'null'); return v?.$calendar === '0.1' ? v : emptyCalendar(); } catch { return emptyCalendar(); } };
    const write = (next: CalendarDocument) => { cal = next; try { win.localStorage.setItem(SLOT, JSON.stringify(next)); } catch { /* kept for this session */ } };

    const today = isoDate(new Date());
    let cal = seed(read(), today);
    write(cal);
    let month = today.slice(0, 7);          // YYYY-MM on screen
    let selected = today;
    let editing: Partial<CalendarEvent> | null = null;
    let slots: { start: number, end: number }[] | null = null;
    let findMinutes = 60;
    const repeats = supportedRepeats();
    // the background work's schedules, read from the job host; none while there is no host or it starts
    let background: { schedules: JobSchedule[], registry: RegisteredJob[] } | null = null;
    let live = true;
    const zones = options.zoneProvider ?? calendarZoneProvider();
    const showRuns = () => cal.background !== false;
    async function loadBackground() {
      const queue = options.jobs?.();
      if (!queue) return;
      try {
        const [{ schedules }, registry] = await Promise.all([queue.schedules(), queue.registry ? queue.registry().catch(() => ({ jobs: [] as RegisteredJob[] })) : { jobs: [] as RegisteredJob[] }]);
        background = { schedules, registry: registry.jobs };
      } catch { background = null; }   // OS0190 (no host), OS0195 (starting): nothing to draw
      if (live) render();
    }
    const runsBetween = (from: string, to: string): ScheduledRun[] => !showRuns() || !background ? []
      // upcoming only: a planned run on a day gone by would read as history it is not
      : scheduledRuns(background.schedules, background.registry, Math.max(parseDate(from).getTime(), Date.now()), parseDate(to).getTime(), { locale, zoneProvider: zones });
    const count = (n: number) => new Intl.NumberFormat(locale).format(n);

    const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options);
    const monthTitle = (ym: string) => fmt({ month: 'long', year: 'numeric' }).format(parseDate(`${ym}-01`));
    const dayTitle = (d: string) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(parseDate(d));
    const weekdayShort = WEEKDAYS.map((_, i) => fmt({ weekday: 'short' }).format(new Date(2026, 0, 5 + i)));
    const time = (hhmm: string) => fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 0, 1, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3))));
    // in a month cell, the compact 24-hour form leaves room for the title
    const chipTime = (hhmm: string) => fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(2026, 0, 1, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3))));

    const root = h('div', { class: 'cal' });
    node.append(root);
    node.classList.add('tos-surface-calendar');

    function render() {
      // the six weeks the month needs, from the Monday on or before the 1st
      const first = parseDate(`${month}-01`);
      const lead = (first.getDay() + 6) % 7;
      const gridStart = addDays(`${month}-01`, -lead);
      const gridEnd = addDays(gridStart, 42);
      const all = occurrences(cal, gridStart, gridEnd);
      const byDay = new Map<string, Occurrence[]>();
      for (const o of all) byDay.set(o.date, [...(byDay.get(o.date) ?? []), o]);
      const runsByDay = new Map<string, ScheduledRun[]>();
      for (const r of runsBetween(gridStart, gridEnd)) runsByDay.set(r.date, [...(runsByDay.get(r.date) ?? []), r]);

      // the month's controls live in the window's header bar: one row less, and the assistant can use them too
      showHeader();
      const head = h('h1', { class: 'cal-title cal-visually-hidden' }, monthTitle(month));

      const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': monthTitle(month) },
        ...weekdayShort.map(name => h('div', { class: 'cal-weekday', role: 'columnheader' }, name)));
      for (let i = 0; i < 42; i++) {
        const date = addDays(gridStart, i);
        const items = byDay.get(date) ?? [];
        const cell = h('div', {
          class: `cal-day${date.slice(0, 7) !== month ? ' is-outside' : ''}${date === today ? ' is-today' : ''}${date === selected ? ' is-selected' : ''}`,
          role: 'gridcell', tabindex: date === selected ? '0' : '-1', 'aria-selected': String(date === selected), 'data-date': date,
          onclick: () => { selected = date; editing = null; render(); },
          ondblclick: () => openEditor({ date }),
          onkeydown: (e: KeyboardEvent) => keyNav(e, date),
        }, h('span', { class: 'cal-num' }, String(Number(date.slice(8)))));
        for (const o of items.slice(0, 3)) cell.append(h('span', { class: `cal-chip c-${o.colour}${o.allDay ? ' is-allday' : ''}`, title: o.title },
          o.allDay ? null : h('span', { class: 'cal-chip-time' }, chipTime(o.start)), o.title));
        if (items.length > 3) cell.append(h('span', { class: 'cal-more' }, t('calendar/more', { count: items.length - 3 })));
        // the background work: one quiet line under the person's own events
        const runs = runsByDay.get(date) ?? [];
        if (runs.length === 1) cell.append(h('span', { class: 'cal-runs', title: runText(runs[0]) }, runs[0].type === 'run' ? `${chipTime(hhmm(new Date(runs[0].at)))} ${runs[0].title}` : runs[0].title));
        // several: a compact count that fits any cell, the sentence in its name and the runs in its tooltip
        else if (runs.length > 1) cell.append(h('span', { class: 'cal-runs', title: runs.map(runText).join('\n'), 'aria-label': t('calendar/runs-cell', { count: runs.length }) }, `↻ ${count(runs.length)}`));
        grid.append(cell);
      }

      root.replaceChildren(head, h('div', { class: 'cal-body' }, grid, side(byDay.get(selected) ?? occurrences(cal, selected, addDays(selected, 1)), runsByDay.get(selected) ?? runsBetween(selected, addDays(selected, 1)))));
      (root.querySelector('.cal-day.is-selected') as HTMLElement | null)?.setAttribute('tabindex', '0');
    }

    /** A run as one line: its time and title (and why a clock change touched it), or a schedule's runs that day. */
    function runText(r: ScheduledRun): string {
      if (r.type === 'summary') return t('calendar/run-summary', { title: r.title, count: count(r.count) });
      const at = fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(r.at));
      return r.mark === 'gap' ? `${at} ${r.title} · ${t('calendar/run-moved')}` : r.mark === 'fold' ? `${at} ${r.title} · ${t('calendar/run-repeated')}` : `${at} ${r.title}`;
    }

    function side(items: Occurrence[], runs: ScheduledRun[] = []) {
      const panel = h('aside', { class: 'cal-side' });
      if (editing) { panel.append(editor()); return panel; }
      panel.append(h('h2', { class: 'cal-side-title' }, dayTitle(selected)));
      if (!items.length) panel.append(h('p', { class: 'cal-empty' }, t('calendar/nothing-planned')));
      else panel.append(h('ul', { class: 'cal-agenda' }, ...items.map(o => h('li', { class: `cal-item c-${o.colour}` },
        h('span', { class: 'cal-item-time' }, o.allDay ? t('calendar/all-day') : `${time(o.start)} – ${time(o.end)}`),
        h('strong', { class: 'cal-item-title' }, o.title),
        o.repeat !== 'none' ? h('span', { class: 'cal-item-repeat' }, repeatLabels()[o.repeat]) : null,
        h('span', { class: 'cal-item-actions' },
          h('button', { type: 'button', class: 'cal-link', onclick: () => openEditor(cal.events.find(e => e.uid === o.uid)!) }, t('calendar/edit')),
          o.repeat !== 'none' ? h('button', { type: 'button', class: 'cal-link', onclick: () => skipOne(o) }, t('calendar/skip-day')) : null,
          h('button', { type: 'button', class: 'cal-link is-danger', onclick: () => remove(o.uid) }, o.repeat !== 'none' ? t('calendar/delete-all') : t('calendar/delete')))))));
      if (runs.length) panel.append(h('section', { class: 'cal-runs-day' },
        h('h3', {}, t('calendar/runs-title')),
        h('ul', { class: 'cal-runs-list' }, ...runs.map(r => h('li', {}, runText(r)))),
        h('p', { class: 'cal-runs-note' }, t('calendar/runs-note'))));
      panel.append(finder());
      return panel;
    }

    function finder() {
      const box = h('section', { class: 'cal-find' }, h('h3', {}, t('calendar/find')));
      const lengths = h('div', { class: 'cal-segment', role: 'radiogroup', 'aria-label': t('calendar/length') },
        ...[30, 60, 90, 120].map(m => h('button', { type: 'button', role: 'radio', 'aria-checked': String(m === findMinutes), onclick: () => { findMinutes = m; slots = null; render(); } }, m < 60 ? t('calendar/minutes', { count: m }) : t('calendar/hours', { count: m / 60 }))));
      const hours = h('p', { class: 'cal-hours' }, t('calendar/within-hours', { start: time(cal.hours.start), end: time(cal.hours.end), days: cal.hours.days.map(d => weekdayShort[WEEKDAYS.indexOf(d)]).join(', ') }));
      const search = h('button', { type: 'button', class: 'cal-ghost', onclick: () => { slots = freeSlots(cal, { minutes: findMinutes }); render(); } }, t('calendar/search'));
      box.append(lengths, hours, search);
      if (slots) {
        if (!slots.length) box.append(h('p', { class: 'cal-empty' }, t('calendar/no-free-time')));
        else box.append(h('div', { class: 'cal-slots' }, ...slots.map(s => {
          const start = new Date(s.start), end = new Date(s.end);
          const label = `${fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(start)} · ${fmt({ hour: 'numeric', minute: '2-digit' }).format(start)}–${fmt({ hour: 'numeric', minute: '2-digit' }).format(end)}`;
          return h('button', { type: 'button', class: 'cal-slot', onclick: () => { selected = isoDate(start); month = selected.slice(0, 7); openEditor({ date: selected, start: hhmm(start), end: hhmm(end) }); } }, label);
        })));
      }
      return box;
    }

    function editor() {
      const e = editing!;
      const isNew = !cal.events.some(x => x.uid === e.uid);
      const status = h('p', { class: 'cal-error', role: 'alert' });
      const title = h('input', { type: 'text', value: e.title ?? '', placeholder: t('calendar/what'), 'aria-label': t('calendar/title-field'), class: 'cal-input cal-input-title' }) as HTMLInputElement;
      const date = h('input', { type: 'date', value: e.date ?? selected, 'aria-label': t('calendar/date'), class: 'cal-input' }) as HTMLInputElement;
      const allDay = h('input', { type: 'checkbox', checked: e.allDay === true }) as HTMLInputElement;
      const start = h('input', { type: 'time', value: e.start ?? '09:00', 'aria-label': t('calendar/starts'), class: 'cal-input' }) as HTMLInputElement;
      const end = h('input', { type: 'time', value: e.end ?? '10:00', 'aria-label': t('calendar/ends'), class: 'cal-input' }) as HTMLInputElement;
      const times = h('div', { class: 'cal-row' }, start, h('span', { class: 'cal-dash' }, '–'), end);
      const syncTimes = () => { times.hidden = allDay.checked; };
      allDay.addEventListener('change', syncTimes); syncTimes();
      const labels = repeatLabels();
      const repeat = h('select', { class: 'cal-input', 'aria-label': t('calendar/repeat') }, ...repeats.map(r => h('option', { value: r, selected: r === (e.repeat ?? 'none') }, labels[r]))) as HTMLSelectElement;
      // the calendar never moves a date a month or year lacks; say so before it surprises
      const hint = h('p', { class: 'cal-hint', 'aria-live': 'polite' });
      const syncHint = () => { hint.textContent = repeatHint(repeat.value as Repeat, date.value); };
      repeat.addEventListener('change', syncHint); date.addEventListener('input', syncHint); syncHint();
      let colour = e.colour ?? 'teal';
      const colourNames = colourLabels();
      const swatches = h('div', { class: 'cal-swatches', role: 'radiogroup', 'aria-label': t('calendar/colour') },
        ...COLOURS.map(c => h('button', { type: 'button', role: 'radio', class: `cal-swatch c-${c}`, 'aria-label': colourNames[c], 'aria-checked': String(c === colour), onclick: (ev: Event) => {
          colour = c; for (const b of swatches.children) b.setAttribute('aria-checked', String(b === ev.currentTarget));
        } })));
      const notes = h('textarea', { class: 'cal-input', rows: 3, placeholder: t('calendar/notes'), 'aria-label': t('calendar/notes') }, e.notes ?? '') as HTMLTextAreaElement;
      const save = () => {
        const checked = checkEvent({ ...e, title: title.value, date: date.value, allDay: allDay.checked, start: start.value, end: end.value, repeat: repeat.value as Repeat, colour, notes: notes.value });
        if (!checked.ok) { status.textContent = checked.error; return; }
        write({ ...cal, events: [...cal.events.filter(x => x.uid !== checked.event.uid), checked.event] });
        selected = checked.event.date; month = selected.slice(0, 7); editing = null; slots = null; render();
      };
      const form = h('form', { class: 'cal-editor', onsubmit: (ev: Event) => { ev.preventDefault(); save(); } },
        h('h2', { class: 'cal-side-title' }, isNew ? t('calendar/new-event') : t('calendar/edit-event')),
        title, date,
        h('label', { class: 'cal-check' }, allDay, h('span', {}, t('calendar/all-day'))),
        times, repeat, hint, swatches, notes, status,
        h('div', { class: 'cal-row cal-form-actions' },
          h('button', { type: 'submit', class: 'cal-primary' }, t('calendar/save')),
          h('button', { type: 'button', class: 'cal-ghost', onclick: () => { editing = null; render(); } }, t('calendar/cancel')),
          !isNew ? h('button', { type: 'button', class: 'cal-link is-danger', onclick: () => remove(e.uid!) }, t('calendar/delete')) : null));
      win.setTimeout(() => title.focus(), 0);
      return form;
    }

    let shownHeader = '';
    function showHeader() {
      const header = {
        start: [
          { kind: 'button' as const, id: 'prev', label: t('calendar/previous-month'), glyph: 'back' as const },
          { kind: 'button' as const, id: 'next', label: t('calendar/next-month'), glyph: 'forward' as const },
          { kind: 'button' as const, id: 'today', label: t('calendar/today'), disabled: month === today.slice(0, 7) && selected === today },
        ],
        subtitle: monthTitle(month),
        end: [
          { kind: 'button' as const, id: 'new', label: t('calendar/new-event'), primary: true },
          { kind: 'menu' as const, id: 'menu', label: t('calendar/menu'), glyph: 'menu' as const, entries: [
            { id: 'export', label: t('calendar/export') },
            ...(background ? [{ id: 'export-runs', label: t('calendar/export-runs') }, { separator: true as const }, { id: 'runs', label: t('calendar/show-runs'), checked: showRuns() }] : []),
          ] },
        ],
      };
      const text = JSON.stringify(header);
      if (text !== shownHeader) { shownHeader = text; context.setHeader(header); }
    }
    context.onHeader(({ item, value }) => {
      if (item === 'prev') month = shiftMonth(month, -1);
      else if (item === 'next') month = shiftMonth(month, 1);
      else if (item === 'today') { month = today.slice(0, 7); selected = today; }
      else if (item === 'new') { openEditor({ date: selected }); return; }
      else if (item === 'menu' && value === 'export') { download(); return; }
      else if (item === 'menu' && value === 'export-runs') { downloadRuns(); return; }
      else if (item === 'menu' && value === 'runs') write({ ...cal, background: !showRuns() });
      else return { refused: t('calendar/no-item', { item }) };
      render();
    });

    function openEditor(event: Partial<CalendarEvent>) { editing = { ...event }; if (event.date) { selected = event.date; month = event.date.slice(0, 7); } render(); }
    function remove(uid: string) { write({ ...cal, events: cal.events.filter(e => e.uid !== uid) }); editing = null; slots = null; render(); }
    function skipOne(o: Occurrence) {
      write({ ...cal, events: cal.events.map(e => e.uid === o.uid ? { ...e, exdates: [...new Set([...e.exdates, o.date])].sort() } : e) });
      render();
    }
    function download() {
      const text = exportIcal(cal);
      const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
      const link = h('a', { href: url, download: 'tangle-calendar.ics' }); doc.body.append(link); link.click(); link.remove();
      win.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    /** The next 30 days of background runs as their own iCalendar file: titles and times only. */
    function downloadRuns() {
      if (!background) return;
      const from = Date.now();
      const runs = scheduledRuns(background.schedules, background.registry, from, from + 30 * 86_400_000, { locale, zoneProvider: zones });
      const text = exportRunsIcal(runs as any, { summary: (title, n) => t('calendar/run-summary', { title, count: count(n) }) });
      const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
      const link = h('a', { href: url, download: 'tangle-background-work.ics' }); doc.body.append(link); link.click(); link.remove();
      win.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    function keyNav(e: KeyboardEvent, date: string) {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (e.key === 'Enter') { openEditor({ date }); return; }
      if (step === undefined) return;
      e.preventDefault();
      selected = addDays(date, step); month = selected.slice(0, 7); render();
      (root.querySelector(`[data-date="${selected}"]`) as HTMLElement | null)?.focus();
    }

    // the calendar as a service: the assistant and other applications read and book it
    context.provide(CALENDAR_CONTRACT, {
      'calendar.agenda': ({ from, days }: any) => { const start = from ?? today; return occurrences(cal, start, addDays(start, days ?? 7)).map(({ uid, title, date, start: s, end, allDay, repeat }) => ({ uid, title, date, start: s, end, allDay, repeat })); },
      'calendar.add': (input: any) => {
        const checked = checkEvent({ ...input, start: input.start ?? '09:00', end: input.end ?? '10:00', colour: 'blue' });
        if (!checked.ok) return { ok: false, error: checked.error };
        write({ ...cal, events: [...cal.events, checked.event] }); render();
        return { ok: true, uid: checked.event.uid, date: checked.event.date };
      },
      'calendar.free': ({ minutes, days }: any) => freeSlots(cal, { minutes, days }).map(s => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() })),
    });

    // an iCalendar file opened from the desktop's Files: its events join the calendar (one with the same uid is replaced)
    context.onOpen((file) => {
      const text = file.data ? new TextDecoder().decode(Uint8Array.from(atob(file.data), c => c.charCodeAt(0))) : '';
      let imported: ReturnType<typeof importIcal>;
      try { imported = importIcal(text); } catch (error: any) { return { refused: t('calendar/unreadable', { name: file.name, detail: String(error?.message ?? error) }) }; }
      if (!imported.events.length) return { refused: t('calendar/no-events', { name: file.name }) };
      const uids = new Set(imported.events.map(e => e.uid));
      write({ ...cal, events: [...cal.events.filter(e => !uids.has(e.uid)), ...imported.events] });
      selected = imported.events.map(e => e.date).sort()[0]; month = selected.slice(0, 7); editing = null; slots = null;
      render();
    });

    // working hours set in the desktop's Settings show here at once
    const onHours = () => { cal = read(); slots = null; render(); };
    win.addEventListener(CHANGED, onHours);
    render();
    void loadBackground();
    // the schedules change rarely: read them again every minute while the Calendar is open
    const reread = win.setInterval(() => { void loadBackground(); }, 60_000);
    return () => { live = false; win.clearInterval(reread); win.removeEventListener(CHANGED, onHours); root.remove(); };
  };
}

/** The event the Calendar's settings send when they change its document. */
const CHANGED = 'tangle-calendar-changed';

/**
 * The Calendar's section in the desktop's Settings: the working hours that
 * "find a time" searches within. It writes the same document the Calendar
 * keeps, and an open Calendar window redraws from it.
 */
export function calendarSettingsMount(): ShippedMount {
  return (node) => {
    const doc = node.ownerDocument, win = doc.defaultView!;
    const read = (): CalendarDocument => { try { const v = JSON.parse(win.localStorage.getItem(SLOT) ?? 'null'); return v?.$calendar === '0.1' ? v : emptyCalendar(); } catch { return emptyCalendar(); } };
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, text?: string) => {
      const e = doc.createElement(tag); for (const [k, v] of Object.entries(props)) e.setAttribute(k, v); if (text) e.textContent = text; return e;
    };
    const status = el('p', { class: 'tos-settings-status', role: 'status' });
    const save = (change: (hours: CalendarDocument['hours']) => CalendarDocument['hours'] | string) => {
      const cal = read(), next = change({ ...cal.hours, days: [...cal.hours.days] });
      if (typeof next === 'string') { status.textContent = next; status.dataset.tone = 'fail'; return; }
      try { win.localStorage.setItem(SLOT, JSON.stringify({ ...cal, hours: next })); } catch { /* kept for this session */ }
      win.dispatchEvent(new Event(CHANGED));
      status.textContent = t('calendar/settings-saved'); status.dataset.tone = 'ok';
    };
    const hours = read().hours;
    const heading = el('h2', {}, t('calendar/working-hours'));
    const lead = el('p', { class: 'tos-muted' }, t('calendar/working-hours-lead'));
    const days = el('fieldset', { class: 'tos-choices' });
    days.append(el('legend', {}, t('calendar/days')));
    const names = new Intl.DateTimeFormat(doc.documentElement.lang || 'en', { weekday: 'long' });
    WEEKDAYS.forEach((day, i) => {
      const label = el('label', { class: 'tos-check' });
      const box = el('input', { type: 'checkbox', name: 'day', value: day }) as HTMLInputElement;
      box.checked = hours.days.includes(day);
      box.addEventListener('change', () => save(h => ({ ...h, days: WEEKDAYS.filter(d => d === day ? box.checked : h.days.includes(d)) })));
      label.append(box, names.format(new Date(2026, 0, 5 + i)));
      days.append(label);
    });
    const time = (labelText: string, value: string, key: 'start' | 'end') => {
      const label = el('label', { class: 'tos-field' }); const span = el('span', {}, labelText);
      const input = el('input', { type: 'time', value, 'aria-label': labelText }) as HTMLInputElement;
      input.addEventListener('change', () => save(h => { const next = { ...h, [key]: input.value }; return next.end > next.start ? next : t('calendar/day-end-after'); }));
      label.append(span, input); return label;
    };
    const times = el('div', { class: 'tos-row' });
    times.append(time(t('calendar/starts'), hours.start, 'start'), time(t('calendar/ends'), hours.end, 'end'));
    // the background-work layer: shown unless the person hides it
    const runs = el('label', { class: 'tos-check' });
    const runsBox = el('input', { type: 'checkbox', name: 'background' }) as HTMLInputElement;
    runsBox.checked = read().background !== false;
    runsBox.addEventListener('change', () => {
      try { win.localStorage.setItem(SLOT, JSON.stringify({ ...read(), background: runsBox.checked })); } catch { /* kept for this session */ }
      win.dispatchEvent(new Event(CHANGED));
      status.textContent = t('calendar/settings-saved'); status.dataset.tone = 'ok';
    });
    runs.append(runsBox, t('calendar/show-runs'));
    node.append(heading, lead, days, times, runs, status);
    return () => { heading.remove(); lead.remove(); days.remove(); times.remove(); runs.remove(); status.remove(); };
  };
}

function shiftMonth(ym: string, n: number) { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1); return isoDate(d).slice(0, 7); }
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
