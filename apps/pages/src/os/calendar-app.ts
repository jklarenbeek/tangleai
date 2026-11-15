/**
 * The Calendar application: a month you can read at a glance, the selected
 * day beside it, an editor that stays in place, and "find a time" over your
 * working hours. It serves a `calendar` contract (agenda, add, free), so the
 * assistant and other applications can read and book it like any service.
 */
import type { ShippedMount } from '@tangleai/os/shell';
import {
  COLOURS, WEEKDAYS, addDays, checkEvent, emptyCalendar, exportIcal, freeSlots, isoDate, occurrences, parseDate, seed, supportedRepeats,
  type CalendarDocument, type CalendarEvent, type Occurrence, type Repeat,
} from './calendar-model.ts';

const SLOT = 'tangle-calendar';
const REPEAT_LABEL: Record<Repeat, string> = { none: 'Does not repeat', daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

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

export function calendarMount(): ShippedMount {
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

      const head = h('header', { class: 'cal-head' },
        h('div', { class: 'cal-nav' },
          h('button', { type: 'button', class: 'cal-icon', 'aria-label': 'Previous month', onclick: () => { month = shiftMonth(month, -1); render(); } }, '‹'),
          h('button', { type: 'button', class: 'cal-icon', 'aria-label': 'Next month', onclick: () => { month = shiftMonth(month, 1); render(); } }, '›'),
          h('button', { type: 'button', class: 'cal-today', onclick: () => { month = today.slice(0, 7); selected = today; render(); } }, 'Today')),
        h('h1', { class: 'cal-title' }, monthTitle(month)),
        h('div', { class: 'cal-actions' },
          h('button', { type: 'button', class: 'cal-ghost', onclick: download }, 'Export .ics'),
          h('button', { type: 'button', class: 'cal-primary', onclick: () => openEditor({ date: selected }) }, 'New event')));

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
        if (items.length > 3) cell.append(h('span', { class: 'cal-more' }, `+${items.length - 3} more`));
        grid.append(cell);
      }

      root.replaceChildren(head, h('div', { class: 'cal-body' }, grid, side(byDay.get(selected) ?? occurrences(cal, selected, addDays(selected, 1)))));
      (root.querySelector('.cal-day.is-selected') as HTMLElement | null)?.setAttribute('tabindex', '0');
    }

    function side(items: Occurrence[]) {
      const panel = h('aside', { class: 'cal-side' });
      if (editing) { panel.append(editor()); return panel; }
      panel.append(h('h2', { class: 'cal-side-title' }, dayTitle(selected)));
      if (!items.length) panel.append(h('p', { class: 'cal-empty' }, 'Nothing planned. Add an event, or find a free time below.'));
      else panel.append(h('ul', { class: 'cal-agenda' }, ...items.map(o => h('li', { class: `cal-item c-${o.colour}` },
        h('span', { class: 'cal-item-time' }, o.allDay ? 'All day' : `${time(o.start)} – ${time(o.end)}`),
        h('strong', { class: 'cal-item-title' }, o.title),
        o.repeat !== 'none' ? h('span', { class: 'cal-item-repeat' }, REPEAT_LABEL[o.repeat]) : null,
        h('span', { class: 'cal-item-actions' },
          h('button', { type: 'button', class: 'cal-link', onclick: () => openEditor(cal.events.find(e => e.uid === o.uid)!) }, 'Edit'),
          o.repeat !== 'none' ? h('button', { type: 'button', class: 'cal-link', onclick: () => skipOne(o) }, 'Skip this day') : null,
          h('button', { type: 'button', class: 'cal-link is-danger', onclick: () => remove(o.uid) }, o.repeat !== 'none' ? 'Delete all' : 'Delete'))))));
      panel.append(finder());
      return panel;
    }

    function finder() {
      const box = h('section', { class: 'cal-find' }, h('h3', {}, 'Find a time'));
      const lengths = h('div', { class: 'cal-segment', role: 'radiogroup', 'aria-label': 'Length' },
        ...[30, 60, 90, 120].map(m => h('button', { type: 'button', role: 'radio', 'aria-checked': String(m === findMinutes), onclick: () => { findMinutes = m; slots = null; render(); } }, m < 60 ? `${m} min` : `${m / 60} h`.replace('.5 h', '½ h'))));
      const hours = h('p', { class: 'cal-hours' }, `Within your working hours, ${time(cal.hours.start)}–${time(cal.hours.end)} on ${cal.hours.days.map(d => weekdayShort[WEEKDAYS.indexOf(d)]).join(', ')}, over the next 7 days.`);
      const search = h('button', { type: 'button', class: 'cal-ghost', onclick: () => { slots = freeSlots(cal, { minutes: findMinutes }); render(); } }, 'Search');
      box.append(lengths, hours, search);
      if (slots) {
        if (!slots.length) box.append(h('p', { class: 'cal-empty' }, 'No free time of that length in your working hours this week.'));
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
      const title = h('input', { type: 'text', value: e.title ?? '', placeholder: 'What is it?', 'aria-label': 'Title', class: 'cal-input cal-input-title' }) as HTMLInputElement;
      const date = h('input', { type: 'date', value: e.date ?? selected, 'aria-label': 'Date', class: 'cal-input' }) as HTMLInputElement;
      const allDay = h('input', { type: 'checkbox', checked: e.allDay === true }) as HTMLInputElement;
      const start = h('input', { type: 'time', value: e.start ?? '09:00', 'aria-label': 'Starts', class: 'cal-input' }) as HTMLInputElement;
      const end = h('input', { type: 'time', value: e.end ?? '10:00', 'aria-label': 'Ends', class: 'cal-input' }) as HTMLInputElement;
      const times = h('div', { class: 'cal-row' }, start, h('span', { class: 'cal-dash' }, '–'), end);
      const syncTimes = () => { times.hidden = allDay.checked; };
      allDay.addEventListener('change', syncTimes); syncTimes();
      const repeat = h('select', { class: 'cal-input', 'aria-label': 'Repeat' }, ...repeats.map(r => h('option', { value: r, selected: r === (e.repeat ?? 'none') }, REPEAT_LABEL[r]))) as HTMLSelectElement;
      let colour = e.colour ?? 'teal';
      const swatches = h('div', { class: 'cal-swatches', role: 'radiogroup', 'aria-label': 'Colour' },
        ...COLOURS.map(c => h('button', { type: 'button', role: 'radio', class: `cal-swatch c-${c}`, 'aria-label': c, 'aria-checked': String(c === colour), onclick: (ev: Event) => {
          colour = c; for (const b of swatches.children) b.setAttribute('aria-checked', String(b === ev.currentTarget));
        } })));
      const notes = h('textarea', { class: 'cal-input', rows: 3, placeholder: 'Notes', 'aria-label': 'Notes' }, e.notes ?? '') as HTMLTextAreaElement;
      const save = () => {
        const checked = checkEvent({ ...e, title: title.value, date: date.value, allDay: allDay.checked, start: start.value, end: end.value, repeat: repeat.value as Repeat, colour, notes: notes.value });
        if (!checked.ok) { status.textContent = checked.error; return; }
        write({ ...cal, events: [...cal.events.filter(x => x.uid !== checked.event.uid), checked.event] });
        selected = checked.event.date; month = selected.slice(0, 7); editing = null; slots = null; render();
      };
      const form = h('form', { class: 'cal-editor', onsubmit: (ev: Event) => { ev.preventDefault(); save(); } },
        h('h2', { class: 'cal-side-title' }, isNew ? 'New event' : 'Edit event'),
        title, date,
        h('label', { class: 'cal-check' }, allDay, h('span', {}, 'All day')),
        times, repeat, swatches, notes, status,
        h('div', { class: 'cal-row cal-form-actions' },
          h('button', { type: 'submit', class: 'cal-primary' }, 'Save'),
          h('button', { type: 'button', class: 'cal-ghost', onclick: () => { editing = null; render(); } }, 'Cancel'),
          !isNew ? h('button', { type: 'button', class: 'cal-link is-danger', onclick: () => remove(e.uid!) }, 'Delete') : null));
      win.setTimeout(() => title.focus(), 0);
      return form;
    }

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

    render();
    return () => root.remove();
  };
}

function shiftMonth(ym: string, n: number) { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1 + n, 1); return isoDate(d).slice(0, 7); }
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
