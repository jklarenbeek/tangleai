/**
 * The desktop app serves its own store's job queue at /api/job-queue to the
 * pages the web reader admits (its own, loopback pages, the published
 * desktop), with the private-network preflight; any other origin is refused
 * before the queue is read. This process holds no lease, so a running job is
 * held by another process. With a supervised runtime the route serves two
 * scopes: `ops` (the runtime's queue, steered where its leases live) and
 * `desktop` (the store's own).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { nodeDriver } from '@jarenjs/db/node';
import { httpJobQueue } from '@tangleai/os/jobs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { superviseOps } from '@tangleai/ops/supervisor';
import { desktopJobRoute, JOB_QUEUE_PATH } from '../../apps/desktop/src/job-queue.ts';
import { createDesktop } from '../../apps/desktop/src/server.ts';

let desktop: any, route: any, server: Server, base = '';
before(async () => {
  desktop = await createDesktop({ driver: nodeDriver() });
  for (let i = 0; i < 3; i++) await desktop.db.jobs.enqueue('report', { secret: true }, { id: `r-${i}`, runAt: Date.now() + 60_000 });
  route = desktopJobRoute(desktop.db);
  server = createServer((req, res) => (req.url ?? '').startsWith(JOB_QUEUE_PATH) ? route(req, res) : (res.writeHead(404), res.end()));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as any).port}${JOB_QUEUE_PATH}`;
});
after(async () => { server.close(); await route.close(); await desktop.close(); });

describe('the desktop\'s job queue route', () => {
  it('answers the store\'s queue through the contract, without payloads, and no schedules without the seam', async () => {
    const queue = httpJobQueue(base);
    const counts = await queue.counts();
    assert.equal(counts.pending, 3);
    assert.deepEqual(counts.pendingKinds, { report: 3 });
    const page = await queue.page({ limit: 10 });
    assert.deepEqual(page.items.map(j => j.id), ['r-0', 'r-1', 'r-2']);
    assert.equal('payload' in page.items[0], false);
    assert.deepEqual(await queue.schedules(), { schedules: [] });
    assert.deepEqual(await queue.cancel({ id: 'r-2' }), { changed: true });
  });

  it('admits the published desktop with the private-network preflight, and loopback pages', async () => {
    const preflight = await fetch(`${base}/jobs.counts`, { method: 'OPTIONS', headers: { origin: 'https://jklarenbeek.github.io', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://jklarenbeek.github.io');
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    const admitted = await fetch(`${base}/jobs.counts`, { method: 'POST', headers: { origin: 'http://127.0.0.1:4745', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(admitted.status, 200);
    assert.equal(admitted.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4745');
  });

  it('refuses any other origin before the queue is read', async () => {
    const refused = await fetch(`${base}/jobs.counts`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(refused.status, 403);
    assert.equal(refused.headers.get('access-control-allow-origin'), null);
    assert.match(await refused.text(), /may not read the job queue/);
  });
});

describe('the route with a supervised runtime', () => {
  it('serves the runtime as the default scope and the store as `desktop`, refuses another scope, and cancels a running job where its lease lives', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tangle-desktop-ops-'));
    writeFileSync(join(dir, 'side.log'), '');
    const ops = superviseOps({ workerUrl: new URL('../ops/fixtures/supervisor-worker.ts', import.meta.url), workerData: { storePath: join(dir, 'ops.db'), side: join(dir, 'side.log'), heartbeatMs: 500 }, restart: { minMs: 100, maxMs: 500 } });
    const scoped = desktopJobRoute(desktop.db, { runtime: ops.queue() });
    const srv = createServer((req, res) => scoped(req, res));
    await new Promise<void>(done => srv.listen(0, '127.0.0.1', done));
    try {
      const queue = httpJobQueue(`http://127.0.0.1:${(srv.address() as any).port}${JOB_QUEUE_PATH}`);
      const until = async (cond: () => Promise<boolean>) => { const t = Date.now(); while (!(await cond().catch(() => false))) { if (Date.now() - t > 15_000) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); } };
      await until(async () => (await queue.health()).runtimes.length > 0);
      assert.deepEqual((await queue.registry()).jobs.map(j => j.kind), ['push.send', 'crash', 'hold']);
      assert.equal((await queue.counts({ scope: 'desktop' })).pendingKinds.report >= 1, true);
      await assert.rejects(queue.counts({ scope: 'labels' }), { code: 'OS0194' });
      const { id } = await queue.run({ kind: 'hold' });
      await until(async () => (await queue.get({ id })).state === 'leased');
      assert.deepEqual(await queue.cancel({ id }), { changed: true });
      assert.equal((await queue.get({ id })).state, 'cancelled');
    } finally {
      srv.close(); await scoped.close(); await ops.stop(); rmSync(dir, { recursive: true, force: true });
    }
  });
});
