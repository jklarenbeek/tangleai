/**
 * The background work in the Calendar, headless: a schedule's runs in a range
 * by the registered job's title, a schedule that runs more often than daily as
 * one count a day (a 23-hour DST day has 1,380 minutes), a run the spring clock
 * change moved marked as moved; the export holds only titles, UTC starts and
 * run identities; runs are never busy time.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileRecurrence, floatingValue, utcValue } from '@jarenjs/core/calendar';
import { parseIcal } from '@jarenjs/josl/ical';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { scheduledRuns } from '@tangleai/os/jobs-app';
import type { JobSchedule, RegisteredJob } from '@tangleai/os/jobs';
import { checkEvent, emptyCalendar, exportRunsIcal, freeSlots, occurrences, type CalendarDocument } from '../../apps/pages/src/os/calendar-model.ts';

const zoneProvider = createIntlZoneProvider({ revision: 'test ICU' });
// a series as it crosses the contract: its JSON, not the compiled object
const json = (definition: any) => JSON.parse(JSON.stringify(compileRecurrence(definition)));
const schedule = (id: string, series: any, zone: string | null, state: JobSchedule['state'] = 'active'): JobSchedule => ({
  id, kind: 'ops.fire', series, zone, policy: 'rfc5545', missed: 'skip', latenessMs: null, state,
  nextRunAt: null, nextRecurrenceId: null, lastRunAt: null, lastRecurrenceId: null, counts: { fired: 0, skipped: 0 }, stall: null, createdAt: 0, updatedAt: 0,
});
const REMINDERS = schedule('ops:pages:calendar.reminders', json({ dtstart: utcValue('2027-03-01T00:00:00Z'), rrule: 'FREQ=MINUTELY' }), null);
const TIDY = schedule('ops:pages:desktop.tidy', json({ dtstart: floatingValue('2027-03-01', '02:30'), rrule: 'FREQ=DAILY' }), 'Europe/Amsterdam');
const REGISTRY: RegisteredJob[] = [
  { kind: 'calendar.reminders', title: { en: 'Calendar reminders', nl: 'Agendaherinneringen' }, safety: 'safe-read', scheduled: true, schedule: REMINDERS.id },
  { kind: 'desktop.tidy', title: { en: 'Inbox tidy count' }, safety: 'safe-read', scheduled: true, schedule: TIDY.id },
];
// the spring change in Amsterdam: 2027-03-28 is 23 hours long (from 2027-03-27 23:00 UTC to 2027-03-28 22:00 UTC)
const DAY_FROM = Date.parse('2027-03-27T23:00:00Z'), DAY_TO = Date.parse('2027-03-28T22:00:00Z');

describe('the background work in the Calendar', () => {
  it('counts a minutely schedule once a day — 1,380 runs on the 23-hour DST day — and marks the daily run the clock change moved', () => {
    const runs = scheduledRuns([REMINDERS, TIDY], REGISTRY, DAY_FROM, DAY_TO, { locale: 'nl', zoneProvider, viewZone: 'Europe/Amsterdam' });
    assert.deepEqual(runs.map(r => r.type), ['summary', 'run']);
    const [minutely, daily] = runs as any[];
    assert.deepEqual({ date: minutely.date, count: minutely.count, title: minutely.title }, { date: '2027-03-28', count: 1380, title: 'Agendaherinneringen' });
    assert.equal(daily.title, 'Inbox tidy count', 'a title the locale lacks falls back to English');
    assert.equal(daily.mark, 'gap');
    assert.equal(new Date(daily.at).toISOString(), '2027-03-28T01:30:00.000Z', '02:30 does not exist that night: the run is at 03:30 summer time');
    assert.equal(daily.recurrenceId, '2027-03-28T02:30:00');
  });

  it('lists six weeks as one line a day per frequent schedule, never a line per run, and quickly', () => {
    const t0 = performance.now();
    const runs = scheduledRuns([REMINDERS, TIDY], REGISTRY, Date.parse('2027-02-28T23:00:00Z'), Date.parse('2027-04-11T22:00:00Z'), { zoneProvider, viewZone: 'Europe/Amsterdam' });   // local midnight to local midnight
    assert.ok(performance.now() - t0 < 1500, 'six weeks compute in well under a second and a half');
    assert.equal(runs.filter(r => r.type === 'summary').length, 42);
    assert.equal(runs.filter(r => r.type === 'run').length, 42);
  });

  it('draws nothing for a schedule that is not active, or a floating rule without zone data', () => {
    assert.deepEqual(scheduledRuns([schedule('x', TIDY.series, 'Europe/Amsterdam', 'stalled')], REGISTRY, DAY_FROM, DAY_TO, { zoneProvider }), []);
    assert.deepEqual(scheduledRuns([TIDY], REGISTRY, DAY_FROM, DAY_TO), []);
  });

  it('exports only titles, UTC starts and run identities; a frequent schedule as an all-day count', () => {
    const runs = scheduledRuns([REMINDERS, TIDY], REGISTRY, DAY_FROM, DAY_TO, { zoneProvider, viewZone: 'Europe/Amsterdam' });
    const text = exportRunsIcal(runs as any, { summary: (title, count) => `${title}: ${count} runs`, now: () => Date.parse('2027-03-27T12:00:00Z') });
    for (const forbidden of ['DESCRIPTION', 'LOCATION', 'ATTACH', 'X-', 'ops.fire', 'payload']) assert.equal(text.includes(forbidden), false, forbidden);
    const events = text.split('BEGIN:VEVENT').slice(1).map(block => Object.fromEntries(block.split(/\r?\n/).filter(l => /^[A-Z]/.test(l) && !l.startsWith('END')).map(l => { const i = l.indexOf(':'); return [l.slice(0, i), l.slice(i + 1)]; })));
    assert.equal(events.length, 2);
    const allowed = new Set(['UID', 'DTSTAMP', 'DTSTART', 'DTSTART;VALUE=DATE', 'SUMMARY', 'DURATION']);
    for (const e of events) for (const key of Object.keys(e)) assert.ok(allowed.has(key), `an event carries only its identity, title and time, not ${key}`);
    const daily = events.find(e => e.UID.startsWith(TIDY.id))!;
    assert.equal(daily.UID, `${TIDY.id}@2027-03-28T02:30:00`);
    assert.equal(daily.DTSTART, '20270328T013000Z', 'a run starts in UTC');
    assert.equal(daily.SUMMARY, 'Inbox tidy count');
    const count = events.find(e => e.UID.startsWith(REMINDERS.id))!;
    assert.equal(count.UID, `${REMINDERS.id}@2027-03-28`);
    assert.equal(count['DTSTART;VALUE=DATE'], '20270328');
    assert.equal(count.SUMMARY, 'Calendar reminders: 1380 runs');
    assert.ok(parseIcal(text, { provider: zoneProvider } as any), 'the file parses as iCalendar');
  });

  it('never counts a run as busy time: the person\'s free time is the same with or without background work', () => {
    const r = checkEvent({ uid: 'review', title: 'Review', date: '2027-03-29', start: '10:00', end: '11:00' });
    assert.ok(r.ok);
    const doc: CalendarDocument = { ...emptyCalendar(), events: [(r as any).event] };
    const before = freeSlots(doc, { minutes: 60, now: Date.parse('2027-03-29T06:00:00Z'), days: 2 });
    const runs = scheduledRuns([REMINDERS, TIDY], REGISTRY, Date.parse('2027-03-29T00:00:00Z'), Date.parse('2027-03-31T00:00:00Z'), { zoneProvider });
    assert.ok(runs.length > 0);
    assert.deepEqual(freeSlots({ ...doc, background: true }, { minutes: 60, now: Date.parse('2027-03-29T06:00:00Z'), days: 2 }), before);
    assert.deepEqual(occurrences({ ...doc, background: true }, '2027-03-29', '2027-03-31').map(o => o.uid), ['review'], 'runs never become the person\'s events');
  });
});
