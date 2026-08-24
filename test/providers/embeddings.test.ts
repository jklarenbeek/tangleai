import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createEmbeddingClient, type EmbeddingClientOptions } from '@tangleai/providers';
import type { TangleError } from '@tangleai/core/errors';

interface FakeReply {
  status?: number;
  body: unknown;
}

function fakeFetch(handler: (url: string, init: RequestInit) => FakeReply): typeof globalThis.fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const result = handler(String(url), init ?? {});
    return {
      ok: result.status === undefined || result.status < 400,
      status: result.status ?? 200,
      json: async () => result.body,
    };
  }) as unknown as typeof globalThis.fetch;
}

describe('createEmbeddingClient — ollama wire', () => {
  it('POSTs {model, input} to /api/embed and returns the vectors', async () => {
    let seen: { url: string; body: unknown } | undefined;
    const client = createEmbeddingClient({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/',
      model: 'nomic-embed-text',
      fetch: fakeFetch((url, init) => {
        seen = { url, body: JSON.parse(String(init.body)) };
        return { body: { embeddings: [[1, 2], [3, 4]] } };
      }),
    });
    const vectors = await client.embed(['a', 'b']);
    assert.equal(seen?.url, 'http://localhost:11434/api/embed');
    assert.deepEqual(seen?.body, { model: 'nomic-embed-text', input: ['a', 'b'] });
    assert.deepEqual(vectors, [[1, 2], [3, 4]]);
  });
});

describe('createEmbeddingClient — openai wire', () => {
  it('POSTs to /v1/embeddings with the bearer key and reassembles by index', async () => {
    let seen: { url: string; auth: string | undefined } | undefined;
    const client = createEmbeddingClient({
      provider: 'openai',
      baseUrl: 'https://openrouter.ai/api',
      model: 'text-embedding-x',
      apiKey: 'sk-test',
      fetch: fakeFetch((url, init) => {
        seen = { url, auth: (init.headers as Record<string, string>).authorization };
        // deliberately out of order — the index field is authoritative
        return { body: { data: [
          { index: 1, embedding: [3, 4] },
          { index: 0, embedding: [1, 2] },
        ] } };
      }),
    });
    const vectors = await client.embed(['first', 'second']);
    assert.equal(seen?.url, 'https://openrouter.ai/api/v1/embeddings');
    assert.equal(seen?.auth, 'Bearer sk-test');
    assert.deepEqual(vectors, [[1, 2], [3, 4]]);
  });

  it('does not double the /v1 suffix', async () => {
    let seen: string | undefined;
    const client = createEmbeddingClient({
      provider: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'm',
      fetch: fakeFetch((url) => { seen = url; return { body: { data: [{ index: 0, embedding: [1] }] } }; }),
    });
    await client.embed(['x']);
    assert.equal(seen, 'http://localhost:1234/v1/embeddings');
  });
});

describe('createEmbeddingClient — errors are coded', () => {
  it('TA0001 for misuse', async () => {
    assert.throws(
      () => createEmbeddingClient({ provider: 'aws', baseUrl: 'x', model: 'm' } as unknown as EmbeddingClientOptions),
      (e: TangleError) => e.code === 'TA0001');
    const client = createEmbeddingClient({ provider: 'ollama', baseUrl: 'x', model: 'm', fetch: fakeFetch(() => ({ body: {} })) });
    await assert.rejects(() => client.embed([]), (e: TangleError) => e.code === 'TA0001');
  });
  it('TA0002 for an HTTP failure, with the status attached', async () => {
    const client = createEmbeddingClient({
      provider: 'ollama', baseUrl: 'x', model: 'm',
      fetch: fakeFetch(() => ({ status: 503, body: {} })),
    });
    await assert.rejects(() => client.embed(['a']),
      (e: TangleError) => e.code === 'TA0002' && e.status === 503);
  });
  it('TA0003 for a malformed payload — wrong count, empty vector, junk shape', async () => {
    const cases: unknown[] = [
      { embeddings: [[1, 2]] },        // one vector for two inputs
      { embeddings: [[1], []] },       // empty vector
      { nonsense: true },              // no vectors at all
    ];
    for (const body of cases) {
      const client = createEmbeddingClient({
        provider: 'ollama', baseUrl: 'x', model: 'm', fetch: fakeFetch(() => ({ body })),
      });
      await assert.rejects(() => client.embed(['a', 'b']), (e: TangleError) => e.code === 'TA0003');
    }
  });
});
