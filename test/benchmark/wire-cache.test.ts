/**
 * Tangle's SQLite adapter over the replay seam shipped by JarenJS 0.56.
 *
 * JarenJS's own suite pins request normalization and malformed-entry
 * behavior. These tests pin Tangle's remaining responsibilities: durable
 * storage, SHA-256/full-key collision protection, packed vectors, fresh-run
 * behavior, endpoint-aware embedding inspection, and zero second-run wires.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createChatClient } from '@jarenjs/ai';
import { createEmbeddingClient } from '@jarenjs/ai/embed';
import { nodeDriver } from '@jarenjs/db/node';

import {
  decodeVector,
  encodeVector,
  openWireCache,
  replayDigest,
} from '../../benchmark/lib/wire-cache.ts';

const DIR = 'test-output/wire-cache';
mkdirSync(DIR, { recursive: true });

function tempPath(name: string): string {
  const path = join(DIR, `${name}-${process.pid}.sqlite`);
  rmSync(path, { force: true });
  return path;
}

function chatReply(content: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    model: 'stub',
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('the JarenJS replay adapter', () => {
  it('uses SHA-256 ids and packs vectors float for float', () => {
    assert.equal(replayDigest('key').length, 64);
    assert.equal(replayDigest('key'), replayDigest('key'));
    assert.notEqual(replayDigest('key'), replayDigest('other'));
    const vector = new Float32Array([0.1, -2.5, 3e-7, 1e10]);
    assert.deepEqual([...decodeVector(encodeVector(vector))], [...vector]);
    assert.deepEqual([...decodeVector(encodeVector([1, 2, 3]))], [...Float32Array.from([1, 2, 3])]);
  });

  it('lets the upstream chat client replay with zero transport calls; fresh buys and replaces', async () => {
    const cache = await openWireCache({ path: ':memory:', driver: nodeDriver() });
    let calls = 0;
    const fetch = (async () => chatReply(`answer ${++calls}`)) as typeof globalThis.fetch;
    const make = (fresh = false) => createChatClient({
      provider: 'custom',
      baseUrl: 'https://example.test/v1',
      model: 'fast',
      apiKey: 'secret-value',
      reasoning: { effort: 'none' },
      retry: { attempts: 1 },
      fetch,
      cache: cache.adapter({ fresh }),
    });
    const request = { messages: [{ role: 'user', content: 'q' }], stream: false };
    const first = await make().complete(request);
    assert.equal(calls, 1);
    assert.equal(first.replayed, undefined);
    const replayed = await make().complete(request);
    assert.equal(calls, 1, 'the second client lifetime made no wire call');
    assert.equal(replayed.message.content, first.message.content);
    assert.deepEqual(replayed.usage, first.usage);
    assert.ok(Number.isFinite(replayed.replayed.ms));

    const bought = await make(true).complete(request);
    assert.equal(calls, 2, '--fresh ignored the old row and bought again');
    assert.equal(bought.replayed, undefined);
    const replaced = await make().complete(request);
    assert.equal(calls, 2);
    assert.equal(replaced.message.content, bought.message.content);
    assert.deepEqual(await cache.stats(), {
      embeddings: 0, completions: 1, legacyEmbeddings: 0, legacyCompletions: 0,
    });
    await cache.close();
  });

  it('lets the upstream embedding client buy only misses and exposes exact preflight hits', async () => {
    const cache = await openWireCache({ path: ':memory:', driver: nodeDriver() });
    let calls = 0;
    let lastInput: string[] = [];
    const vectorOf = (text: string): number[] => [text.length, text.charCodeAt(0) / 100, 1];
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      lastInput = body.input;
      return new Response(JSON.stringify({
        data: body.input.map((text, index) => ({ index, embedding: vectorOf(text) })),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const endpoint = { provider: 'custom', base: 'https://example.test/v1', model: 'embed' };
    const make = (fresh = false) => createEmbeddingClient({
      provider: endpoint.provider,
      baseUrl: endpoint.base,
      model: endpoint.model,
      retry: { attempts: 1 },
      fetch,
      cache: cache.adapter({ fresh }),
    });

    const first = await make().embed(['one', 'two', 'three']);
    assert.equal(calls, 1);
    const second = await make().embed(['three', 'four', 'one']);
    assert.equal(calls, 2);
    assert.deepEqual(lastInput, ['four'], 'only the miss travelled');
    assert.deepEqual([...second[0]], [...first[2]]);
    assert.deepEqual([...second[2]], [...first[0]]);
    const hits = await cache.embeddingHits(endpoint, ['two', 'missing', 'four']);
    assert.deepEqual([...hits[0]!], [...first[1]]);
    assert.equal(hits[1], undefined);
    assert.deepEqual([...hits[2]!], [...second[1]]);

    await make().embed(['one']);
    assert.equal(calls, 2, 'all remembered means no wire call');
    await make(true).embed(['one']);
    assert.equal(calls, 3, 'fresh buys the text again');
    assert.deepEqual(await cache.stats(), {
      embeddings: 4, completions: 0, legacyEmbeddings: 0, legacyCompletions: 0,
    });
    await cache.close();
  });

  it('persists replay rows across process lifetimes and starts empty when deleted', async () => {
    const path = tempPath('roundtrip');
    let cache = await openWireCache({ path, driver: nodeDriver() });
    assert.ok(existsSync(path));
    await cache.set('{"base":"x","provider":"p","request":{"messages":[],"model":"m"},"wire":"chat"}',
      { value: { message: { role: 'assistant', content: 'x' } }, ms: 5 });
    assert.equal((await cache.stats()).completions, 1);
    await cache.close();

    cache = await openWireCache({ path, driver: nodeDriver() });
    assert.equal((await cache.stats()).completions, 1);
    await cache.close();
    rmSync(path, { force: true });
    cache = await openWireCache({ path, driver: nodeDriver() });
    assert.deepEqual(await cache.stats(), {
      embeddings: 0, completions: 0, legacyEmbeddings: 0, legacyCompletions: 0,
    });
    await cache.close();
    rmSync(path, { force: true });
  });
});
