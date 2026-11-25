/**
 * The `job_queue` contract over a real Jaren store, served over HTTP with
 * every answer validated: counts, pages, one job, the schedules, and the
 * person's cancel, requeue and unschedule through Jaren's own fences. A job's
 * payload and result never cross; a running job is cancelled only with this
 * host's lease.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { jobSchedules } from '@jarenjs/db/schedules';
import { compileRecurrence, floatingValue } from '@jarenjs/core/calendar';
import { createRuntime } from '@jarenjs/core/runtime';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { JOB_QUEUE_CONTRACT, JOB_CODES, httpJobQueue, unconfiguredJobQueue, type JobQueue } from '@tangleai/os/jobs';
import { jobQueueProvider, jobQueueHandlers } from '@tangleai/ops';

const MODEL = { $model: '0.1', collections: { notes: { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, key: '/id' } } };
const code = async (call: Promise<unknown>) => { try { await call; return 'ok'; } catch (error: any) { return error.code; } };

let dir = '', store: any, bare: any, worker: any, server: Server, dispatcher: any, queue: JobQueue, release = () => {};
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tangle-ops-'));
  const runtime = createRuntime({ zoneProvider: createIntlZoneProvider({ revision: 'test ICU' }) });
  store = await openStore(MODEL as any, { driver: nodeDriver(), path: join(dir, 'ops.db'), runtime, jobs: { schedules: jobSchedules() } } as any);
  bare = await openStore(MODEL as any, { driver: nodeDriver(), path: join(dir, 'bare.db'), jobs: true } as any);
  await store.jobs.schedule({ id: 'stock', kind: 'stock.sync', series: compileRecurrence({ dtstart: floatingValue('2027-03-01', '03:00'), rrule: 'FREQ=DAILY' }), zone: 'Europe/Amsterdam', zoneSource: 'explicit', missed: 'skip' });
  for (let i = 0; i < 250; i++) await store.jobs.enqueue(i % 2 ? 'mail' : 'push', { customer: 'secret' }, { id: `j-${String(i).padStart(3, '0')}`, runAt: Date.now() + 3_600_000 });
  await store.jobs.enqueue('fail', {}, { id: 'dead-1', maxAttempts: 1 });
  await store.jobs.enqueue('quick', { customer: 'secret' }, { id: 'done-1' });
  await store.jobs.enqueue('hold', {}, { id: 'held-1' });
  await store.jobs.enqueue('hold', {}, { id: 'held-2' });
  const holding = new Promise<void>(r => { release = r; });
  worker = store.jobs.createWorker({ concurrency: 2, pollInterval: 10, leaseMs: 60_000, handlers: {
    fail: async () => { throw new Error('the courier refused the parcel'); },
    quick: async () => ({ invoice: 'secret' }),
    hold: async (_p: unknown, { signal }: any) => { await new Promise<void>(r => { holding.then(r); signal?.addEventListener('abort', () => r()); }); },
  } });
  worker.start();
  for (let i = 0; i < 300; i++) { const c = await store.jobs.counts(); if (c.dead >= 1 && c.done >= 1 && c.leased >= 2) break; await new Promise(r => setTimeout(r, 10)); }
  // the provider sees only one of the two leases: held-2 stands for a job another process runs
  const provider = jobQueueProvider(store, { scope: 'shop', leases: () => worker.leases().filter((l: any) => l.jobId === 'held-1') });
  dispatcher = serveHttp(compileContract(JOB_QUEUE_CONTRACT as any), jobQueueHandlers(provider) as any, { validateOutput: 'always' });
  server = createServer(toNodeHandler(dispatcher));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  queue = httpJobQueue(`http://127.0.0.1:${(server.address() as any).port}`);
});
after(async () => {
  release(); await worker.stop({ graceMs: 1000 });
  server.close(); await dispatcher.close();
  await store.close(); await bare.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the job_queue contract', () => {
  it('counts the jobs in each state and the waiting ones by kind', async () => {
    const counts = await queue.counts();
    assert.equal(counts.pending, 250);
    assert.equal(counts.dead, 1);
    assert.equal(counts.done, 1);
    assert.equal(counts.leased, 2);
    assert.deepEqual(counts.pendingKinds, { mail: 125, push: 125 });
  });

  it('pages the queue by id, filtered by state and kind, and never carries a payload, a result or lease internals', async () => {
    const seen: string[] = [];
    let after: string | undefined;
    for (let call = 0; call < 5; call++) {
      const page = await queue.page({ state: 'pending', limit: 100, ...(after ? { after } : {}) });
      seen.push(...page.items.map(j => j.id));
      for (const item of page.items) for (const hidden of ['payload', 'result', 'leaseOwner', 'leaseGeneration']) assert.equal(hidden in item, false, hidden);
      if (!page.next) break;
      after = page.next;
    }
    assert.equal(seen.length, 250);
    assert.equal(new Set(seen).size, 250);
    assert.equal((await queue.page({ kind: 'mail', limit: 200 })).items.every(j => j.kind === 'mail'), true);
  });

  it('answers one job with its attempts and its last error', async () => {
    const dead = await queue.get({ id: 'dead-1' });
    assert.equal(dead.state, 'dead');
    assert.equal(dead.attempts, 1);
    assert.match(dead.lastError?.message ?? '', /courier refused/);
    assert.equal(await code(queue.get({ id: 'nope' })), JOB_CODES.unknown);
  });

  it('answers the schedules with their rule, zone, state and next run, and none without the schedules seam', async () => {
    const { schedules } = await queue.schedules();
    assert.equal(schedules.length, 1);
    const [stock] = schedules;
    assert.equal(stock.id, 'stock');
    assert.equal(stock.zone, 'Europe/Amsterdam');
    assert.equal(stock.state, 'active');
    assert.equal(typeof stock.nextRunAt, 'number');
    assert.deepEqual((stock.series as any).rrule, { FREQ: 'DAILY' });
    assert.deepEqual(await jobQueueProvider(bare).schedules(), { schedules: [] });
  });

  it('cancels a waiting job, a running one with this host\'s lease, refuses one another process runs, a done job and an unknown one', async () => {
    assert.deepEqual(await queue.cancel({ id: 'j-000' }), { changed: true });
    assert.deepEqual(await queue.cancel({ id: 'j-000' }), { changed: false });
    assert.deepEqual(await queue.cancel({ id: 'held-1' }), { changed: true });
    assert.equal((await queue.get({ id: 'held-1' })).state, 'cancelled');
    assert.equal(await code(queue.cancel({ id: 'held-2' })), JOB_CODES.held);
    assert.equal(await code(queue.cancel({ id: 'done-1' })), JOB_CODES.refused);
    assert.equal(await code(queue.cancel({ id: 'nope' })), JOB_CODES.unknown);
  });

  it('requeues a dead job with its attempts kept, and refuses a done or running one', async () => {
    assert.deepEqual(await queue.requeue({ id: 'j-001' }), { changed: false });
    assert.equal(await code(queue.requeue({ id: 'done-1' })), JOB_CODES.refused);
    assert.equal(await code(queue.requeue({ id: 'held-2' })), JOB_CODES.refused);
    assert.deepEqual(await queue.requeue({ id: 'dead-1' }), { changed: true });
    const again = await queue.get({ id: 'dead-1' });
    assert.ok(['pending', 'leased', 'dead'].includes(again.state));
    assert.ok(again.attempts >= 1);
  });

  it('removes a schedule and keeps the jobs it fired; an unknown one is refused', async () => {
    assert.deepEqual(await queue.unschedule({ id: 'stock' }), { changed: true });
    assert.deepEqual((await queue.schedules()).schedules, []);
    assert.equal(await code(queue.unschedule({ id: 'stock' })), JOB_CODES.unknown);
  });

  it('refuses a scope this host does not serve, and a desktop with no host answers OS0190', async () => {
    assert.equal(await code(queue.counts({ scope: 'labels' })), JOB_CODES.scope);
    assert.equal((await queue.counts({ scope: 'shop' })).pending >= 0, true);
    assert.equal(await code(unconfiguredJobQueue().counts()), JOB_CODES.unconfigured);
    assert.equal(await code(httpJobQueue('http://127.0.0.1:9/').counts()), JOB_CODES.unconfigured);
  });
});
