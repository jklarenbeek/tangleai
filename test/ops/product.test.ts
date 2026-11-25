/**
 * Products bring their background work: each product's runtime runs in the product's process on the product's own
 * store, and serves its queue at its own address. Two products in one process, with a kind of the same name, never
 * answer for each other; one product's failing handler leaves the other's runs and heartbeat going; a single-send job
 * in each is called at most once when its runtime is replaced inside a lease.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '@jarenjs/db';
import { nodeDriver } from '@jarenjs/db/node';
import { jobSchedules } from '@jarenjs/db/schedules';
import { createRuntime } from '@jarenjs/core/runtime';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { combinedJobQueue, httpJobQueue, JOB_CODES } from '@tangleai/os/jobs';
import { createOpsRuntime, opsEvents, OPS_EVENTS_COLLECTIONS, type JobRegistry, type OpsContract } from '@tangleai/ops';
import { productJobs } from '@tangleai/ops/product';

const zoneProvider = createIntlZoneProvider({ revision: 'test ICU' });
const MODEL = { $model: '0.1', collections: { ...OPS_EVENTS_COLLECTIONS, orders: { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, key: '/id' } } };
let dir = '';
before(() => { dir = mkdtempSync(join(tmpdir(), 'tangle-ops-product-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const open = (name: string, clock?: { t: number }) => openStore(MODEL as any, { driver: nodeDriver(), path: join(dir, `${name}.db`), runtime: createRuntime({ zoneProvider, ...(clock ? { now: () => clock.t } : {}) }), jobs: { schedules: jobSchedules() } } as any) as Promise<any>;
const until = async (cond: () => Promise<boolean> | boolean, ms = 10_000) => { const t = Date.now(); while (!(await cond())) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise(r => setTimeout(r, 5)); } };
const code = async (call: Promise<unknown>) => { try { await call; return 'ok'; } catch (error: any) { return error.code; } };
const midnight = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); };
const registry = (name: string): JobRegistry => ({
  $registry: '0.1', name, jobs: [
    { kind: 'sync.pull', title: { en: 'Pull' }, handler: { code: 'pull' }, safety: 'safe-read', limits: { maxAttempts: 1 }, schedule: { utc: midnight(), rrule: 'FREQ=SECONDLY' } },
    { kind: 'orders.push', title: { en: 'Push' }, handler: { code: 'push' }, safety: 'single-send' },
  ],
});

describe('product jobs', () => {
  let server: Server, base = '', alpha: any, beta: any, stores: any[] = [];
  const runs = { alpha: [] as number[], beta: [] as number[] };
  let alphaThrows = 0;
  before(async () => {
    stores = [await open('alpha'), await open('beta')];
    alpha = productJobs({ scope: 'alpha', title: { en: 'Alpha' }, store: stores[0], registry: registry('alpha'), handlers: {
      pull: async () => { alphaThrows++; throw new Error('the supplier did not answer'); },
      push: async () => {},
    } });
    beta = productJobs({ scope: 'beta', title: { en: 'Beta' }, store: stores[1], registry: registry('beta'), handlers: {
      pull: async () => { runs.beta.push(Date.now()); },
      push: async () => {},
    } });
    server = createServer((req, res) => { if (alpha.handle(req, res) || beta.handle(req, res)) return; res.writeHead(404); res.end(); });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  after(async () => { await alpha.stop(); await beta.stop(); server.close(); for (const s of stores) await s.close(); });

  it('serves each product\'s queue at its own address and nowhere else', () => {
    assert.equal(alpha.path, '/alpha/api/job-queue');
    assert.equal(beta.path, '/beta/api/job-queue');
    assert.throws(() => productJobs({ scope: 'Not A Scope', title: { en: 'x' }, store: stores[0], registry: registry('x') }), TypeError);
  });

  it('keeps one product\'s failing handler from stopping the other\'s runs and heartbeat', async (t) => {
    await alpha.start(); await beta.start();
    const started = Date.now();
    await until(() => alphaThrows >= 5 && runs.beta.length >= 5, 15_000);
    const window = runs.beta.filter(t => t >= started);
    const gaps = window.slice(1).map((t, i) => t - window[i]);
    t.diagnostic(`alpha failed ${alphaThrows} times; beta ran ${window.length} times, largest gap ${Math.max(...gaps)} ms`);
    assert.ok(Math.max(...gaps) < 2_500, `the other product ran every second (largest gap ${Math.max(...gaps)} ms)`);
    assert.ok(await opsEvents(stores[1]).get('heartbeat:beta@product'), 'the other product wrote its heartbeat');
    const ticks = beta.runtime.health().stats.ticks;
    await until(() => beta.runtime.health().stats.ticks > ticks + 3);
    assert.equal(beta.runtime.health().running, true, 'the other product\'s runtime keeps running and ticking');
    assert.ok(alpha.runtime.health().running, 'the failing product\'s runtime itself keeps running');
  });

  it('routes every call by scope through one combined queue, never answering one product\'s job for the other', async () => {
    const queue = combinedJobQueue([
      { scope: 'alpha', title: { en: 'Alpha' }, queue: httpJobQueue(`${base}${alpha.path}`) },
      { scope: 'beta', title: { en: 'Beta' }, queue: httpJobQueue(`${base}${beta.path}`) },
    ]);
    assert.deepEqual(queue.scopes(), [{ scope: 'alpha', title: { en: 'Alpha' } }, { scope: 'beta', title: { en: 'Beta' } }]);
    const a = await queue.run({ scope: 'alpha', kind: 'orders.push' }), b = await queue.run({ scope: 'beta', kind: 'orders.push' });
    assert.match(a.id, /^run:alpha:orders\.push@/);
    assert.match(b.id, /^run:beta:orders\.push@/);
    assert.equal(await code(queue.get({ scope: 'alpha', id: b.id })), JOB_CODES.unknown, 'beta\'s job is not alpha\'s');
    assert.equal(await code(queue.get({ scope: 'beta', id: a.id })), JOB_CODES.unknown, 'alpha\'s job is not beta\'s');
    const alphaIds = (await queue.page({ scope: 'alpha', limit: 200 })).items.map(j => j.id);
    assert.equal(alphaIds.some(id => id.startsWith('run:beta:') || id.startsWith('ops:beta:')), false);
    assert.equal((await queue.schedules({ scope: 'beta' })).schedules.every(s => s.id.startsWith('ops:beta:')), true);
    assert.equal(await code(queue.counts()), JOB_CODES.scope, 'two scopes: a call must say which');
    assert.equal(await code(queue.counts({ scope: 'gamma' })), JOB_CODES.scope);
    const single = combinedJobQueue([{ scope: 'beta', title: { en: 'Beta' }, queue: httpJobQueue(`${base}${beta.path}`) }]);
    assert.equal(typeof (await single.counts()).pending, 'number', 'one scope: the scope is optional');
  });
});

describe('a single-send job in each product, its runtime replaced inside a lease', () => {
  for (const scope of ['alpha', 'beta']) {
    it(`${scope}: the operation is called once; the lost attempt is recorded and not repeated`, async () => {
      const clock = { t: Date.parse('2027-03-01T08:00:00Z') };
      const store = await open(`${scope}-single`, clock);
      let calls = 0;
      const contract: OpsContract = { invoke: async () => { calls++; await new Promise(() => {}); return {}; } };
      const reg: JobRegistry = { $registry: '0.1', name: scope, jobs: [{ kind: 'orders.push', title: { en: 'Push' }, handler: { contract: 'shop', operation: 'orders.post' }, safety: 'single-send', limits: { leaseMs: 30_000 } }] };
      const first = productJobs({ scope, title: { en: scope }, store, registry: reg, contracts: { shop: contract }, now: () => clock.t });
      await first.start();
      const { id } = await first.runtime.runNow('orders.push');
      await until(() => calls === 1);
      await first.runtime.stop({ graceMs: 10 });
      clock.t += 200;   // replaced inside the lease
      const second = createOpsRuntime({ store, registry: reg, contracts: { shop: contract }, now: () => clock.t, heartbeatMs: 20, worker: { pollInterval: 1, leaseMs: 30_000 }, id: `${scope}@product` });
      await second.start();
      clock.t += 31_000;   // the lease runs out
      await until(async () => (await opsEvents(store).ofJob(id)).some(e => e.event === 'not-repeated'));
      assert.equal(calls, 1);
      assert.equal((await store.jobs.get(id))?.state, 'dead');
      await second.stop({ graceMs: 10 });
      await store.close();
    });
  }
});
