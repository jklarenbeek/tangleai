/**
 * The operations runtime over a real store with an injected clock: it keeps
 * only its own schedules and rewrites them only when they change, runs a
 * DST day exactly as the parity rules say, never calls a single-send operation
 * twice (a crash dead-letters it, the person's requeue gives one more), spends
 * no more than a budget, writes `started` before the call and every outcome
 * after it, and keeps a heartbeat.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { jobSchedules } from '@jarenjs/db/schedules';
import { compileRecurrence, floatingValue } from '@jarenjs/core/calendar';
import { createRuntime } from '@jarenjs/core/runtime';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { createOpsRuntime, opsEvents, eventId, OPS_EVENTS_COLLECTIONS, type JobRegistry, type OpsContract } from '@tangleai/ops';

const zoneProvider = createIntlZoneProvider({ revision: 'test ICU' });
const MODEL = { $model: '0.1', collections: { ...OPS_EVENTS_COLLECTIONS, notes: { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, key: '/id' } } };
let dir = '';
before(() => { dir = mkdtempSync(join(tmpdir(), 'tangle-ops-runtime-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const open = (name: string, clock: { t: number }) => openStore(MODEL as any, { driver: nodeDriver(), path: join(dir, `${name}.db`), runtime: createRuntime({ zoneProvider, now: () => clock.t }), jobs: { schedules: jobSchedules() } } as any) as Promise<any>;
const until = async (cond: () => Promise<boolean> | boolean, ms = 8000) => { const t = Date.now(); while (!(await cond())) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 2)); } };
const idle = (store: any) => until(async () => { const c = await store.jobs.counts(); return c.pending === 0 && c.leased === 0; });
const fakeContract = () => { const calls: { op: string, key?: string }[] = []; const contract: OpsContract = { async invoke(op, _input, ctx) { calls.push({ op, key: ctx?.idempotencyKey }); return { ok: true, value: {} }; } }; return { calls, contract }; };
const registry = (jobs: JobRegistry['jobs']): JobRegistry => ({ $registry: '0.1', name: 'shop', zone: 'Europe/Amsterdam', jobs });
const SYNC = { kind: 'stock.sync', title: { en: 'Read the stock' }, handler: { contract: 'stock', operation: 'stock.pull' }, safety: 'safe-read' as const, schedule: { utc: '2027-03-27T23:00:00Z', rrule: 'FREQ=MINUTELY;INTERVAL=30' } };
const FULL = { kind: 'stock.full', title: { en: 'Read all stock' }, handler: { contract: 'stock', operation: 'stock.pull-all' }, safety: 'provider-idempotent' as const, schedule: { at: { date: '2027-03-01', time: '03:00' }, rrule: 'FREQ=DAILY' } };

describe('the operations runtime', () => {
  it('keeps only its own schedules, and rewrites one only when the registry changed it', async () => {
    const clock = { t: Date.parse('2027-03-01T00:00:00Z') };
    const store = await open('sync', clock);
    await store.jobs.schedule({ id: 'mine', kind: 'other', series: compileRecurrence({ dtstart: floatingValue('2027-03-01', '04:00'), rrule: 'FREQ=DAILY' }), zone: 'Europe/Amsterdam', zoneSource: 'explicit', missed: 'skip' });
    const { contract } = fakeContract();
    let rt = createOpsRuntime({ store, registry: registry([SYNC, FULL]), contracts: { stock: contract }, now: () => clock.t, worker: { pollInterval: 5 } });
    await rt.start(); await rt.stop();
    const ids = async () => (await store.jobs.schedules()).map((s: any) => s.id).sort();
    assert.deepEqual(await ids(), ['mine', 'ops:shop:stock.full', 'ops:shop:stock.sync']);
    const stamp = (await store.jobs.schedules()).find((s: any) => s.id === 'ops:shop:stock.full').updatedAt;
    clock.t += 60_000;
    rt = createOpsRuntime({ store, registry: registry([SYNC, FULL]), contracts: { stock: contract }, now: () => clock.t, worker: { pollInterval: 5 } });
    await rt.start(); await rt.stop();
    assert.equal((await store.jobs.schedules()).find((s: any) => s.id === 'ops:shop:stock.full').updatedAt, stamp, 'an unchanged registry rewrites nothing');
    rt = createOpsRuntime({ store, registry: registry([SYNC]), contracts: { stock: contract }, now: () => clock.t, worker: { pollInterval: 5 } });
    await rt.start(); await rt.stop();
    assert.deepEqual(await ids(), ['mine', 'ops:shop:stock.sync'], 'a job the registry dropped loses its schedule; another\'s schedule stays');
    await store.close();
  });

  it('runs the spring DST day as the parity rules say: 46 half-hour reads and one 03:00 read, each with its id as the idempotency key where it may repeat', async () => {
    const clock = { t: Date.parse('2027-03-27T22:59:00Z') };
    const store = await open('dst', clock);
    const { calls, contract } = fakeContract();
    const rt = createOpsRuntime({ store, registry: registry([SYNC, FULL]), contracts: { stock: contract }, now: () => clock.t, worker: { pollInterval: 1 } });
    await rt.start();
    const end = Date.parse('2027-03-28T22:00:00Z');   // the 23-hour local day ends at 22:00 UTC
    const step = async () => { const before = rt.health().stats?.ticks ?? 0; await until(() => (rt.health().stats?.ticks ?? 0) >= before + 2); await idle(store); };
    for (clock.t = Date.parse('2027-03-27T23:00:00Z'); clock.t < end; clock.t += 15 * 60_000) await step();
    await idle(store);
    await rt.stop();
    assert.equal(calls.filter(c => c.op === 'stock.pull').length, 46);
    const full = calls.filter(c => c.op === 'stock.pull-all');
    assert.equal(full.length, 1);
    assert.match(full[0].key ?? '', /^run:shop:stock\.full@/);
    assert.equal(calls.filter(c => c.op === 'stock.pull').every(c => c.key === undefined), true, 'a safe read carries no key');
    await store.close();
  });

  it('never calls a single-send operation twice: a crash dead-letters it, the person\'s requeue gives exactly one more', async () => {
    const clock = { t: Date.parse('2027-03-01T08:00:00Z') };
    const store = await open('single', clock);
    let calls = 0, hang = true;
    const contract: OpsContract = { invoke: async () => { calls++; if (hang) await new Promise(() => {}); return { ok: true, value: {} }; } };
    const PUSH = { kind: 'sales.push', title: { en: 'Send the sales' }, handler: { contract: 'stock', operation: 'sales.post' }, safety: 'single-send' as const, limits: { leaseMs: 1000 } };
    const first = createOpsRuntime({ store, registry: registry([PUSH]), contracts: { stock: contract }, now: () => clock.t, worker: { pollInterval: 1, leaseMs: 1000 } });
    await first.start();
    const { id } = await first.runNow('sales.push');
    await until(() => calls === 1);
    await first.stop({ graceMs: 10 });   // the process "dies" mid-call
    clock.t += 5_000;                     // the lease runs out
    hang = false;
    const second = createOpsRuntime({ store, registry: registry([PUSH]), contracts: { stock: contract }, now: () => clock.t, worker: { pollInterval: 1, leaseMs: 1000 } });
    await second.start();
    await until(async () => (await store.jobs.get(id))?.state === 'dead');
    assert.equal(calls, 1, 'the operation was not called again');
    const history = (await opsEvents(store).ofJob(id)).map(e => e.event);
    assert.deepEqual(history.filter(e => e !== 'started'), ['lost', 'not-repeated']);
    await store.jobs.requeue(id);
    await until(async () => (await store.jobs.get(id))?.state === 'done');
    assert.equal(calls, 2, 'the person\'s requeue gave exactly one more call');
    await second.stop();
    await store.close();
  });

  it('refuses to run a kind now while one waits, and spends no more than its budget', async () => {
    const clock = { t: Date.parse('2027-03-01T08:00:00Z') };
    const store = await open('budget', clock);
    let calls = 0;
    const NOTE = { kind: 'note.send', title: { en: 'Send a note' }, handler: { code: 'note' }, safety: 'provider-idempotent' as const, budget: { runsPerDay: 2 } };
    const rt = createOpsRuntime({ store, registry: registry([NOTE]), handlers: { note: async () => { calls++; } }, now: () => clock.t, worker: { pollInterval: 50 } });
    await store.jobs.enqueue('note.send', {}, { id: 'waiting' });
    await assert.rejects(rt.runNow('note.send'), { code: 'OS0192' });
    await assert.rejects(rt.runNow('nothing'), { code: 'OS0191' });
    await rt.start();
    await idle(store);
    clock.t += 1000; await rt.runNow('note.send'); await idle(store);
    clock.t += 1000; const { id } = await rt.runNow('note.send'); await idle(store);
    assert.equal(calls, 2);
    assert.deepEqual((await opsEvents(store).ofJob(id)).map(e => e.event), ['budget']);
    clock.t += 86_400_000; await rt.runNow('note.send'); await idle(store);
    assert.equal(calls, 3, 'a new day has a new budget');
    await rt.stop();
    await store.close();
  });

  it('commits started before the call, writes each outcome with its duration and no payload, and keeps a heartbeat', async () => {
    const clock = { t: Date.parse('2027-03-01T08:00:00Z') };
    const store = await open('history', clock);
    const seen: boolean[] = [];
    const rt = createOpsRuntime({ store, registry: registry([{ kind: 'mail.digest', title: { en: 'Mail the digest' }, handler: { code: 'digest' }, safety: 'safe-read', payload: { customer: 'secret' } },
      { kind: 'mail.fail', title: { en: 'Fail' }, handler: { code: 'fail' }, safety: 'safe-read', limits: { maxAttempts: 1 } }]),
      handlers: {
        digest: async (_p, { job }) => { seen.push(!!(await opsEvents(store).get(eventId(job.id, job.attempts, 'started')))); clock.t += 250; },
        fail: async () => { throw new Error('the courier refused the parcel'); },
      }, id: 'shop@test', now: () => clock.t, heartbeatMs: 20, worker: { pollInterval: 1 } });
    await rt.start();
    const ok = await rt.runNow('mail.digest'), bad = await rt.runNow('mail.fail');
    await idle(store);
    const beat1 = (await opsEvents(store).get('heartbeat:shop@test'))?.at;
    clock.t += 5_000;
    await until(async () => (await opsEvents(store).get('heartbeat:shop@test'))?.at !== beat1);
    await rt.stop();
    assert.deepEqual(seen, [true], 'the handler found its started event already written');
    const good = await opsEvents(store).ofJob(ok.id);
    assert.deepEqual(good.map(e => e.event), ['started', 'completed']);
    assert.equal(good[1].durationMs, 250);
    const failed = await opsEvents(store).ofJob(bad.id);
    assert.deepEqual(failed.map(e => e.event), ['started', 'failed']);
    assert.match(failed[1].message ?? failed[1].code ?? '', /courier|failed/);
    for (const e of [...good, ...failed]) assert.equal('payload' in e || 'result' in e, false);
    const beat = await opsEvents(store).get('heartbeat:shop@test');
    assert.equal(beat.runtime, 'shop@test');
    assert.equal(typeof beat.stats.claims, 'number');
    await store.close();
  });
});
