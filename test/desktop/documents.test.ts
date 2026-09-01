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

  it('a configured model cites across both lanes, and each answer-named id lands in its own lane', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const folder = await mkdtemp(join(tmpdir(), 'tangle-mixed-'));
    await writeFile(join(folder, 'notes.md'), 'The cobalt dashboard credentials rotate every 30 days');
    const html = '<!doctype html><html><body><main><h1>Service handbook</h1><p>The cobalt service listens on port 7443 and requires mutual TLS for every client connection.</p></main></body></html>';
    const fetchImpl = async (url: any, init?: any): Promise<Response> => {
      if (String(url).endsWith('/chat/completions')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        const system: string = body.messages.find((m: any) => String(m.content).includes('MEMORIES:'))?.content ?? '';
        const memoryId = /\[(m-[^\]]+)\]/.exec(system)?.[1];
        const chunkId = /\[(chk-[^\]]+)\]/.exec(system)?.[1];
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: JSON.stringify({
            disposition: 'answer',
            claims: [
              { id: 'a1', text: 'The service listens on port 7443.', citations: chunkId === undefined ? [] : [chunkId] },
              { id: 'a2', text: 'Credentials rotate every 30 days.', citations: memoryId === undefined ? [] : [memoryId] },
            ],
          }) }, finish_reason: 'stop' }],
          usage: {},
          model: 'stub',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    };
    const desktop = await createDesktop({
      driver: nodeDriver(),
      fetch: fetchImpl as any,
      documentFetch: {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        limits: { respectRobots: false, perHostDelayMs: 0 },
      },
      presetSettings: {
        folder,
        chat: { provider: 'ollama', baseUrl: 'http://stub.local:11434', model: 'stub-model', apiKey: null },
      },
    });
    try {
      await call(desktop, 'POST', '/api/folder/sync', {});
      await call(desktop, 'POST', '/api/documents/ingest', { url: 'https://docs.example/service' });
      const chat = await call(desktop, 'POST', '/api/chat', { text: 'port and rotation?' });
      assert.equal(chat.status, 200);
      assert.equal(chat.json.citations.length, 1, 'exactly the one answer-named memory');
      assert.equal(chat.json.documentCitations.length, 1, 'exactly the one answer-named document chunk');
      assert.match(chat.json.citations[0].text, /30 days/);
      assert.match(chat.json.documentCitations[0].chunk.text, /7443/);
      assert.equal(chat.json.reply.citations.length, 2, 'both lanes, first-visible order');
      assert.equal(chat.json.reply.text, 'The service listens on port 7443.; Credentials rotate every 30 days.');
    } finally {
      await desktop.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
