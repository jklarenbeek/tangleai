/**
 * The calendar's document and its arithmetic, with no DOM: events are plain
 * JSON a person can read and export; Jaren's calendar engine expands their
 * recurrence, keeps their wall-clock times floating, and finds free time
 * from working hours and busy events, never counting unknown time as free.
 */
import {
  compileRecurrence, defineSeries, expandSeries, floatingValue, dateValue, utcValue,
  weeklyPattern, evaluateAvailability, findAvailableSlots,
} from '@jarenjs/core/calendar';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { stringifyIcal } from '@jarenjs/josl/ical';

export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
export type Colour = 'teal' | 'blue' | 'violet' | 'rose' | 'amber' | 'slate';
export type CalendarEvent = {
  uid: string; title: string; date: string; start: string; end: string;
  allDay: boolean; repeat: Repeat; colour: Colour; exdates: string[]; notes?: string;
};
export type WorkingHours = { days: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[], start: string, end: string };
export type CalendarDocument = { $calendar: '0.1', events: CalendarEvent[], hours: WorkingHours, seeded?: boolean };
export type Occurrence = { uid: string, title: string, colour: Colour, allDay: boolean, repeat: Repeat, date: string, start: string, end: string, recurrenceId: string, notes?: string };

export const COLOURS: Colour[] = ['teal', 'blue', 'violet', 'rose', 'amber', 'slate'];
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const RULES: Record<Exclude<Repeat, 'none'>, string> = {
  daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY',
};

export const emptyCalendar = (): CalendarDocument => ({ $calendar: '0.1', events: [], hours: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' } });

/** YYYY-MM-DD of a local date. */
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: string, n: number) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Which repeat choices the installed engine expands (monthly and yearly arrived later). */
export function supportedRepeats(): Repeat[] {
  const all: Repeat[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
  return all.filter(r => {
    if (r === 'none') return true;
    try { compileRecurrence({ dtstart: floatingValue('2026-01-05', '09:00'), duration: 'PT1H', rrule: RULES[r] }); return true; }
    catch { return false; }
  });
}

/** Check and normalise an event a person, the assistant or another module proposes. */
export function checkEvent(input: Partial<CalendarEvent>): { ok: true, event: CalendarEvent } | { ok: false, error: string } {
  const title = String(input.title ?? '').trim().slice(0, 200);
  if (!title) return { ok: false, error: 'An event needs a title.' };
  if (!DATE.test(String(input.date))) return { ok: false, error: 'The date must be YYYY-MM-DD.' };
  const allDay = input.allDay === true;
  const start = allDay ? '00:00' : String(input.start ?? '');
  const end = allDay ? '23:59' : String(input.end ?? '');
  if (!allDay && (!HHMM.test(start) || !HHMM.test(end))) return { ok: false, error: 'Times must be HH:MM.' };
  if (!allDay && end <= start) return { ok: false, error: 'The event must end after it starts.' };
  const repeat = (input.repeat ?? 'none') as Repeat;
  if (!supportedRepeats().includes(repeat)) return { ok: false, error: `Repeating ${repeat} is not available in this calendar engine.` };
  const colour = COLOURS.includes(input.colour as Colour) ? input.colour as Colour : 'teal';
  const exdates = Array.isArray(input.exdates) ? input.exdates.filter(d => DATE.test(String(d))).slice(0, 500) : [];
  const uid = typeof input.uid === 'string' && /^[a-z0-9-]{4,64}$/.test(input.uid) ? input.uid : `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const notes = typeof input.notes === 'string' && input.notes.trim() ? input.notes.trim().slice(0, 2000) : undefined;
  return { ok: true, event: { uid, title, date: String(input.date), start, end, allDay, repeat, colour, exdates, ...(notes ? { notes } : {}) } };
}

/** The Jaren series of one event: a recurrence for its first day, its rule, and the days it skips. */
function seriesOf(event: CalendarEvent) {
  const base = event.allDay
    ? compileRecurrence({ dtstart: dateValue(event.date), duration: 'P1D', ...(event.repeat !== 'none' ? { rrule: RULES[event.repeat] } : {}) } as any)
    : compileRecurrence({ dtstart: floatingValue(event.date, event.start), dtend: floatingValue(event.date, event.end), ...(event.repeat !== 'none' ? { rrule: RULES[event.repeat] } : {}) } as any);
  const exdates = event.exdates.map(d => event.allDay ? dateValue(d) : floatingValue(d, event.start));
  return defineSeries({ uid: event.uid, base, exdates } as any);
}

/** Every occurrence between two dates (end exclusive), in order of start. */
export function occurrences(doc: CalendarDocument, from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const event of doc.events) {
    if (event.repeat === 'none') {
      if (event.date >= from && event.date < to && !event.exdates.includes(event.date))
        out.push({ uid: event.uid, title: event.title, colour: event.colour, allDay: event.allDay, repeat: event.repeat, date: event.date, start: event.start, end: event.end, recurrenceId: event.date, ...(event.notes ? { notes: event.notes } : {}) });
      continue;
    }
    try {
      const expanded: any = expandSeries(seriesOf(event), { horizon: [dateValue(from), dateValue(to)] });
      for (const o of expanded.occurrences ?? []) {
        const date = o.start.date;
        out.push({ uid: event.uid, title: event.title, colour: event.colour, allDay: event.allDay, repeat: event.repeat, date, start: event.allDay ? '00:00' : String(o.start.time).slice(0, 5), end: event.allDay ? '23:59' : String(o.end.time).slice(0, 5), recurrenceId: o.recurrenceId, ...(event.notes ? { notes: event.notes } : {}) });
      }
    } catch { /* an event the engine refuses shows nowhere rather than wrongly */ }
  }
  return out.sort((a, b) => (a.date + (a.allDay ? '' : a.start)).localeCompare(b.date + (b.allDay ? '' : b.start)));
}

let zones: any = null;
const provider = () => (zones ??= createIntlZoneProvider({ revision: 'host' }));
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * Free time of a length within the working hours of the next days: the
 * hours are the only available time, every event is busy over them, and
 * anything no layer claims stays unknown, so it is never offered.
 */
export function freeSlots(doc: CalendarDocument, options: { minutes: number, days?: number, now?: number, zone?: string, max?: number }) {
  const now = options.now ?? Date.now();
  const days = Math.max(1, Math.min(31, options.days ?? 7));
  const zone = options.zone ?? localZone();
  const fromDate = isoDate(new Date(now)), toDate = addDays(fromDate, days + 1);
  const hours: Record<string, [string, string][]> = {};
  for (const d of doc.hours.days) hours[d] = [[doc.hours.start, doc.hours.end]];
  const busy = occurrences(doc, fromDate, toDate).map(o => o.allDay
    ? dateValue(o.date)
    : { start: floatingValue(o.date, o.start), end: floatingValue(o.date, o.end) });
  const result: any = evaluateAvailability([
    { id: 'hours', priority: 5, mode: 'available', source: 'working-hours', series: weeklyPattern({ days: hours } as any) },
    ...(busy.length ? [{ id: 'events', priority: 1, mode: 'busy', source: 'calendar', spans: busy }] : []),
  ] as any, { horizon: [utcValue(now), utcValue(now + days * 86_400_000)], zone, zoneSource: 'browser', provider: provider(), policy: 'rfc5545' } as any);
  const minutes = Math.max(15, Math.min(480, Math.round(options.minutes)));
  const found: any = findAvailableSlots(result, { duration: `PT${minutes}M`, alignment: 'PT30M', step: 'PT30M' } as any);
  const toMs = (v: any) => typeof v === 'number' ? v : Date.parse(v?.instant ?? v);
  const slots = (found.slots ?? []).map((s: any) => ({ start: toMs(s.start), end: toMs(s.end) }));
  // one offer per hour at most: the next free times, not every half hour
  const offered: { start: number, end: number }[] = [];
  for (const slot of slots) if (!offered.length || slot.start >= offered[offered.length - 1].start + 60 * 60_000) offered.push(slot);
  return offered.slice(0, options.max ?? 6);
}

/** The whole calendar as an iCalendar file. */
export function exportIcal(doc: CalendarDocument): string {
  const components = doc.events.map(event => event.repeat === 'none'
    ? { type: 'event', uid: event.uid, summary: event.title, ...(event.notes ? { description: event.notes } : {}),
      start: event.allDay ? dateValue(event.date) : floatingValue(event.date, event.start),
      ...(event.allDay ? { duration: 'P1D' } : { end: floatingValue(event.date, event.end) }) }
    : { type: 'event', series: seriesOf(event), summary: event.title, ...(event.notes ? { description: event.notes } : {}) });
  return stringifyIcal({ prodId: '-//Tangle OS//Calendar//EN', components } as any, { zones: 'utc', provider: provider(), runtime: { now: () => Date.now() } } as any);
}

/** A first look that is not empty: two everyday series, removable like any other. */
export function seed(doc: CalendarDocument, today: string): CalendarDocument {
  if (doc.seeded || doc.events.length) return { ...doc, seeded: true };
  const monday = (() => { const d = parseDate(today); const back = (d.getDay() + 6) % 7; d.setDate(d.getDate() - back); return isoDate(d); })();
  const events = [
    checkEvent({ title: 'Plan the week', date: monday, start: '09:30', end: '10:00', repeat: 'weekly', colour: 'violet' }),
    checkEvent({ title: 'Lunch walk', date: monday, start: '12:30', end: '13:00', repeat: 'weekdays', colour: 'teal' }),
  ].flatMap(r => r.ok ? [r.event] : []);
  return { ...doc, events, seeded: true };
}
