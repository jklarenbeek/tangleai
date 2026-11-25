/**
 * The job_queue contract over a running operations runtime, served over HTTP
 * with every answer validated: the attempts it recorded, its heartbeat, its
 * registry, Run now (refused while a job of that kind waits), and a registry
 * schedule the desktop cannot remove. Without a runtime or a history the
 * answers are empty and Run now knows no job.
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
import { createRuntime } from '@jarenjs/core/runtime';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { JOB_QUEUE_CONTRACT, JOB_CODES, httpJobQueue, type JobQueue } from '@tangleai/os/jobs';
import { createOpsRuntime, jobQueueProvider, jobQueueHandlers, OPS_EVENTS_COLLECTIONS, type JobRegistry, type OpsRuntime } from '@tangleai/ops';

const zoneProvider = createIntlZoneProvider({ revision: 'test ICU' });
const code = async (call: Promise<unknown>) => { try { await call; return 'ok'; } catch (error: any) { return error.code; } };
const until = async (cond: () => Promise<boolean> | boolean, ms = 8000) => { const t = Date.now(); while (!(await cond())) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 2)); } };
const REGISTRY: JobRegistry = {
  $registry: '0.1', name: 'shop', zone: 'Europe/Amsterdam',
  jobs: [
    { kind: 'stock.full', title: { en: 'Read all stock', nl: 'Alle voorraad lezen' }, handler: { code: 'full' }, safety: 'safe-read', schedule: { at: { date: '2027-03-01', time: '03:00' }, rrule: 'FREQ=DAILY' } },
    { kind: 'sales.push', title: { en: 'Send the sales' }, handler: { code: 'push' }, safety: 'single-send', owner: 'warehouse' },
  ],
};
const serve = async (provider: JobQueue) => {
  const dispatcher = serveHttp(compileContract(JOB_QUEUE_CONTRACT as any), jobQueueHandlers(provider) as any, { validateOutput: 'always' });
  const server = createServer(toNodeHandler(dispatcher));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  return { queue: httpJobQueue(`http://127.0.0.1:${(server.address() as any).port}`), close: async () => { server.close(); await dispatcher.close(); } };
};

let dir = '', clock = { t: Date.parse('2027-03-01T08:00:00Z') }, store: any, bare: any, runtime: OpsRuntime, served: Awaited<ReturnType<typeof serve>>, plain: Awaited<ReturnType<typeof serve>>;
let release = () => {};
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tangle-ops-provider-'));
  const model = { $model: '0.1', collections: { ...OPS_EVENTS_COLLECTIONS } };
  store = await openStore(model as any, { driver: nodeDriver(), path: join(dir, 'ops.db'), runtime: createRuntime({ zoneProvider, now: () => clock.t }), jobs: { schedules: jobSchedules() } } as any);
  bare = await openStore({ $model: '0.1', collections: { notes: { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, key: '/id' } } } as any, { driver: nodeDriver(), path: join(dir, 'bare.db'), jobs: true } as any);
  const hold = new Promise<void>(r => { release = r; });
  runtime = createOpsRuntime({ store, registry: REGISTRY, id: 'shop@test', now: () => clock.t, heartbeatMs: 20, worker: { pollInterval: 2 },
    handlers: { full: async () => {}, push: async () => { await hold; } } });
  await runtime.start();
  served = await serve(jobQueueProvider(store, { runtime }));
  plain = await serve(jobQueueProvider(bare));
});
after(async () => {
  release(); await runtime.stop({ graceMs: 500 });
  await served.close(); await plain.close();
  await store.close(); await bare.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('the job_queue contract over a running runtime', () => {
  it('answers the registry: titles, how safe each job is to repeat, and the registry schedule\'s id', async () => {
    const { jobs } = await served.queue.registry();
    assert.deepEqual(jobs.map(j => [j.kind, j.safety, j.scheduled, j.schedule ?? null, j.owner ?? null]), [
      ['stock.full', 'safe-read', true, 'ops:shop:stock.full', null],
      ['sales.push', 'single-send', false, null, 'warehouse'],
    ]);
    assert.equal(jobs[0].title.nl, 'Alle voorraad lezen');
  });

  it('runs a registered job now, refuses a second while one waits or runs, and knows no other kind', async () => {
    const { id } = await served.queue.run({ kind: 'sales.push' });
    assert.match(id, /^run:shop:sales\.push@now-/);
    assert.equal(await code(served.queue.run({ kind: 'sales.push' })), JOB_CODES.refused);
    assert.equal(await code(served.queue.run({ kind: 'nothing' })), JOB_CODES.unknown);
    await until(async () => (await served.queue.events({ jobId: id })).events.some(e => e.event === 'started'));
    release();
    await until(async () => (await served.queue.events({ jobId: id })).events.some(e => e.event === 'completed'));
    const { events } = await served.queue.events({ jobId: id });
    assert.deepEqual(events.map(e => e.event), ['completed', 'started'], 'newest first');
    assert.equal(events.every(e => !('payload' in e) && !('stats' in e)), true);
    assert.deepEqual((await served.queue.events({ kind: 'stock.full' })).events, []);
  });

  it('answers the heartbeat with the host\'s time', async () => {
    const health = await served.queue.health();
    assert.equal(health.now, clock.t);
    assert.equal(health.runtimes.length, 1);
    assert.equal(health.runtimes[0].runtime, 'shop@test');
    assert.equal(typeof health.runtimes[0].stats.claims, 'number');
  });

  it('refuses to remove a schedule the host\'s registry set', async () => {
    assert.equal(await code(served.queue.unschedule({ id: 'ops:shop:stock.full' })), JOB_CODES.refused);
    assert.equal((await served.queue.schedules()).schedules.some(s => s.id === 'ops:shop:stock.full'), true);
  });

  it('answers empty without a runtime or a history, and Run now knows no job', async () => {
    assert.deepEqual(await plain.queue.registry(), { jobs: [] });
    assert.deepEqual(await plain.queue.events({}), { events: [] });
    assert.deepEqual((await plain.queue.health()).runtimes, []);
    assert.equal(await code(plain.queue.run({ kind: 'sales.push' })), JOB_CODES.unknown);
  });
});

describe('a runtime whose store was started fresh', () => {
  it('says when in its heartbeat, and the health answer carries it', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { openStore } = await import('@jarenjs/db');
    const { nodeDriver } = await import('@jarenjs/db/node');
    const { jobSchedules } = await import('@jarenjs/db/schedules');
    const { createOpsRuntime, jobQueueProvider, OPS_EVENTS_COLLECTIONS } = await import('@tangleai/ops');
    const dir = mkdtempSync(join(tmpdir(), 'tangle-ops-recovered-'));
    const store: any = await openStore({ $model: '0.1', collections: { ...OPS_EVENTS_COLLECTIONS } } as any, { driver: nodeDriver(), path: join(dir, 'r.db'), jobs: { schedules: jobSchedules() } } as any);
    const runtime = createOpsRuntime({ store, registry: { $registry: '0.1', name: 'twin', jobs: [] }, id: 'twin@browser', about: { storage: 'opfs-sahpool', recovered: '2027-03-01T08:00:00.000Z' }, worker: { pollInterval: 50 } });
    await runtime.start();
    const health = await jobQueueProvider(store, { runtime }).health();
    await runtime.stop(); await store.close(); rmSync(dir, { recursive: true, force: true });
    assert.equal(health.runtimes[0].recovered, '2027-03-01T08:00:00.000Z');
    assert.equal(health.runtimes[0].storage, 'opfs-sahpool');
  });
});
