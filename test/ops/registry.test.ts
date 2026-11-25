/**
 * The job registry: the document a host writes about its background jobs. A
 * job says how safe it is to repeat; a single-send job never gets a second
 * attempt or a catch-up; every refusal names its place.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkRegistry, maxAttemptsOf, type JobRegistry } from '@tangleai/ops';

const valid: JobRegistry = {
  $registry: '0.1', name: 'shop', zone: 'Europe/Amsterdam',
  jobs: [
    { kind: 'stock.sync', title: { en: 'Read the stock', nl: 'Voorraad lezen' }, handler: { contract: 'stock', operation: 'stock.pull' }, safety: 'safe-read',
      schedule: { utc: '2027-02-28T23:00:00Z', rrule: 'FREQ=MINUTELY;INTERVAL=30' } },
    { kind: 'stock.full', title: { en: 'Read all stock' }, handler: { contract: 'stock', operation: 'stock.pull-all' }, safety: 'safe-read',
      schedule: { at: { date: '2027-03-01', time: '03:00' }, rrule: 'FREQ=DAILY' } },
    { kind: 'picklist.weekly', title: { en: 'Make the pick list' }, handler: { code: 'picklist' }, safety: 'provider-idempotent', limits: { maxAttempts: 3 },
      schedule: { at: { date: '2027-03-01', time: '06:00' }, rrule: 'FREQ=WEEKLY;BYDAY=MO', zone: 'Europe/Amsterdam' } },
    { kind: 'sales.push', title: { en: 'Send the sales' }, handler: { contract: 'stock', operation: 'sales.post' }, safety: 'single-send', budget: { runsPerDay: 200 }, owner: 'warehouse' },
  ],
};
const problems = (doc: unknown) => { const r = checkRegistry(doc); return r.ok ? [] : r.problems; };
const at = (doc: unknown) => problems(doc).map(p => p.pointer);
const withJob = (patch: Record<string, unknown>, i = 3) => ({ ...valid, jobs: valid.jobs.map((j, n) => n === i ? { ...j, ...patch } : j) });

describe('the job registry', () => {
  it('takes a registry of reads, an idempotent job and a single-send push', () => {
    assert.deepEqual(problems(valid), []);
    assert.equal(maxAttemptsOf(valid.jobs[0]), 5);
    assert.equal(maxAttemptsOf(valid.jobs[2]), 3);
    assert.equal(maxAttemptsOf(valid.jobs[3]), 1);
  });

  it('refuses a job that does not say how safe it is to repeat', () => {
    const { safety: _, ...unsafe } = valid.jobs[3];
    assert.deepEqual(at({ ...valid, jobs: [unsafe] }), ['/jobs/0/safety']);
  });

  it('never lets a single-send job run twice or catch up', () => {
    assert.deepEqual(at(withJob({ limits: { maxAttempts: 2 } })), ['/jobs/3/limits/maxAttempts']);
    assert.deepEqual(at(withJob({ schedule: { utc: '2027-03-01T00:00:00Z', rrule: 'FREQ=HOURLY', missed: 'once' } })), ['/jobs/3/schedule/missed']);
  });

  it('refuses a kind registered twice, the runtime\'s own kind, and a member it does not know', () => {
    assert.deepEqual(at({ ...valid, jobs: [valid.jobs[0], valid.jobs[0]] }), ['/jobs/1/kind']);
    assert.deepEqual(at(withJob({ kind: 'ops.fire' })), ['/jobs/3/kind']);
    assert.deepEqual(at(withJob({ secret: true })), ['/jobs/3/secret']);
  });

  it('refuses a schedule that starts twice or nowhere, a wall clock without a zone, and a rule the calendar refuses', () => {
    assert.deepEqual(at(withJob({ schedule: { utc: '2027-03-01T00:00:00Z', at: { date: '2027-03-01', time: '00:00' }, rrule: 'FREQ=DAILY' } })), ['/jobs/3/schedule']);
    assert.deepEqual(at({ ...valid, zone: undefined, jobs: [valid.jobs[1]] }), ['/jobs/0/schedule/zone']);
    assert.deepEqual(at(withJob({ schedule: { utc: '2027-03-01T00:00:00Z', rrule: 'FREQ=SOMETIMES' } }, 0)), ['/jobs/0/schedule/rrule']);
  });

  it('refuses a handler that is neither a contract operation nor code, and a budget that is not runs a day', () => {
    assert.deepEqual(at(withJob({ handler: { contract: 'stock' } })), ['/jobs/3/handler']);
    assert.deepEqual(at(withJob({ budget: { requests: 3 } })), ['/jobs/3/budget']);
  });
});
