import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSearxngClient, type SearxngClientOptions } from '@tangleai/search';
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

describe('createSearxngClient', () => {
  it('queries /search with format=json and the given options', async () => {
    let seen: URL | undefined;
    const client = createSearxngClient({
      baseUrl: 'http://localhost:8080/',
      fetch: fakeFetch((url) => {
        seen = new URL(url);
        return { body: { results: [], suggestions: [] } };
      }),
    });
    await client.search('jaren json schema', { categories: 'it', language: 'en', pageno: 2 });
    assert.equal(seen?.pathname, '/search');
    assert.equal(seen?.searchParams.get('format'), 'json');
    assert.equal(seen?.searchParams.get('q'), 'jaren json schema');
    assert.equal(seen?.searchParams.get('categories'), 'it');
    assert.equal(seen?.searchParams.get('pageno'), '2');
  });

  it('normalises results — whitespace collapsed, optional fields only when present', async () => {
    const client = createSearxngClient({
      baseUrl: 'http://x',
      fetch: fakeFetch(() => ({ body: {
        results: [{ title: '  A\n  title ', url: 'https://a.example', content: 'some\t\tsnippet', extra_junk: 1 }],
        suggestions: ['more'],
      } })),
    });
    const { results, suggestions } = await client.search('q');
    assert.deepEqual(results, [{ title: 'A title', url: 'https://a.example', content: 'some snippet' }]);
    assert.deepEqual(suggestions, ['more']);
  });

  it('a 403 names the usual cause (format=json disabled)', async () => {
    const client = createSearxngClient({ baseUrl: 'http://x', fetch: fakeFetch(() => ({ status: 403, body: {} })) });
    await assert.rejects(() => client.search('q'),
      (e: TangleError) => e.code === 'TA0002' && e.status === 403 && /format=json/.test(e.message));
  });

  it('a reply without a results array is a payload error, missing suggestions default empty', async () => {
    const broken = createSearxngClient({ baseUrl: 'http://x', fetch: fakeFetch(() => ({ body: { nothing: true } })) });
    await assert.rejects(() => broken.search('q'), (e: TangleError) => e.code === 'TA0003');

    const bare = createSearxngClient({ baseUrl: 'http://x', fetch: fakeFetch(() => ({ body: { results: [] } })) });
    assert.deepEqual((await bare.search('q')).suggestions, []);
  });

  it('misuse is TA0001', () => {
    assert.throws(
      () => createSearxngClient({} as SearxngClientOptions),
      (e: TangleError) => e.code === 'TA0001');
  });
});
