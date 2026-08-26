import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  DocumentError,
  SafeStaticFetcher,
  assertPublicUrl,
  extractHtml,
  extractPdf,
  extractTextDocument,
  isReservedAddress,
  normalizeUrl,
} from '@tangleai/documents';

const fixture = (name: string): URL => new URL(`../fixtures/documents/${name}`, import.meta.url);
const publicLookup = async (): Promise<Array<{ address: string; family: number }>> => [{ address: '203.0.113.20'.replace('203.0.113', '93.184.216'), family: 4 }];

describe('document URL policy and bounded fetch', () => {
  it('normalizes HTTP URLs and rejects schemes, credentials, and protected addresses', async () => {
    assert.equal(normalizeUrl('HTTPS://Example.COM:443/a#frag'), 'https://example.com/a');
    assert.throws(() => normalizeUrl('file:///etc/passwd'), (error: any) => error.code === 'blocked-url');
    assert.throws(() => normalizeUrl('https://user:pass@example.com'), (error: any) => error.code === 'blocked-url');
    for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '::1', 'fd00::1', 'fe80::1']) {
      assert.equal(isReservedAddress(address), true, address);
    }
    await assert.rejects(
      () => assertPublicUrl('http://internal.test', { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }),
      (error: any) => error.code === 'blocked-address',
    );
  });

  it('refuses a bracketed IPv6 literal by policy, never by a DNS failure', async () => {
    let looked = 0;
    const lookup = async (): Promise<Array<{ address: string; family: number }>> => {
      looked++;
      throw new Error('getaddrinfo ENOTFOUND');
    };
    for (const url of ['http://[::1]:8080/x', 'http://[fd00::1]/x', 'http://[fe80::1]/x']) {
      await assert.rejects(
        assertPublicUrl(url, { lookup }),
        (error: any) => error instanceof DocumentError && error.code === 'blocked-address',
        url,
      );
    }
    assert.equal(looked, 0, 'an IP literal must never reach the resolver');
  });

  it('validates a redirect before making any request to its protected target', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: any): Promise<Response> => {
      calls.push(String(url));
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
    };
    const fetcher = new SafeStaticFetcher({
      fetch: fetchImpl as any,
      lookup: publicLookup,
      limits: { respectRobots: false, perHostDelayMs: 0 },
    });
    await assert.rejects(() => fetcher.fetch('https://public.test/start'), (error: any) => error.code === 'blocked-address');
    assert.deepEqual(calls, ['https://public.test/start']);
  });

  it('cancels an incrementally consumed response as soon as its byte budget is crossed', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a'.repeat(12)));
        controller.enqueue(new TextEncoder().encode('b'.repeat(12)));
      },
      cancel() { cancelled = true; },
    });
    const fetcher = new SafeStaticFetcher({
      fetch: (async () => new Response(stream, { headers: { 'content-type': 'text/plain' } })) as any,
      lookup: publicLookup,
      limits: { respectRobots: false, perHostDelayMs: 0, maxBytes: 16 },
    });
    await assert.rejects(() => fetcher.fetch('https://public.test/large'), (error: any) => error.code === 'response-too-large');
    assert.equal(cancelled, true);
  });

  it('honours robots rules and never requests a disallowed document', async () => {
    const calls: string[] = [];
    const fetcher = new SafeStaticFetcher({
      lookup: publicLookup,
      limits: { perHostDelayMs: 0, respectRobots: true },
      fetch: (async (url: any) => {
        calls.push(String(url));
        if (String(url).endsWith('/robots.txt')) {
          return new Response('User-agent: *\nDisallow: /private', { headers: { 'content-type': 'text/plain' } });
        }
        return new Response('must not be reached');
      }) as any,
    });
    await assert.rejects(() => fetcher.fetch('https://public.test/private/report'), (error: any) => error.code === 'robots-denied');
    assert.deepEqual(calls, ['https://public.test/robots.txt']);
  });

  it('sends response validators and handles a 304 without reading a body', async () => {
    let headers: Headers | undefined;
    const fetcher = new SafeStaticFetcher({
      lookup: publicLookup,
      limits: { perHostDelayMs: 0, respectRobots: false },
      fetch: (async (_url: any, init: RequestInit) => {
        headers = new Headers(init.headers);
        return new Response(null, { status: 304, headers: { etag: '"new"' } });
      }) as any,
    });
    const result = await fetcher.fetch('https://public.test/report', { etag: '"old"', lastModified: 'Wed, 26 Aug 2026 10:00:00 GMT' });
    assert.equal(result.status, 'not-modified');
    assert.equal(headers?.get('if-none-match'), '"old"');
    assert.equal(headers?.get('if-modified-since'), 'Wed, 26 Aug 2026 10:00:00 GMT');
  });

  it('supports an injected terms policy that denies before transport', async () => {
    let fetched = false;
    const fetcher = new SafeStaticFetcher({
      lookup: publicLookup,
      termsPolicy: async (url) => !url.startsWith('https://restricted.test/'),
      limits: { respectRobots: false, perHostDelayMs: 0 },
      fetch: (async () => { fetched = true; return new Response('no'); }) as any,
    });
    await assert.rejects(() => fetcher.fetch('https://restricted.test/report'), (error: any) => error.code === 'terms-denied');
    assert.equal(fetched, false);
  });
});

describe('typed extraction', () => {
  it('selects main HTML, drops navigation/references, resolves canonical URLs, and retains useful tables', async () => {
    const noisy = await readFile(fixture('noisy-wikipedia.html'), 'utf8');
    const extracted = extractHtml(noisy, 'https://en.wikipedia.org/wiki/Vitamin_E', { minUsefulChars: 1 });
    const text = extracted.elements.map((element) => element.text).join('\n');
    assert.match(text, /eight fat-soluble compounds/);
    assert.match(text, /Type \| Fat-soluble vitamin/);
    assert.doesNotMatch(text, /Account tools|Reference list boilerplate|Privacy policy|Contents Uses/);
    assert.ok(extracted.elements.some((element) => element.role === 'table'));

    const simple = await readFile(fixture('static.html'), 'utf8');
    const staticDoc = extractHtml(simple, 'https://docs.example/original', { minUsefulChars: 1 });
    assert.equal(staticDoc.canonicalUrl, 'https://docs.example/guide');
    assert.deepEqual(staticDoc.elements.find((element) => element.text.includes('Rollback restores'))?.headingPath, ['Release guide', 'Rollback']);
  });

  it('parses Markdown hierarchy and tolerates recoverable malformed HTML', async () => {
    const markdown = await readFile(fixture('structured.md'), 'utf8');
    const extracted = extractTextDocument(markdown, true);
    assert.ok(extracted.elements.some((element) => element.role === 'code'));
    assert.deepEqual(extracted.elements.find((element) => element.text.includes('Publish'))?.headingPath, ['Operations', 'Deploy']);

    const malformed = await readFile(fixture('malformed.html'), 'utf8');
    const recovered = extractHtml(malformed, 'https://docs.example/broken', { minUsefulChars: 1 });
    assert.match(recovered.elements.map((element) => element.text).join(' '), /recoverable text/);
  });

  it('uses real PDF page boxes, prevents cross-column merges, and preserves figure captions', async () => {
    const multi = new Uint8Array(Buffer.from((await readFile(fixture('multicolumn.pdf.b64'), 'utf8')).trim(), 'base64'));
    const extracted = await extractPdf(multi);
    assert.equal(extracted.pages, 1);
    const lines = extracted.elements.map((element) => element.text);
    assert.deepEqual(lines, ['Left heading', 'Left first', 'Left second', 'Right heading', 'Right first', 'Right second']);
    assert.ok(extracted.elements.every((element) => element.bbox !== undefined && element.page === 1));

    const table = new Uint8Array(Buffer.from((await readFile(fixture('table-figure.pdf.b64'), 'utf8')).trim(), 'base64'));
    const figure = await extractPdf(table);
    assert.ok(figure.elements.some((element) => element.role === 'figure-caption' && element.text.includes('Revenue by region')));
    assert.ok(figure.elements.some((element) => element.role === 'table' && element.text === 'Region | Revenue'));
    assert.ok(figure.elements.some((element) => element.role === 'table' && element.text === 'North | 120'));
  });

  it('reports explicit element budgets instead of silently truncating', () => {
    const text = Array.from({ length: 20 }, (_, index) => `paragraph ${index} has enough content to index`).join('\n\n');
    assert.throws(() => extractTextDocument(text, false, { maxElements: 4 }), (error: any) => error instanceof DocumentError && error.code === 'element-budget');
    const partial = extractTextDocument(text, false, { maxElements: 4, allowPartial: true });
    assert.equal(partial.elements.length, 4);
    assert.match(partial.warnings[0], /partial extraction/);
  });
});
