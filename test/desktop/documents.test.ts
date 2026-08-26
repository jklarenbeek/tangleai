import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nodeDriver } from '@jarenjs/db/node';
import { createDesktop, type Desktop } from '../../apps/desktop/src/server.ts';

async function call(desktop: Desktop, method: string, url: string, body?: any): Promise<{ status: number; json: any }> {
  const response = await desktop.dispatcher.dispatch({
    method,
    url,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = typeof response.body === 'string' ? response.body
    : response.body === null ? '' : new TextDecoder().decode(response.body);
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
}

describe('desktop document lane', () => {
  it('ingests, searches, cites in chat, reports browser status, and blocks private targets before fetch', async () => {
    let fetches = 0;
    const html = '<!doctype html><html><head><link rel="canonical" href="/handbook"></head><body><main><h1>Service handbook</h1><p>The cobalt service listens on port 7443 and requires mutual TLS for every client connection.</p></main></body></html>';
    const fetchImpl = async (): Promise<Response> => {
      fetches++;
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    };
    const desktop = await createDesktop({
      driver: nodeDriver(),
      fetch: fetchImpl as any,
      documentFetch: {
        lookup: async (hostname) => [{ address: hostname === 'private.test' ? '127.0.0.1' : '93.184.216.34', family: 4 }],
        limits: { respectRobots: false, perHostDelayMs: 0 },
      },
    });
    try {
      const browser = await call(desktop, 'GET', '/api/browser/status');
      assert.deepEqual(browser.json, { mode: 'unavailable', available: false, safeForUntrusted: false, detail: 'Dynamic rendering is disabled in Settings' });

      const ingested = await call(desktop, 'POST', '/api/documents/ingest', { url: 'https://docs.example/service' });
      assert.equal(ingested.status, 200);
      assert.equal(ingested.json.status, 'ingested');
      assert.equal(ingested.json.source.canonicalUrl, 'https://docs.example/handbook');

      const sources = await call(desktop, 'GET', '/api/documents');
      assert.equal(sources.json.length, 1);
      const searched = await call(desktop, 'GET', '/api/documents/search?q=cobalt%20port');
      assert.equal(searched.status, 200);
      assert.match(searched.json.ranked[0].chunk.text, /7443/);
      assert.equal(searched.json.ranked[0].chunk.embedding, undefined);

      const chat = await call(desktop, 'POST', '/api/chat', { text: 'Which port does the cobalt service use?' });
      assert.match(chat.json.reply.text, /7443/);
      assert.ok(chat.json.documentCitations.length >= 1);
      assert.equal(chat.json.citations.length, 0, 'document chunks remain a distinct citation lane');

      const before = fetches;
      const blocked = await call(desktop, 'POST', '/api/documents/ingest', { url: 'http://private.test/secrets' });
      assert.equal(blocked.status, 422);
      assert.equal(fetches, before, 'protected target receives zero outbound requests');
      const stillReady = await call(desktop, 'GET', '/api/documents');
      assert.ok(stillReady.json.some((source: any) => source.status === 'ready'));
    } finally {
      await desktop.close();
    }
  });
});
