/**
 * The simulation: a registry run over days on its own in-memory copy and
 * clock. Over 30 days across the spring clock change it reproduces the parity
 * counts measured in the campaign's first order (46 half-hour runs on the
 * 23-hour day, 92 quarter-hour, 276 five-minute, one 03:00 run each day, one
 * Monday 06:00 run a week); with a failure rate, safe reads are retried and
 * single-sends are given up without a repeat; nothing real is ever called.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nodeDriver } from '@jarenjs/db/node';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { simulateRegistry, registryFromHost, ruleText } from '@tangleai/ops/simulate';
import { seriesOf } from '@tangleai/ops';
import type { JobRegistry } from '@tangleai/ops';

const zoneProvider = createIntlZoneProvider({ revision: 'test ICU' });
const every = (minutes: number) => ({ utc: '2027-03-14T23:00:00Z', rrule: `FREQ=MINUTELY;INTERVAL=${minutes}` });   // from an Amsterdam midnight
const REGISTRY: JobRegistry = {
  $registry: '0.1', name: 'shop', zone: 'Europe/Amsterdam',
  jobs: [
    { kind: 'stock.sync', title: { en: 'Read the stock' }, handler: { contract: 'stock', operation: 'pull' }, safety: 'safe-read', schedule: every(30) },
    { kind: 'stock.readback', title: { en: 'Read back' }, handler: { contract: 'stock', operation: 'readback' }, safety: 'safe-read', schedule: every(15) },
    { kind: 'web.orders', title: { en: 'Web orders' }, handler: { contract: 'web', operation: 'orders' }, safety: 'safe-read', schedule: every(15) },
    { kind: 'sales.push', title: { en: 'Send the sales' }, handler: { contract: 'stock', operation: 'post' }, safety: 'single-send', schedule: every(15) },
    { kind: 'register.orders', title: { en: 'Register orders' }, handler: { contract: 'register', operation: 'orders' }, safety: 'safe-read', schedule: every(5) },
    { kind: 'stock.full', title: { en: 'Read all stock' }, handler: { contract: 'stock', operation: 'pull-all' }, safety: 'safe-read', schedule: { at: { date: '2027-03-01', time: '03:00' }, rrule: 'FREQ=DAILY' } },
    { kind: 'picklist.weekly', title: { en: 'Pick list' }, handler: { code: 'picklist' }, safety: 'provider-idempotent', schedule: { at: { date: '2027-03-01', time: '06:00' }, rrule: 'FREQ=WEEKLY;BYDAY=MO' } },
  ],
};
const FROM = Date.parse('2027-03-14T23:00:00Z');   // 2027-03-15 00:00 in Amsterdam, a Monday

describe('the simulation', () => {
  it('reproduces the parity counts per day over 30 days across the spring clock change, calling nothing real', async () => {
    const sim = await simulateRegistry(REGISTRY, { driver: nodeDriver(), from: FROM, days: 30, zoneProvider });
    console.log(`# 30 simulated days in ${sim.wallMs} ms (${sim.totals.fired} runs)`);
    assert.equal(sim.days.length, 30);
    for (const day of sim.days) {
      const hours = day.date === '2027-03-28' ? 23 : 24;
      const n = (kind: string) => day.jobs.find(j => j.kind === kind)?.fired ?? 0;
      assert.equal(n('stock.sync'), hours * 2, `${day.date} half-hourly`);
      for (const k of ['stock.readback', 'web.orders', 'sales.push']) assert.equal(n(k), hours * 4, `${day.date} ${k}`);
      assert.equal(n('register.orders'), hours * 12, `${day.date} five-minutely`);
      assert.equal(n('stock.full'), 1, `${day.date} daily 03:00`);
      const monday = new Date(`${day.date}T12:00:00Z`).getUTCDay() === 1;
      assert.equal(n('picklist.weekly'), monday ? 1 : 0, `${day.date} weekly`);
    }
    assert.equal(sim.totals.completed, sim.totals.fired, 'no failure rate: every run completes');
    assert.equal(sim.simulated, true);
  });

  it('with a failure rate, retries safe reads and gives single-sends up without a repeat, the same for the same seed', async () => {
    const registry: JobRegistry = { ...REGISTRY, jobs: REGISTRY.jobs.filter(j => ['stock.sync', 'sales.push'].includes(j.kind)) };
    const run = () => simulateRegistry(registry, { driver: nodeDriver(), from: FROM, days: 1, failRate: 0.2, seed: 7, zoneProvider });
    const [a, b] = [await run(), await run()];
    const day = a.days[0];
    const sync = day.jobs.find(j => j.kind === 'stock.sync')!, push = day.jobs.find(j => j.kind === 'sales.push')!;
    assert.ok(sync.retried > 0, 'a failed safe read is retried');
    assert.equal(push.retried, 0, 'a single-send is never retried');
    assert.ok(push.dead > 0 && push.notRepeated === push.dead, 'a failed single-send is given up, not repeated');
    assert.deepEqual(JSON.stringify(a.days), JSON.stringify(b.days), 'deterministic by seed');
  });

  it('marks a run a spring gap moved and one an autumn fold repeats', async () => {
    const registry: JobRegistry = { $registry: '0.1', name: 'shop', zone: 'Europe/Amsterdam', jobs: [
      { kind: 'night.job', title: { en: 'Night job' }, handler: { contract: 'stock', operation: 'x' }, safety: 'safe-read', schedule: { at: { date: '2027-03-01', time: '02:30' }, rrule: 'FREQ=DAILY' } }] };
    const spring = await simulateRegistry(registry, { driver: nodeDriver(), from: Date.parse('2027-03-27T23:00:00Z'), days: 1, zoneProvider });
    assert.deepEqual(spring.days[0].jobs[0].marks, ['gap']);
    const autumn = await simulateRegistry(registry, { driver: nodeDriver(), from: Date.parse('2027-10-30T22:00:00Z'), days: 1, zoneProvider });
    assert.deepEqual(autumn.days[0].jobs[0].marks, ['fold']);
  });

  it('rebuilds a host\'s registry from what the contract answers, and simulates it the same', async () => {
    assert.equal(ruleText({ FREQ: 'WEEKLY', BYDAY: ['MO', 'TH'] }), 'FREQ=WEEKLY;BYDAY=MO,TH');
    assert.equal(ruleText({ FREQ: 'MONTHLY', BYDAY: [{ n: 1, day: 'MO' }] }), null, 'a part it cannot spell');
    const registered = REGISTRY.jobs.map(j => ({ kind: j.kind, title: j.title, safety: j.safety, scheduled: true, schedule: `ops:shop:${j.kind}` }));
    const schedules = REGISTRY.jobs.map(j => ({ id: `ops:shop:${j.kind}`, series: JSON.parse(JSON.stringify(seriesOf(j.schedule!))), zone: j.schedule!.utc ? null : 'Europe/Amsterdam', policy: j.schedule!.utc ? null : 'rfc5545' }));
    const { registry, left } = registryFromHost(registered, schedules, 'Europe/Amsterdam');
    assert.deepEqual(left, []);
    assert.equal(registry.jobs.length, 7);
    const [a, b] = await Promise.all([
      simulateRegistry(REGISTRY, { driver: nodeDriver(), from: FROM, days: 1, zoneProvider }),
      simulateRegistry(registry, { driver: nodeDriver(), from: FROM, days: 1, zoneProvider }),
    ]);
    assert.deepEqual(b.days.map(d => d.jobs.map(j => [j.kind, j.fired])), a.days.map(d => d.jobs.map(j => [j.kind, j.fired])));
  });
});
