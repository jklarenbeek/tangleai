/**
 * The operations runtime in a browser (`@tangleai/ops/browser`), measured on
 * its own harness (`test/fixtures/ops-twin`): a safe read and a single-send
 * page task, each fired every second, in a dedicated worker that owns the
 * store by a Web Lock. Every tab reads the queue over one BroadcastChannel.
 *
 * Measured: reloads and owner-tab closes lose and double nothing — no
 * single-send task is called twice, every takeover keeps the same durable
 * store; two tabs' concurrent requests never cross; and a frozen owner tab
 * (Chromium) hands over, because the page ends its worker on `freeze`. The
 * DevTools freeze command does not fire the document's `freeze` event a real
 * browser fires first (measured), so the spec dispatches it, then freezes.
 */
import { test, expect } from './playwright.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
let server, origin;
test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), 'tangle-ops-twin-'));
  const bun = process.env.BUN ?? 'bun';
  for (const name of ['page', 'worker'])
    execFileSync(bun, ['build', join(repo, `test/fixtures/ops-twin/${name}.ts`), '--target=browser', '--format=esm', `--outfile=${join(out, `${name}.js`)}`], { stdio: 'inherit' });
  copyFileSync(join(repo, 'test/fixtures/ops-twin/index.html'), join(out, 'index.html'));
  copyFileSync(join(repo, 'node_modules/@sqlite.org/sqlite-wasm/dist/sqlite3.wasm'), join(out, 'sqlite3.wasm'));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm' };
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
    let body;
    try { body = readFileSync(join(out, path)); } catch { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' }); response.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server?.close());

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/** Wait until this page's worker reports `want`; answers the state and how long it took. */
async function state(page, want, ms = 20_000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const s = await Promise.race([page.evaluate(() => window.lastState?.()), sleep(1000).then(() => null)]).catch(() => null);
    if (s?.ops === want) return { ...s, ms: Date.now() - t };
    if (s?.ops === 'error') throw new Error(`the worker failed: ${s.message}`);
    await sleep(50);
  }
  return null;
}

test('reloads lose and double nothing: no single-send task is called twice and every fired job has its history', async ({ browser }, info) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  const first = await state(page, 'owner');
  expect(first?.storage).toBe('opfs-sahpool');
  await sleep(3000);
  for (let n = 0; n < 10; n++) {
    await page.reload();
    const owner = await state(page, 'owner');
    expect(owner?.storage, `reload ${n}`).toBe('opfs-sahpool');
    await sleep(1000 + Math.random() * 1000);
  }
  await sleep(3000);
  const tally = await page.evaluate(() => window.tally());
  info.annotations.push({ type: 'reloads', description: JSON.stringify({ pings: tally.pings, reads: tally.reads, pingCalls: tally.pingCalls, pingsCalledTwice: tally.pingsCalledTwice, states: tally.pingStates, history: tally.sampledWithHistory }) });
  expect(tally.pings).toBeGreaterThan(10);
  expect(tally.pingIdsDistinct).toBe(tally.pings);
  expect(tally.pingsCalledTwice).toBe(0);
  expect(tally.pingCalls).toBeLessThanOrEqual(tally.pings);
  const [withHistory, sampled] = tally.sampledWithHistory.split('/').map(Number);
  expect(withHistory).toBe(sampled);
  await context.close();
});

test('closing the owner tab 20 times hands the runtime to a waiting tab on the same durable store, calling nothing twice', async ({ browser }, info) => {
  const context = await browser.newContext();
  let owner = await context.newPage();
  await owner.goto(origin);
  expect((await state(owner, 'owner'))?.storage).toBe('opfs-sahpool');
  let standby = await context.newPage();
  await standby.goto(origin);
  expect(await state(standby, 'waiting')).not.toBeNull();
  const takeovers = [], modes = new Set();
  for (let n = 0; n < 20; n++) {
    await sleep(800 + Math.random() * 1200);
    await owner.close();
    const next = await state(standby, 'owner', 20_000);
    expect(next, `takeover ${n}`).not.toBeNull();
    takeovers.push(next.ms); modes.add(next.storage);
    owner = standby;
    standby = await context.newPage();
    await standby.goto(origin);
    await state(standby, 'waiting');
  }
  await sleep(3000);
  const tally = await owner.evaluate(() => window.tally());
  takeovers.sort((a, b) => a - b);
  info.annotations.push({ type: 'handover', description: JSON.stringify({ closes: 20, takeoverMsP50: takeovers[10], takeoverMsMax: takeovers.at(-1), modes: [...modes], pings: tally.pings, pingCalls: tally.pingCalls, pingsCalledTwice: tally.pingsCalledTwice, states: tally.pingStates }) });
  expect([...modes]).toEqual(['opfs-sahpool']);
  expect(tally.pingsCalledTwice).toBe(0);
  expect(tally.health.runtimes[0].owner).toBeTruthy();
  await context.close();
});

test('two tabs\' 100 concurrent requests on one channel each get their own answer', async ({ browser }, info) => {
  const context = await browser.newContext();
  const a = await context.newPage(), b = await context.newPage();
  await a.goto(origin); await state(a, 'owner');
  await b.goto(origin); await state(b, 'waiting');
  const burst = (page) => page.evaluate(async () => {
    const asks = Array.from({ length: 50 }, (_, i) => i % 2
      ? window.queue.counts().then(r => typeof r.pending === 'number' && !('items' in r))
      : window.queue.page({ limit: 5 }).then(r => Array.isArray(r.items) && !('pending' in r)));
    const answers = await Promise.all(asks);
    return answers.filter(ok => !ok).length;
  });
  const [crossedA, crossedB] = await Promise.all([burst(a), burst(b)]);
  info.annotations.push({ type: 'concurrency', description: JSON.stringify({ requests: 100, crossed: crossedA + crossedB }) });
  expect(crossedA + crossedB).toBe(0);
  await context.close();
});

test('a frozen owner tab hands the runtime over: the page ends its worker on the freeze event', async ({ browser, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'freezing a page is a Chromium DevTools command');
  const context = await browser.newContext();
  const a = await context.newPage(), b = await context.newPage();
  await a.goto(origin); await state(a, 'owner');
  await b.goto(origin); await state(b, 'waiting');
  const cdp = await context.newCDPSession(a);
  // a browser fires `freeze` on the document before it freezes a page; the DevTools command does not, so fire it here
  await a.evaluate(() => document.dispatchEvent(new Event('freeze')));
  await Promise.race([cdp.send('Page.setWebLifecycleState', { state: 'frozen' }), sleep(5000)]);
  const taken = await state(b, 'owner', 5000);
  info.annotations.push({ type: 'frozen', description: JSON.stringify({ tookOverMs: taken?.ms ?? null, storage: taken?.storage ?? null }) });
  expect(taken, 'the waiting tab took over within 5 s').not.toBeNull();
  expect(taken.storage).toBe('opfs-sahpool');
  await Promise.race([cdp.send('Page.setWebLifecycleState', { state: 'active' }), sleep(5000)]);
  await context.close();
});
