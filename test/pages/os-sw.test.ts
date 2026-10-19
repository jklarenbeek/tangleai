/**
 * The Radiant OS service worker (Pages, Tangle edition), proven in Node:
 * the worker source, its types stripped, runs in a vm sandbox against a
 * fake cache and fetch. An OS installed once must boot with no network
 * at all; the build's unhashed files are served network-first so a new
 * release is never pinned behind a cache; nothing that failed is cached;
 * and the worker retires only its own caches — the Jaren edition's
 * worker shares the origin.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const SOURCE = stripTypeScriptTypes(readFileSync(new URL('../../apps/pages/src/os/sw.ts', import.meta.url), 'utf8'));
const SCOPE = 'https://host/tangleai/os/';
const BUILT = ['app.js', 'db-worker.js', 'os.css', 'sqlite3.wasm', 'sqlite3-opfs-async-proxy.js'];

const keyUrl = (k: any) => (typeof k === 'string' ? k : k.url);
const response = (body: any, ok: boolean) => ({ ok, status: ok ? 200 : 404, body, clone() { return { ...this }; }, json: () => Promise.resolve(body) });

function bootSw(fetchImpl: (request: any) => Promise<any>, cacheKeys: string[] = []) {
  const listeners = new Map<string, Function>();
  const store = new Map<string, any>();
  const puts: string[] = [];
  const deleted: string[] = [];
  const cache = {
    addAll: (urls: string[]) => { for (const u of urls) store.set(u, response(`precached:${u}`, true)); return Promise.resolve(); },
    put: (key: any, res: any) => { puts.push(keyUrl(key)); store.set(keyUrl(key), res); return Promise.resolve(); },
  };
  const context = {
    globalThis: undefined as any,
    registration: { scope: SCOPE },
    addEventListener: (type: string, fn: Function) => listeners.set(type, fn),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    caches: {
      open: () => Promise.resolve(cache),
      match: (k: any) => Promise.resolve(store.get(keyUrl(k))),
      keys: () => Promise.resolve(cacheKeys),
      delete: (key: string) => { deleted.push(key); return Promise.resolve(true); },
    },
    fetch: fetchImpl,
    Response: { error: () => ({ ok: false, status: 0, body: 'error' }) },
    URL,
  };
  context.globalThis = context;
  vm.createContext(context);
  new vm.Script(SOURCE, { filename: 'os/sw.js' }).runInContext(context);
  return { listeners, store, puts, deleted };
}

async function lifecycle(listeners: Map<string, Function>, type: string) {
  let settled: any;
  listeners.get(type)?.({ waitUntil: (p: Promise<any>) => { settled = p; } });
  await settled;
}

async function dispatchFetch(listeners: Map<string, Function>, url: string, mode = 'no-cors', method = 'GET') {
  let responded: any = null;
  listeners.get('fetch')?.({ request: { method, url, mode }, respondWith: (p: any) => { responded = Promise.resolve(p); } });
  const out = responded === null ? null : await responded;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return out;
}

function network() {
  const net = { online: true };
  const fetchImpl = (request: any) => {
    if (!net.online) return Promise.reject(new Error('offline'));
    const url = keyUrl(request);
    if (url === `${SCOPE}precache.json`) return Promise.resolve(response({ files: BUILT }, true));
    return Promise.resolve(response(`network:${url}`, true));
  };
  return { net, fetchImpl };
}

describe('the Radiant OS service worker', () => {
  it('precaches the shell and everything the build emitted, and serves all of it offline', async () => {
    const { net, fetchImpl } = network();
    const sw = bootSw(fetchImpl);
    await lifecycle(sw.listeners, 'install');
    for (const file of BUILT) assert.ok(sw.store.has(`${SCOPE}${file}`), file);
    net.online = false;
    for (const url of sw.store.keys()) {
      const res = await dispatchFetch(sw.listeners, url, url === SCOPE ? 'navigate' : 'no-cors');
      assert.equal(res?.body, `precached:${url}`, `${url} is served offline`);
    }
  });

  it('serves a new release while online, and refreshes only what it precached', async () => {
    const { fetchImpl } = network();
    const sw = bootSw(fetchImpl);
    await lifecycle(sw.listeners, 'install');
    assert.equal((await dispatchFetch(sw.listeners, `${SCOPE}app.js`))?.body, `network:${SCOPE}app.js`, 'network first');
    assert.equal(sw.store.get(`${SCOPE}app.js`).body, `network:${SCOPE}app.js`, 'and the cache follows');
    await dispatchFetch(sw.listeners, `${SCOPE}not-precached.js`);
    assert.ok(!sw.store.has(`${SCOPE}not-precached.js`));
    await dispatchFetch(sw.listeners, `${SCOPE}manifest.webmanifest`, 'navigate');
    assert.equal(sw.store.get(SCOPE).body, `precached:${SCOPE}`, 'a raw file opened in a tab is not the shell');
    const bad = bootSw(() => Promise.resolve(response('bad', false)));
    await lifecycle(bad.listeners, 'install');
    await dispatchFetch(bad.listeners, `${SCOPE}app.js`);
    await dispatchFetch(bad.listeners, SCOPE, 'navigate');
    assert.deepEqual(bad.puts, [], 'a failed answer is never cached');
    assert.equal(await dispatchFetch(sw.listeners, 'https://host/tangleai/', 'navigate'), null, 'the Tangle pages are not the OS');
    assert.equal(await dispatchFetch(sw.listeners, `${SCOPE}app.js`, 'no-cors', 'POST'), null);
  });

  it('retires only its own old caches', async () => {
    const sw = bootSw(() => Promise.reject(new Error('offline')), ['tangle-radiant-os-v0', 'tangle-radiant-os-v1', 'radiant-os-v1', 'jaren-website-v29']);
    await lifecycle(sw.listeners, 'activate');
    assert.deepEqual(sw.deleted, ['tangle-radiant-os-v0']);
  });
});
