// A product's server installed from the packed tarballs: it starts its background work on its own store
// (`@tangleai/ops/product`), serves its queue at its own address, and a desktop reads it through one combined queue.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '@jarenjs/db';
import { jobSchedules } from '@jarenjs/db/schedules';
import { checkRegistry, OPS_EVENTS_COLLECTIONS, opsEvents } from '@tangleai/ops';
import { productJobs } from '@tangleai/ops/product';
import { combinedJobQueue, httpJobQueue } from '@tangleai/os/jobs';

const { nodeDriver } = process.versions.bun ? {} : await import('@jarenjs/db/node');
const { bunDriver } = process.versions.bun ? await import('@jarenjs/db/bun') : {};
const directory = mkdtempSync(join(tmpdir(), 'tangle-ops-consumer-'));
const store = await openStore({ $model: '0.1', collections: { ...OPS_EVENTS_COLLECTIONS } },
  { driver: process.versions.bun ? bunDriver() : nodeDriver(), path: join(directory, 'product.db'), jobs: { schedules: jobSchedules() } });
const checked = checkRegistry({ $registry: '0.1', name: 'store-a', jobs: [{ kind: 'note.write', title: { en: 'Write a note' }, handler: { code: 'note' }, safety: 'safe-read' }] });
assert.equal(checked.ok, true, 'the registry is one the runtime can run');
let notes = 0;
const jobs = productJobs({ scope: 'store-a', title: { en: 'Store A' }, store, registry: checked.registry, handlers: { note: async () => { notes++; } } });
const server = createServer((req, res) => { if (!jobs.handle(req, res)) { res.writeHead(404); res.end(); } });
try {
  await jobs.start();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const queue = combinedJobQueue([{ scope: 'store-a', title: { en: 'Store A' }, queue: httpJobQueue(`http://127.0.0.1:${server.address().port}${jobs.path}`) }]);
  const { id } = await queue.run({ scope: 'store-a', kind: 'note.write' });
  for (let i = 0; i < 400 && (await queue.get({ scope: 'store-a', id })).state !== 'done'; i++) await new Promise(r => setTimeout(r, 25));
  assert.equal((await queue.get({ scope: 'store-a', id })).state, 'done');
  assert.equal(notes, 1);
  assert.deepEqual((await opsEvents(store).ofJob(id)).map(e => e.event), ['started', 'completed']);
  assert.deepEqual((await queue.registry()).jobs.map(j => j.kind), ['note.write']);
  console.log(JSON.stringify({ ok: true, runtime: process.versions.bun ? 'bun' : 'node', productJobs: 'served' }));
} finally {
  server.close(); await jobs.stop(); await store.close();
  rmSync(directory, { recursive: true, force: true });
}
