/**
 * The desktop Calendar's model, headless: recurring events expand through
 * Jaren's calendar engine, a skipped day stays skipped, proposed events are
 * checked before they are kept, free time never falls outside the working
 * hours or on an event, monthly and yearly series skip the dates a month or
 * year lacks rather than moving them, and the calendar exports as iCalendar.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkEvent, emptyCalendar, exportIcal, freeSlots, occurrences, repeatHint, seed, supportedRepeats, type CalendarDocument } from '../../apps/pages/src/os/calendar-model.ts';

const withEvents = (...inputs: any[]): CalendarDocument => ({ ...emptyCalendar(), events: inputs.map(i => { const r = checkEvent(i); assert.ok(r.ok, JSON.stringify(r)); return (r as any).event; }) });

describe('the calendar model', () => {
  it('expands recurring events and keeps a skipped day skipped', () => {
    const doc = withEvents(
      { uid: 'standup', title: 'Standup', date: '2026-11-16', start: '09:00', end: '09:15', repeat: 'weekdays' },
      { uid: 'review', title: 'Review', date: '2026-11-18', start: '14:00', end: '15:00' },
      { uid: 'offsite', title: 'Offsite', date: '2026-11-20', allDay: true },
    );
    doc.events[0].exdates = ['2026-11-17'];
    const week = occurrences(doc, '2026-11-16', '2026-11-23');
    assert.deepEqual(week.map(o => `${o.date} ${o.allDay ? 'all-day' : o.start} ${o.title}`), [
      '2026-11-16 09:00 Standup', '2026-11-18 09:00 Standup', '2026-11-18 14:00 Review',
      '2026-11-19 09:00 Standup', '2026-11-20 all-day Offsite', '2026-11-20 09:00 Standup',
    ]);
  });
  it('checks what it is given', () => {
    assert.equal(checkEvent({ title: ' ', date: '2026-11-16' }).ok, false);
    assert.match((checkEvent({ title: 'x', date: '16-11-2026', start: '09:00', end: '10:00' }) as any).error, /YYYY-MM-DD/);
    assert.match((checkEvent({ title: 'x', date: '2026-11-16', start: '10:00', end: '09:00' }) as any).error, /end after/);
    assert.match((checkEvent({ title: 'x', date: '2026-11-16', start: '9am', end: '10:00' }) as any).error, /HH:MM/);
    const kept = checkEvent({ title: 'x', date: '2026-11-16', start: '09:00', end: '10:00', colour: 'neon' as any, uid: '<script>' });
    assert.ok(kept.ok && kept.event.colour === 'teal' && /^ev-/.test(kept.event.uid));
    assert.ok(supportedRepeats().includes('weekly'));
  });
  it('offers free time only inside working hours and around events', () => {
    const doc = withEvents({ title: 'Busy morning', date: '2026-11-16', start: '09:00', end: '12:00' });
    // Monday 16 November 2026, 07:00 UTC is 08:00 in Amsterdam; hours are 09:00 to 17:00
    const slots = freeSlots(doc, { minutes: 60, days: 1, now: Date.parse('2026-11-16T07:00:00Z'), zone: 'Europe/Amsterdam' });
    assert.ok(slots.length > 0);
    for (const s of slots) {
      const local = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);
      assert.ok(local(s.start) >= '12:00' && local(s.end) <= '17:00', `${local(s.start)}–${local(s.end)}`);
    }
    const weekend = freeSlots(doc, { minutes: 60, days: 1, now: Date.parse('2026-11-21T07:00:00Z'), zone: 'Europe/Amsterdam' });
    assert.deepEqual(weekend, [], 'no working hours on a Saturday: nothing is offered');
  });
  it('exports iCalendar with the rule and the skipped days', () => {
    const doc = withEvents({ uid: 'standup', title: 'Standup', date: '2026-11-16', start: '09:00', end: '09:15', repeat: 'weekdays' });
    doc.events[0].exdates = ['2026-11-17'];
    const ics = exportIcal(doc);
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR/);
    assert.match(ics, /EXDATE[^\r\n]*20261117T090000/);
    assert.match(ics, /SUMMARY:Standup/);
  });
  it('seeds a first look once, and never again after the person clears it', () => {
    const first = seed(emptyCalendar(), '2026-11-18');
    assert.equal(first.events.length, 2);
    assert.equal(seed({ ...first, events: [] }, '2026-11-18').events.length, 0);
  });
  it('repeats monthly and yearly, skipping the dates a month or year lacks', () => {
    assert.deepEqual(supportedRepeats(), ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly']);
    const doc = withEvents(
      { uid: 'rent', title: 'Rent', date: '2027-01-31', start: '09:00', end: '09:30', repeat: 'monthly' },
      { uid: 'leap', title: 'Leap', date: '2028-02-29', allDay: true, repeat: 'yearly' },
    );
    assert.deepEqual(occurrences(doc, '2027-01-01', '2027-08-01').map(o => o.date), ['2027-01-31', '2027-03-31', '2027-05-31', '2027-07-31']);
    assert.deepEqual(occurrences(doc, '2028-01-01', '2037-01-01').filter(o => o.uid === 'leap').map(o => o.date), ['2028-02-29', '2032-02-29', '2036-02-29']);
    assert.equal(repeatHint('monthly', '2027-01-31'), 'Months without a 31st are skipped.');
    assert.equal(repeatHint('monthly', '2027-01-29'), 'Months without a 29th are skipped.');
    assert.equal(repeatHint('monthly', '2027-01-28'), '');
    assert.equal(repeatHint('yearly', '2028-02-29'), 'Repeats only in leap years.');
    assert.equal(repeatHint('weekly', '2027-01-31'), '');
    assert.match(exportIcal(doc), /RRULE:FREQ=MONTHLY/);
  });
});

describe('importing an iCalendar file', () => {
  it('reads back what this calendar exports: single, all-day and repeating events, with the days a series skips', async () => {
    const { importIcal, exportIcal: write, checkEvent: check, emptyCalendar: empty } = await import('../../apps/pages/src/os/calendar-model.ts');
    const events = [
      check({ uid: 'dentist-1', title: 'Dentist', date: '2026-11-20', start: '15:00', end: '15:45', notes: 'bring card' }),
      check({ uid: 'holiday-1', title: 'Holiday', date: '2026-12-24', allDay: true }),
      check({ uid: 'standup-1', title: 'Standup', date: '2026-11-16', start: '09:00', end: '09:15', repeat: 'weekdays', exdates: ['2026-11-18'] }),
    ].map((r: any) => r.event);
    const { events: back, skipped } = importIcal(write({ ...empty(), events }));
    assert.equal(skipped, 0);
    const shape = (e: any) => [e.uid, e.title, e.date, e.start, e.end, e.allDay, e.repeat, e.exdates.join(','), e.notes ?? ''];
    assert.deepEqual(back.map(shape).sort(), events.map(shape).sort());
  });
  it('counts what it cannot keep instead of changing it', async () => {
    const { importIcal } = await import('../../apps/pages/src/os/calendar-model.ts');
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//x//y//EN',
      'BEGIN:VEVENT', 'UID:every-other', 'DTSTAMP:20260101T000000Z', 'DTSTART:20260105T090000', 'DTEND:20260105T100000', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'SUMMARY:Every other week', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:lunch', 'DTSTAMP:20260101T000000Z', 'DTSTART:20260106T120000', 'DURATION:PT30M', 'SUMMARY:Lunch', 'END:VEVENT',
      'END:VCALENDAR', ''].join('\r\n');
    const { events, skipped } = importIcal(text);
    assert.equal(skipped, 1);
    assert.deepEqual(events.map(e => [e.title, e.date, e.start, e.end]), [['Lunch', '2026-01-06', '12:00', '12:30']]);
  });
});
