/**
 * Web access on the Pages desktop: the reader address is a plain preference
 * (an http(s) address, loopback allowed, never a query), the reader the
 * kernel gets follows it on every call without a reload, and Test tells a live
 * reader from silence. The Settings section itself is driven in a browser
 * (.e2e/migration/os-web-access.spec.mjs).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { createKernel, WEB_READER_CONTRACT } from '@tangleai/os';
import { isLocalAddress, localNetworkAccess, pagesWebReader, testWebReader, webReaderAddress, WEB_READER_EXAMPLE } from '../../apps/pages/src/os/web-access.ts';
import { createPreferences } from '../../apps/pages/src/os/preferences.ts';

const storage = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, String(v)); }, removeItem: (k: string) => { map.delete(k); } }; };
const fakeWindow = () => ({ localStorage: storage(), sessionStorage: storage(), matchMedia: () => ({ matches: false }) }) as any;

let server: Server, dispatcher: any, base = '';
before(async () => {
  dispatcher = serveHttp(compileContract(WEB_READER_CONTRACT as any), {
    'web.read': async ({ url }: any, ctx: any) => /127\.0\.0\.1|localhost/.test(url) ? ctx.fail('refused', {}, { detail: 'a private address' })
      : { url, finalUrl: url, title: 'Page', blocks: [{ kind: 'paragraph', text: 'Hello.' }], links: [], fetchedAt: '2026-11-23T00:00:00.000Z', redirects: [] },
    'web.search': async () => ({ results: [] }),
  } as any, { validateOutput: 'always' });
  server = createServer(toNodeHandler(dispatcher));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => { server.close(); await dispatcher.close(); });

describe('the reader address', () => {
  it('is an http(s) address without a query, loopback allowed; empty is none', () => {
    assert.equal(webReaderAddress('  http://127.0.0.1:4700/api/web-reader/ '), 'http://127.0.0.1:4700/api/web-reader');
    assert.equal(webReaderAddress('https://reader.example'), 'https://reader.example');
    assert.equal(webReaderAddress(''), '');
    assert.equal(webReaderAddress(undefined), '');
    for (const bad of ['ftp://x.example', 'javascript:alert(1)', 'not an address', 'https://x.example/?a=1', 'https://u:p@x.example', 42]) assert.equal(webReaderAddress(bad), null, String(bad));
  });

  it('is kept in the desktop preferences, and a stored value that is not an address reads as none', () => {
    const win = fakeWindow();
    const prefs = createPreferences(win);
    assert.equal(prefs.desktop().webReader, '');
    prefs.writeDesktop({ webReader: 'http://127.0.0.1:4700/api/web-reader' });
    assert.equal(createPreferences(win).desktop().webReader, 'http://127.0.0.1:4700/api/web-reader');
    win.localStorage.setItem('tangle-os', JSON.stringify({ webReader: 'javascript:alert(1)' }));
    assert.equal(createPreferences(win).desktop().webReader, '');
  });
});

describe('the reader the kernel gets', () => {
  it('answers OS0180 with no address, and follows a new address at once', async () => {
    let address = '';
    const kernel = createKernel({ assistantGrants: 'all', web: pagesWebReader(() => address) });
    const read = () => kernel.call('assistant', 'tangle_os_web', 'web.read', { url: 'https://example.org/' });
    assert.deepEqual((await read() as any).error.code, 'OS0180');
    address = base;
    const outcome: any = await read();
    assert.equal(outcome.ok, true);
    assert.equal(outcome.value.source, 'https://example.org/');
    assert.equal(outcome.value.untrusted, true);
    address = '';
    assert.deepEqual((await read() as any).error.code, 'OS0180');
  });

  it('Test tells a live reader from silence', async () => {
    assert.deepEqual(await testWebReader(base), { ok: true });
    const silent = await testWebReader('http://127.0.0.1:1');
    assert.equal(silent.ok, false);
  });
});

describe('a reader on this computer or the local network', () => {
  it('is told by its host: loopback, the private ranges, localhost and .local', () => {
    for (const at of ['http://127.0.0.1:4700/api/web-reader', 'http://localhost:4700', 'http://[::1]:4700', 'http://10.0.0.5', 'http://172.20.1.1', 'http://192.168.1.10', 'http://169.254.0.1', 'http://desk.local', 'http://[fd00::1]'])
      assert.equal(isLocalAddress(at), true, at);
    for (const at of ['https://reader.example', 'http://172.32.0.1', 'http://8.8.8.8', 'https://jklarenbeek.github.io', 'not an address'])
      assert.equal(isLocalAddress(at), false, at);
  });

  it('needs the browser\'s leave only from a public page, and says what the browser answers', async () => {
    const asking = (state: string) => ({ query: async () => ({ state }) });
    const page = 'https://jklarenbeek.github.io';
    assert.equal(await localNetworkAccess('https://reader.example', { origin: page, permissions: asking('denied') }), 'not-needed');
    assert.equal(await localNetworkAccess(WEB_READER_EXAMPLE, { origin: 'http://127.0.0.1:4715', permissions: asking('denied') }), 'not-needed');
    for (const state of ['granted', 'prompt', 'denied']) assert.equal(await localNetworkAccess(WEB_READER_EXAMPLE, { origin: page, permissions: asking(state) }), state);
    assert.equal(await localNetworkAccess(WEB_READER_EXAMPLE, { origin: page, permissions: { query: async () => { throw new TypeError('unknown permission'); } } }), 'unknown');
    assert.equal(await localNetworkAccess(WEB_READER_EXAMPLE, { origin: page }), 'unknown');
  });
});
