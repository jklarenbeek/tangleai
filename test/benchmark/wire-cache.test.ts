/**
 * The wire cache, pinned: a vector comes back float for float, a
 * completion key is the whole identity of what was asked and nothing
 * else, a replay is marked and the wire is not called, `fresh` ignores
 * what is remembered while still remembering what it buys, and the
 * file can be deleted and the cache starts empty — the property that
 * makes it safe to throw away.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createHashEmbedder } from '@jarenjs/ai/embed';
import { nodeDriver } from '@jarenjs/db/node';

import {
  cachedChatClient,
  cachedEmbedder,
  completionKey,
  decodeVector,
  embeddingKey,
  encodeVector,
  isReplayed,
  keyedRequest,
  openWireCache,
  textHash,
  type WireChatClient,
} from '../../benchmark/lib/wire-cache.ts';

const DIR = 'test-output/wire-cache';
mkdirSync(DIR, { recursive: true });

function tempPath(name: string): string {
  const path = join(DIR, `${name}-${process.pid}.sqlite`);
  rmSync(path, { force: true });
  return path;
}

/** A chat client that answers from a counter and records what it was asked. */
function countingClient(): WireChatClient & { calls: number } {
  const client = {
    calls: 0,
    endpoint: { provider: 'openrouter', base: 'https://openrouter.ai/api/v1', model: 'fast', headers: { authorization: 'Bearer secret-value' } },
    async complete(request: any) {
      client.calls++;
      return { message: { role: 'assistant', content: `answer ${client.calls} to ${request.messages.at(-1).content}` }, finishReason: 'stop', usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
    },
  };
  return client;
}

describe('the wire cache', () => {
  it('encodes a vector to base64 and back, float for float', () => {
    const vector = new Float32Array([0.1, -2.5, 3e-7, 1e10]);
    const back = decodeVector(encodeVector(vector));
    assert.deepEqual([...back], [...vector]);
    assert.deepEqual([...decodeVector(encodeVector([1, 2, 3]))], [...Float32Array.from([1, 2, 3])], 'a plain array is stored as Float32');
  });

  it('keys an embedding by model and text hash, and a completion by everything the wire sends except the credential', async () => {
    assert.equal(textHash('a'), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
    assert.notEqual(embeddingKey('m', 'a'), embeddingKey('n', 'a'));
    assert.notEqual(embeddingKey('m', 'a'), embeddingKey('m', 'b'));
    const endpoint = { provider: 'openrouter', base: 'https://openrouter.ai/api/v1', model: 'fast' };
    const request = { messages: [{ role: 'user', content: 'q' }], reasoning: { effort: 'none' }, signal: AbortSignal.timeout(1000), stream: false, onDelta: () => {} };
    const key = await completionKey(endpoint, request);
    assert.equal(key, await completionKey(endpoint, { reasoning: { effort: 'none' }, messages: [{ content: 'q', role: 'user' }] }), 'member order and the non-keyed members do not matter');
    assert.notEqual(key, await completionKey(endpoint, { messages: request.messages }), 'the thinking control is part of the identity');
    assert.notEqual(key, await completionKey({ ...endpoint, model: 'strong' }, request), 'so is the model');
    assert.notEqual(key, await completionKey({ ...endpoint, base: 'http://localhost:11434/v1' }, request), 'and the base');
    assert.deepEqual(Object.keys(keyedRequest(request)), ['messages', 'reasoning'], 'signal, stream and callbacks are neither keyed nor stored');
  });

  it('remembers embeddings and completions in a file, counts them, and starts empty when the file is deleted', async () => {
    const path = tempPath('roundtrip');
    const clock = () => new Date('2026-08-27T12:00:00.000Z');
    let cache = await openWireCache({ path, driver: nodeDriver(), clock });
    assert.ok(existsSync(path));
    assert.deepEqual(await cache.stats(), { embeddings: 0, completions: 0 });
    const hash = createHashEmbedder({ dims: 8 });
    const vectors = await hash.embed(['one', 'two']);
    await cache.embeddings.put('hash-8', 8, ['one', 'two'], vectors);
    const back = await cache.embeddings.get('hash-8', ['two', 'three', 'one']);
    assert.deepEqual([...back[0]!], [...vectors[1]]);
    assert.equal(back[1], undefined, 'an unknown text is a miss, not a zero vector');
    assert.deepEqual([...back[2]!], [...vectors[0]]);
    assert.deepEqual(await cache.embeddings.get('other-model', ['one']), [undefined], 'another model never answers');
    await cache.completions.put({ key: 'k1', provider: 'p', model: 'm', request: { messages: [] }, reply: { message: { content: 'x' } }, usage: null, ms: 5, at: clock().toISOString() });
    const stored = await cache.completions.get('k1');
    assert.equal(stored?.ms, 5);
    assert.deepEqual(stored?.reply, { message: { content: 'x' } });
    assert.equal(await cache.completions.get('k2'), undefined);
    assert.deepEqual(await cache.stats(), { embeddings: 2, completions: 1 });
    await cache.close();

    // reopen: still there; delete: gone
    cache = await openWireCache({ path, driver: nodeDriver() });
    assert.deepEqual(await cache.stats(), { embeddings: 2, completions: 1 });
    await cache.close();
    rmSync(path, { force: true });
    cache = await openWireCache({ path, driver: nodeDriver() });
    assert.deepEqual(await cache.stats(), { embeddings: 0, completions: 0 }, 'a deleted cache is an empty cache, not an error');
    await cache.close();
    rmSync(path, { force: true });
  });

  it('a cached chat client replays a remembered reply, marked, without calling the wire — and buys under --fresh', async () => {
    const cache = await openWireCache({ path: ':memory:', driver: nodeDriver() });
    const wire = countingClient();
    let tick = 0;
    const client = cachedChatClient(wire, cache, { defaults: { reasoning: { effort: 'none' } }, timer: () => (tick += 7), clock: () => new Date('2026-08-27T12:00:00.000Z') });
    const request = { messages: [{ role: 'user', content: 'q' }], signal: AbortSignal.timeout(5000) };
    assert.equal(await client.cached(request), false);
    const first = await client.complete(request);
    assert.equal(wire.calls, 1);
    assert.equal(isReplayed(first), false);
    assert.equal(await client.cached(request), true);
    const again = await client.complete(request);
    assert.equal(wire.calls, 1, 'the wire was not called');
    assert.ok(isReplayed(again));
    assert.equal(again.replayedMs, 7, 'the wall time of the call that bought it');
    assert.equal((again as any).message.content, first.message.content);
    assert.deepEqual((again as any).usage, first.usage, 'the usage travels with the replay');
    const row = await cache.completions.get(await completionKey({ provider: 'openrouter', base: 'https://openrouter.ai/api/v1', model: 'fast' }, { ...request, reasoning: { effort: 'none' } }));
    assert.ok(row !== undefined, 'the client default was part of the key');
    assert.deepEqual(row!.request, { messages: request.messages, reasoning: { effort: 'none' } }, 'the request is stored credential-free and signal-free');
    assert.doesNotMatch(JSON.stringify(row), /secret-value/, 'the credential never reaches a row');
    // a different thinking control is a different row
    await client.complete({ ...request, reasoning: { effort: 'high' } });
    assert.equal(wire.calls, 2);
    // fresh: ignores what is remembered, remembers what it buys
    const fresh = cachedChatClient(wire, cache, { fresh: true, defaults: { reasoning: { effort: 'none' } } });
    assert.equal(await fresh.cached(request), false);
    const bought = await fresh.complete(request);
    assert.equal(wire.calls, 3);
    assert.equal(isReplayed(bought), false);
    assert.equal(((await client.complete(request)) as any).message.content, bought.message.content, 'the fresh purchase replaced the remembered reply');
    assert.equal(wire.calls, 3);
    assert.deepEqual(await cache.stats(), { embeddings: 0, completions: 2 });
    await cache.close();
  });

  it('a cached embedder answers known texts from the file and buys only the rest, in one request per call', async () => {
    const cache = await openWireCache({ path: ':memory:', driver: nodeDriver() });
    const hash = createHashEmbedder({ dims: 8 });
    let wireCalls = 0;
    let wireTexts: string[] = [];
    const wire = { model: hash.model, dims: hash.dims, async embed(texts: readonly string[]) { wireCalls++; wireTexts = [...texts]; return hash.embed([...texts]); } };
    const embedder = cachedEmbedder(wire, cache);
    const a = await embedder.embed(['one', 'two', 'three']);
    assert.equal(wireCalls, 1);
    assert.deepEqual(embedder.stats, { requests: 1, hits: 0, misses: 3 });
    const b = await embedder.embed(['three', 'four', 'one']);
    assert.equal(wireCalls, 2);
    assert.deepEqual(wireTexts, ['four'], 'only the miss went to the wire');
    assert.deepEqual(embedder.stats, { requests: 2, hits: 2, misses: 4 }, 'cumulative: three misses, then one');
    assert.deepEqual([...b[0]], [...a[2]]);
    assert.deepEqual([...b[2]], [...a[0]]);
    const c = await embedder.embed(['one', 'four']);
    assert.equal(wireCalls, 2, 'all known: no request at all');
    assert.deepEqual([...c[1]], [...b[1]]);
    const fresh = cachedEmbedder(wire, cache, { fresh: true });
    await fresh.embed(['one']);
    assert.equal(wireCalls, 3, 'fresh buys again');
    assert.deepEqual(await cache.stats(), { embeddings: 4, completions: 0 });
    await cache.close();
  });
});
