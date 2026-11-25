/**
 * The Jobs application's pure parts: a schedule's rule in words in the
 * person's language, its next runs computed from the rule document with
 * Jaren's calendar (a run the spring clock change moves and a wall time the
 * autumn change repeats are marked, a floating rule without zone data is not
 * guessed), the order states are listed in (what needs a person first), and a
 * valid system manifest. The window itself is driven in a browser
 * (.e2e/migration/os-jobs.spec.mjs).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileRecurrence, floatingValue, utcValue } from '@jarenjs/core/calendar';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { validateManifest, createOsMessages } from '@tangleai/os';
import { nl } from '@tangleai/os/messages/nl';
import { describeRule, nextRuns, jobsModule, STATE_ORDER, attemptRows, runtimeAge, STALE_AFTER_MS } from '@tangleai/os/jobs-app';
import { unconfiguredJobQueue } from '@tangleai/os/jobs';

const en = createOsMessages();
const dutch = createOsMessages(nl);
const floating = (date: string, time: string, rrule: string) => compileRecurrence({ dtstart: floatingValue(date, time), rrule }) as any;
const utc = (instant: string, rrule: string) => compileRecurrence({ dtstart: utcValue(instant), rrule }) as any;
const zones = createIntlZoneProvider({ revision: 'test ICU' });

describe('a rule in words', () => {
  it('says every so many seconds, minutes or hours', () => {
    assert.equal(describeRule(utc('2027-03-01T00:00:00Z', 'FREQ=MINUTELY;INTERVAL=15'), null, en), 'Every 15 minutes');
    assert.equal(describeRule(utc('2027-03-01T00:00:00Z', 'FREQ=MINUTELY'), null, en), 'Every minute');
    assert.equal(describeRule(utc('2027-03-01T00:00:00Z', 'FREQ=HOURLY;INTERVAL=2'), null, en), 'Every 2 hours');
    assert.equal(describeRule(utc('2027-03-01T00:00:00Z', 'FREQ=SECONDLY;INTERVAL=30'), null, en), 'Every 30 seconds');
    assert.equal(describeRule(utc('2027-03-01T00:00:00Z', 'FREQ=HOURLY'), null, en), 'Every hour');
  });

  it('says a day, weekdays or days of the month at their times, on the zone\'s wall clock', () => {
    assert.equal(describeRule(floating('2027-03-01', '03:00', 'FREQ=DAILY'), 'Europe/Amsterdam', en), 'Every day at 3:00 AM, Europe/Amsterdam time');
    assert.equal(describeRule(floating('2027-03-01', '06:00', 'FREQ=WEEKLY;BYDAY=MO'), 'Europe/Amsterdam', en), 'Every Monday at 6:00 AM, Europe/Amsterdam time');
    assert.equal(describeRule(floating('2027-03-01', '00:00', 'FREQ=WEEKLY;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=30'), 'Europe/Amsterdam', en), 'Every Monday and Friday at 9:30 AM, Europe/Amsterdam time');
    assert.equal(describeRule(floating('2027-03-01', '08:00', 'FREQ=MONTHLY;BYMONTHDAY=1,15'), 'Europe/Amsterdam', en), 'Monthly on day 1 and 15 at 8:00 AM, Europe/Amsterdam time');
    assert.equal(describeRule(floating('2027-03-01', '07:00', 'FREQ=DAILY;INTERVAL=3'), null, en), 'Every 3 days at 7:00 AM');
    assert.equal(describeRule(floating('2027-03-01', '07:00', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU'), null, en), 'Every 2 weeks on Tuesday at 7:00 AM');
  });

  it('speaks the person\'s language, with its own units and weekday names', () => {
    assert.equal(describeRule(utc('2027-03-01T00:00:00Z', 'FREQ=MINUTELY;INTERVAL=15'), null, dutch, 'nl'), 'Elke 15 minuten');
    assert.equal(describeRule(floating('2027-03-01', '06:00', 'FREQ=WEEKLY;BYDAY=MO'), 'Europe/Amsterdam', dutch, 'nl'), 'Elke maandag om 6:00, tijd in Europe/Amsterdam');
  });

  it('shows a rule it cannot say plainly as its RRULE text', () => {
    assert.equal(describeRule(floating('2027-03-01', '09:00', 'FREQ=MONTHLY;BYDAY=1MO'), null, en), 'Rule: FREQ=MONTHLY;BYDAY=1MO');
    assert.equal(describeRule(floating('2027-03-01', '09:00', 'FREQ=YEARLY;BYMONTH=3'), null, en), 'Rule: FREQ=YEARLY;BYMONTH=3');
    assert.equal(describeRule(floating('2027-03-01', '09:00', 'FREQ=DAILY;COUNT=5'), null, en), 'Rule: FREQ=DAILY;COUNT=5');
  });
});

describe('the next runs', () => {
  it('of a utc rule need no zone data', () => {
    const runs = nextRuns(utc('2027-03-01T00:00:00Z', 'FREQ=MINUTELY;INTERVAL=15'), null, 3, Date.parse('2027-03-01T01:05:00Z'));
    assert.deepEqual(runs?.map(r => new Date(r.at).toISOString()), ['2027-03-01T01:15:00.000Z', '2027-03-01T01:30:00.000Z', '2027-03-01T01:45:00.000Z']);
    assert.equal(runs?.some(r => r.mark), false);
  });

  it('of a daily 02:30 rule mark the run the spring change moves to 03:30', () => {
    const runs = nextRuns(floating('2027-03-20', '02:30', 'FREQ=DAILY'), 'Europe/Amsterdam', 3, Date.parse('2027-03-27T12:00:00Z'), zones)!;
    assert.deepEqual(runs.map(r => new Date(r.at).toISOString()), ['2027-03-28T01:30:00.000Z', '2027-03-29T00:30:00.000Z', '2027-03-30T00:30:00.000Z']);
    assert.deepEqual(runs.map(r => r.mark ?? null), ['gap', null, null]);
  });

  it('of a daily 02:30 rule mark the autumn run that falls in the repeated hour, and run it once', () => {
    const runs = nextRuns(floating('2027-10-20', '02:30', 'FREQ=DAILY'), 'Europe/Amsterdam', 3, Date.parse('2027-10-30T12:00:00Z'), zones)!;
    assert.deepEqual(runs.map(r => new Date(r.at).toISOString()), ['2027-10-31T00:30:00.000Z', '2027-11-01T01:30:00.000Z', '2027-11-02T01:30:00.000Z']);
    assert.deepEqual(runs.map(r => r.mark ?? null), ['fold', null, null]);
  });

  it('of a floating rule are not guessed without zone data or a zone', () => {
    assert.equal(nextRuns(floating('2027-03-01', '03:00', 'FREQ=DAILY'), 'Europe/Amsterdam', 3, Date.parse('2027-03-01T12:00:00Z')), null);
    assert.equal(nextRuns(floating('2027-03-01', '03:00', 'FREQ=DAILY'), null, 3, Date.parse('2027-03-01T12:00:00Z'), zones), null);
  });

  it('end when the rule ends', () => {
    assert.deepEqual(nextRuns(utc('2027-03-01T00:00:00Z', 'FREQ=DAILY;COUNT=2'), null, 3, Date.parse('2027-04-01T00:00:00Z')), []);
  });
});

describe('the Jobs application', () => {
  it('lists what needs a person first: failed and given-up jobs, then running, waiting, done and cancelled', () => {
    assert.deepEqual([...STATE_ORDER], ['failed', 'dead', 'leased', 'pending', 'done', 'cancelled']);
  });

  it('is a valid system application, titled in the desktop\'s language', () => {
    const { manifest } = jobsModule({ queue: unconfiguredJobQueue(), messages: nl, locale: 'nl' });
    assert.equal(validateManifest(manifest).ok, true);
    assert.equal(manifest.category, 'system');
    assert.deepEqual(manifest.title, { en: 'Jobs', nl: 'Taken' });
    assert.equal(manifest.icon?.glyph, 'jobs');
  });
});

describe('what the runtime recorded', () => {
  it('tells a job\'s attempts oldest first, each with its start and outcome, and whether it was not repeated or refused by a budget', () => {
    const rows = attemptRows([
      { id: 'j#2:failed', at: 50, event: 'failed', jobId: 'j', attempt: 2, durationMs: 480 },
      { id: 'j#1:started', at: 10, event: 'started', jobId: 'j', attempt: 1 },
      { id: 'j#1:lost', at: 20, event: 'lost', jobId: 'j', attempt: 1 },
      { id: 'j#1:not-repeated', at: 20, event: 'not-repeated', jobId: 'j', attempt: 1 },
      { id: 'j#2:started', at: 40, event: 'started', jobId: 'j', attempt: 2 },
      { id: 'j#3:budget', at: 60, event: 'budget', jobId: 'j', attempt: 3 },
    ]);
    assert.deepEqual(rows.map(r => [r.attempt, r.started?.at ?? null, r.outcome?.event ?? null, r.notRepeated, r.budget]),
      [[1, 10, 'lost', true, false], [2, 40, 'failed', false, false], [3, null, null, false, true]]);
  });

  it('knows how long ago the runtime reported, by the host\'s clock, and nothing when no runtime reports', () => {
    assert.equal(runtimeAge(null), null);
    assert.equal(runtimeAge({ now: 1_000_000, runtimes: [] }), null);
    assert.equal(runtimeAge({ now: 1_000_000, runtimes: [{ runtime: 'a', at: 900_000, stats: {} }, { runtime: 'b', at: 990_000, stats: {} }] }), 10_000);
    assert.equal(STALE_AFTER_MS, 90_000);
  });

  it('says a lost attempt that is not repeated and a refused budget plainly, in every language', () => {
    assert.equal(en('jobs/not-repeated'), 'Not repeated: it may already have been sent; run it again only if it did not arrive.');
    assert.equal(dutch('jobs/run-single-confirm', { title: 'De orders verzenden' }), 'Dit wordt één keer verzonden en niet herhaald. De orders verzenden nu uitvoeren?');
  });
});

