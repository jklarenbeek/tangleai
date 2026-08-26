import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nodeDriver } from '@jarenjs/db/node';
import { createOfflineEmbedder } from '@tangleai/pipeline';
import { createDocumentStore, openTangleDb } from '@tangleai/store';
import {
  DocumentError,
  SafeStaticFetcher,
  createDocumentIngester,
  recallDocumentChunks,
  searchDocuments,
} from '@tangleai/documents';

const lookup = async (): Promise<Array<{ address: string; family: number }>> => [{ address: '93.184.216.34', family: 4 }];

describe('versioned document ingestion and retrieval', () => {
  it('skips unchanged embeddings, atomically replaces changed content, and gates vector identity', async () => {
    const db = await openTangleDb({ driver: nodeDriver() });
    try {
      const store = createDocumentStore(db);
      const first = '<!doctype html><html><body><main><h1>Operations</h1><p>The release limit is 100 requests per minute and this is the active policy for all API clients.</p></main></body></html>';
      const changed = '<!doctype html><html><body><main><h1>Operations</h1><p>The release limit is 500 requests per minute and this is the active policy for all API clients.</p></main></body></html>';
      const bodies = [first, first, changed, changed];
      const fetchImpl = async (): Promise<Response> => {
        const body = bodies.shift();
        if (body === undefined) return new Response('upstream failed', { status: 500 });
        return new Response(body, { headers: { 'content-type': 'text/html', etag: `"${body.length}"` } });
      };
      const base = createOfflineEmbedder();
      let embeddingCalls = 0;
      const embedder = {
        model: base.model,
        dims: base.dims,
        async embed(texts: string[], options?: { signal?: AbortSignal }) {
          embeddingCalls++;
          return base.embed(texts, options);
        },
      };
      const ingester = createDocumentIngester({
        store,
        embedder,
        fetcher: new SafeStaticFetcher({ fetch: fetchImpl as any, lookup, limits: { respectRobots: false, perHostDelayMs: 0 } }),
      });

      const one = await ingester.ingest({ url: 'https://docs.example/ops' });
      assert.equal(one.status, 'ingested');
      const afterOneCalls = embeddingCalls;
      const oldVersion = one.version.id;
      const oldChunkIds = (await store.listChunks(oldVersion)).map((chunk) => chunk.id);

      const two = await ingester.ingest({ url: 'https://docs.example/ops' });
      assert.equal(two.status, 'unchanged');
      assert.equal(embeddingCalls, afterOneCalls, 'same content makes no new embedding call');

      const three = await ingester.ingest({ url: 'https://docs.example/ops' });
      assert.equal(three.status, 'ingested');
      assert.notEqual(three.version.id, oldVersion);
      assert.equal((await store.getVersion(oldVersion))?.status, 'superseded');
      assert.deepEqual(await store.listChunks(oldVersion), [], 'stale chunks are removed after activation');
      const liveIds = new Set((await store.listChunks(three.version.id)).map((chunk) => chunk.id));
      assert.ok(oldChunkIds.every((id) => !liveIds.has(id)));

      const found = await searchDocuments(store, embedder, '500 requests per minute', { k: 3 });
      assert.ok(found.ranked.some((item) => item.chunk.text.includes('500 requests')));
      assert.ok(found.ranked.every((item) => !item.chunk.text.includes('100 requests')));
      assert.equal(found.ranked[0].citation.url, 'https://docs.example/ops');
      assert.ok(found.ranked[0].context.length >= 1);

      const width = embedder.dims;
      const mismatched = await recallDocumentChunks(store, new Array(width).fill(0), { model: 'other-model', dims: width });
      assert.equal(mismatched.ranked.length, 0);
      assert.ok(mismatched.skipped > 0);

      const reindexed = await ingester.ingest({ url: 'https://docs.example/ops', maxTokens: 64 });
      assert.equal(reindexed.status, 'ingested');
      assert.notEqual(reindexed.version.id, three.version.id, 'chunk configuration participates in version identity');
      // The EFFECTIVE budgets, not the requested ones: 48 clamps to a third
      // of 64, and a version that recorded 48 could not be re-indexed from.
      assert.deepEqual(reindexed.version.chunkerConfig, { maxTokens: 64, overlapTokens: 21 });
      assert.equal((await store.getVersion(three.version.id))?.status, 'superseded');
      assert.deepEqual(await store.listChunks(three.version.id), [], 're-indexing removes chunks for the previous configuration');

      await assert.rejects(() => ingester.ingest({ url: 'https://docs.example/ops' }));
      const retained = (await store.listSources())[0];
      assert.equal(retained.activeVersionId, reindexed.version.id);
      assert.equal(retained.status, 'ready', 'a failed refresh retains the previous active version');
      assert.ok((await store.listChunks(reindexed.version.id)).length > 0);
    } finally {
      await db.close();
    }
  });

  it('reports a client-rendered shell as dynamic-unavailable without breaking the corpus store', async () => {
    const db = await openTangleDb({ driver: nodeDriver() });
    try {
      const store = createDocumentStore(db);
      const dynamic = '<!doctype html><html><body><div id="root"></div><script src="runtime.js"></script><script src="app.js"></script></body></html>';
      const ingester = createDocumentIngester({
        store,
        embedder: createOfflineEmbedder(),
        fetcher: new SafeStaticFetcher({
          lookup,
          limits: { respectRobots: false, perHostDelayMs: 0 },
          fetch: (async () => new Response(dynamic, { headers: { 'content-type': 'text/html' } })) as any,
        }),
      });
      await assert.rejects(
        () => ingester.ingest({ url: 'https://docs.example/app', allowBrowser: true }),
        (error: any) => error instanceof DocumentError && error.code === 'dynamic-unavailable',
      );
      const [source] = await store.listSources();
      assert.equal(source.status, 'dynamic-unavailable');
      assert.equal(source.activeVersionId, undefined);
      assert.deepEqual(await store.listChunks(), []);
    } finally {
      await db.close();
    }
  });
});
