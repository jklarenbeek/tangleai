/**
 * The desktop's web reader: a page's extraction becomes readable blocks with
 * absolute http(s) links and no script; the route serves the `web_reader`
 * contract to admitted origins only, answers the preflight a published page
 * sends, and refuses a private address unless the documents test seam opens it.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { extractHtml, SafeStaticFetcher } from '@tangleai/documents';
import { nodeDriver } from '@jarenjs/db/node';
import { httpWebReader, WEB_READER_CONTRACT as OS_CONTRACT } from '@tangleai/os';
import { blocksOf, pageOf, createWebReader, webReaderRoute, desktopWebRoute, admittedOrigin, WEB_READER_CONTRACT, WEB_READER_PATH } from '../../apps/desktop/src/web-reader.ts';
import { createDesktop } from '../../apps/desktop/src/server.ts';

const ARTICLE = `<!doctype html><html lang="nl"><head><title>Getijden</title>
<script>window.stolen = document.cookie; alert('hello')</script><style>body{color:red}</style></head>
<body><nav><a href="/home">Home</a> <a href="/about">About</a></nav>
<main><h1>Tides</h1>
<p>The moon pulls the sea. Read <a href="/moon#orbit">the moon</a>, <a href="javascript:alert(1)">this</a> and <a href="https://example.org/sea">the sea</a>.</p>
<h2>Kinds</h2>
<ul><li>Spring tide</li><li>Neap tide</li></ul>
<blockquote>Time and tide wait for no one.</blockquote>
<pre>high = 06:12</pre>
<table><tr><th>Tide</th><th>Time</th></tr><tr><td>high</td><td>06:12</td></tr></table>
<script>document.write('injected')</script>
</main><footer>© the harbour</footer></body></html>`;

describe('the block mapping', () => {
  it('maps an extraction to blocks in reading order, with absolute http(s) links and no script text', () => {
    const extracted = extractHtml(ARTICLE, 'https://tides.example/today');
    const page = pageOf({ requestedUrl: 'https://tides.example/today', finalUrl: 'https://tides.example/today', fetchedAt: '2026-11-23T00:00:00.000Z' }, extracted, 'nl');
    assert.equal(page.title, 'Tides');
    assert.equal(page.lang, 'nl');
    assert.deepEqual(page.blocks, [
      { kind: 'heading', level: 1, text: 'Tides' },
      { kind: 'paragraph', text: 'The moon pulls the sea. Read the moon, this and the sea.', links: [{ text: 'the moon', href: 'https://tides.example/moon' }, { text: 'the sea', href: 'https://example.org/sea' }] },
      { kind: 'heading', level: 2, text: 'Kinds' },
      { kind: 'list', ordered: false, items: ['Spring tide', 'Neap tide'] },
      { kind: 'quote', text: 'Time and tide wait for no one.' },
      { kind: 'code', text: 'high = 06:12' },
      { kind: 'table', rows: [['Tide', 'Time'], ['high', '06:12']] },
    ]);
    assert.deepEqual(page.links.map(l => l.href), ['https://tides.example/moon', 'https://example.org/sea']);
    const all = JSON.stringify(page);
    for (const leak of ['cookie', 'alert', 'injected', 'color:red', 'javascript:', '<']) assert.ok(!all.includes(leak), `no ${leak} in the page`);
  });

  it('drops links that are not http(s) and holds the page to the contract\'s caps', () => {
    const blocks = blocksOf([{ text: 'x', role: 'paragraph', order: 0, headingPath: [], links: [{ text: 'a', url: 'data:text/html,<b>' }, { text: 'b', url: '/relative' }, { text: 'c', url: 'https://ok.example/' }] } as any]);
    assert.deepEqual(blocks, [{ kind: 'paragraph', text: 'x', links: [{ text: 'c', href: 'https://ok.example/' }] }]);
    const many = Array.from({ length: 2100 }, (_, i) => ({ text: `p${i}`, role: 'paragraph', order: i, headingPath: [], links: [{ text: 'l', url: `https://ok.example/${i}` }] }));
    const page = pageOf({ requestedUrl: 'https://ok.example/', finalUrl: 'https://ok.example/', fetchedAt: 'now' }, { title: 't'.repeat(900), elements: many as any, warnings: [] });
    assert.equal(page.blocks.length, 2000);
    assert.equal(page.links.length, 1000);
    assert.equal(page.title.length, 500);
    assert.equal(page.truncated, true);
  });

  it('copies the contract @tangleai/os defines, member for member', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(WEB_READER_CONTRACT)), JSON.parse(JSON.stringify(OS_CONTRACT)));
  });
});

describe('the reader route', () => {
  let site: Server, desk: Server, siteBase = '', deskBase = '';
  const fetcher = new SafeStaticFetcher({ allowPrivate: true, limits: { respectRobots: false, perHostDelayMs: 0 } });
  let route: ReturnType<typeof webReaderRoute>;

  before(async () => {
    site = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];
      if (path === '/tides') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(ARTICLE); return; }
      if (path === '/moved') { res.writeHead(302, { location: '/tides' }); res.end(); return; }
      if (path === '/notes.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('First line.\n\nSecond paragraph.'); return; }
      if (path === '/logo.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3])); return; }
      if (path === '/search') {
        const q = new URL(req.url!, 'http://x').searchParams.get('q');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ results: [{ title: `About ${q}`, url: 'https://tides.example/', content: 'Tides  and   moons' }, { title: 'Bad', url: 'javascript:alert(1)' }, { title: 'Two', url: 'https://two.example/' }] }));
        return;
      }
      res.writeHead(404, { 'content-type': 'text/html' }); res.end('<html><body><p>Not here</p></body></html>');
    });
    await new Promise<void>(done => site.listen(0, '127.0.0.1', done));
    siteBase = `http://127.0.0.1:${(site.address() as any).port}`;
    route = webReaderRoute(createWebReader({ fetcher, searxngUrl: () => siteBase }));
    desk = createServer((req, res) => (req.url ?? '').startsWith(WEB_READER_PATH) ? route(req, res) : (res.writeHead(404), res.end()));
    await new Promise<void>(done => desk.listen(0, '127.0.0.1', done));
    deskBase = `http://127.0.0.1:${(desk.address() as any).port}${WEB_READER_PATH}`;
  });
  after(async () => { desk.close(); site.close(); await route.close(); await fetcher.close(); });

  it('reads a page through its redirects, and plain text, for the OS client', async () => {
    const reader = httpWebReader(deskBase);
    const page = await reader.read({ url: `${siteBase}/moved` });
    assert.equal(page.url, `${siteBase}/moved`);
    assert.equal(page.finalUrl, `${siteBase}/tides`);
    assert.deepEqual(page.redirects, [`${siteBase}/tides`]);
    assert.equal(page.title, 'Tides');
    assert.equal(page.blocks[0].kind, 'heading');
    const text = await reader.read({ url: `${siteBase}/notes.txt` });
    assert.deepEqual(text.blocks, [{ kind: 'paragraph', text: 'First line.' }, { kind: 'paragraph', text: 'Second paragraph.' }]);
  });

  it('answers unreadable for an HTTP error and for what is not a page, and refused for what is not http(s)', async () => {
    const reader = httpWebReader(deskBase);
    await assert.rejects(reader.read({ url: `${siteBase}/missing` }), { code: 'OS0182', message: /HTTP 404/ });
    await assert.rejects(reader.read({ url: `${siteBase}/logo.png` }), { code: 'OS0182' });
    await assert.rejects(reader.read({ url: 'file:///etc/passwd' }), { code: 'OS0181' });
  });

  it('searches the configured SearxNG, keeping only http(s) results, to the limit asked', async () => {
    const { results } = await httpWebReader(deskBase).search({ query: 'tides', limit: 5 });
    assert.deepEqual(results, [{ title: 'About tides', url: 'https://tides.example/', snippet: 'Tides and moons' }, { title: 'Two', url: 'https://two.example/' }]);
    const one = await httpWebReader(deskBase).search({ query: 'tides', limit: 1 });
    assert.equal(one.results.length, 1);
  });

  it('admits the desktop\'s own page, loopback pages and the published desktop, with the private network preflight', async () => {
    assert.equal(admittedOrigin(undefined), true);
    assert.equal(admittedOrigin('http://localhost:4745'), true);
    assert.equal(admittedOrigin('https://jklarenbeek.github.io'), true);
    assert.equal(admittedOrigin('https://jklarenbeek.github.io.evil.example'), false);
    assert.equal(admittedOrigin('http://127.0.0.1.evil.example'), false);

    const preflight = await fetch(`${deskBase}/web.read`, { method: 'OPTIONS', headers: { origin: 'https://jklarenbeek.github.io', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type', 'access-control-request-private-network': 'true' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://jklarenbeek.github.io');
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /content-type/);

    const admitted = await fetch(`${deskBase}/web.read`, { method: 'POST', headers: { origin: 'http://127.0.0.1:4745', 'content-type': 'application/json' }, body: JSON.stringify({ url: `${siteBase}/tides` }) });
    assert.equal(admitted.status, 200);
    assert.equal(admitted.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4745');
    assert.equal(admitted.headers.get('vary'), 'Origin');
  });

  it('refuses any other origin before anything is fetched', async () => {
    let fetched = 0;
    const counting = webReaderRoute(createWebReader({ fetcher: { fetch: async (...args: any[]) => { fetched++; return (fetcher.fetch as any)(...args); } }, searxngUrl: () => null }));
    const server = createServer((req, res) => counting(req, res));
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    try {
      const base = `http://127.0.0.1:${(server.address() as any).port}${WEB_READER_PATH}`;
      const refused = await fetch(`${base}/web.read`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'text/plain' }, body: JSON.stringify({ url: `${siteBase}/tides` }) });
      assert.equal(refused.status, 403);
      assert.equal(refused.headers.get('access-control-allow-origin'), null);
      assert.equal(fetched, 0);
      await assert.rejects(httpWebReader(base).search({ query: 'x' }), { code: 'OS0182', message: /no search service/ });
    } finally { server.close(); await counting.close(); }
  });

  it('refuses a private address without the test seam, on the desktop\'s route', async () => {
    const desktop = await createDesktop({ driver: nodeDriver() });
    const web = desktopWebRoute(desktop.db, { documentFetch: { limits: { respectRobots: false, perHostDelayMs: 0 } } });
    const server = createServer((req, res) => web(req, res));
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    try {
      const reader = httpWebReader(`http://127.0.0.1:${(server.address() as any).port}${WEB_READER_PATH}`);
      await assert.rejects(reader.read({ url: `${siteBase}/tides` }), { code: 'OS0181' });
      await assert.rejects(reader.read({ url: 'http://localhost/' }), { code: 'OS0181' });
      await assert.rejects(reader.search({ query: 'x' }), { code: 'OS0182', message: /no search service/ }, 'the desktop\'s settings name no SearxNG');
    } finally { server.close(); await web.close(); await desktop.close(); }
  });
});
