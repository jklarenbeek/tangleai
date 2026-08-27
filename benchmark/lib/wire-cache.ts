/**
 * The wire cache — everything a live tier has paid for, kept.
 *
 * A live run spends two kinds of request: `/embeddings` over a corpus
 * that does not change between runs, and `/chat/completions` over
 * prompts that mostly do not either. Both are bought again on every
 * run unless something remembers them, and the request ceiling
 * (`TANGLE_AI_MAX_CALLS`) makes that memory worth money: embedding the
 * LoCoMo turns alone is 24 of 200 requests, and a row that lost nine
 * answers to a rate limit costs a whole run to fill in.
 *
 * So this file keeps both in one SQLite file, through `@jarenjs/db`'s
 * `openStore` exactly as the desktop opens its own store — no new
 * dependency, either runtime — and it keeps AS MUCH AS POSSIBLE: an
 * embedding row carries the text it embedded beside its vector, a
 * completion row carries the whole request and the whole reply with the
 * provider's usage and the call's wall time. The cache is therefore
 * also the audit trail of every live call this repository ever made:
 * the published reports hold numbers, the cache holds the answers.
 *
 * Three rules keep it honest:
 *
 *  - **A key is the whole identity of what was asked.** An embedding is
 *    keyed by the embedder's model and the text's hash; a completion by
 *    the provider, the base URL, the model, the messages, the response
 *    format, the thinking control, the sampling knobs — everything the
 *    wire sends except the credential, which is never stored. Two
 *    requests that could answer differently never share a row.
 *  - **A replay is counted, never hidden.** A completion served from
 *    here comes back marked `replayed`, with the wall time of the call
 *    that bought it, so an instrument can print how many of a row's
 *    answers were fresh spend and how many were remembered. The run's
 *    budget account is charged only for wire calls.
 *  - **It can be deleted at any moment.** It is a pure accelerator under
 *    `benchmark/cache/` (gitignored — the rows are derived from a
 *    CC BY-NC corpus and grow to tens of megabytes): `rm -rf
 *    benchmark/cache` starts fresh, and `--fresh` on an instrument
 *    ignores what is there while still writing what it buys.
 */

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Embedder } from '@jarenjs/ai/embed';
import { openStore, type Collection, type OpenStoreOptions, type Store } from '@jarenjs/db';
import { bunDriver } from '@jarenjs/db/bun';
import { nodeDriver } from '@jarenjs/db/node';
import { canonicalSha256 } from '@jarenjs/json/canonical';

/** Where the cache lives, relative to the repository root. Gitignored. */
export const WIRE_CACHE_PATH = 'benchmark/cache/wire.sqlite';

const ID = { type: 'string', minLength: 1 } as const;

/** The cache's `jaren-model`: two collections, keyed by their content identity. */
export const WIRE_CACHE_MODEL = {
  $model: '0.1',
  collections: {
    embeddings: {
      schema: {
        type: 'object',
        required: ['key', 'model', 'dims', 'hash', 'chars', 'text', 'vector', 'at'],
        properties: {
          key: ID,
          model: { type: 'string' },
          dims: { type: 'integer' },
          hash: { type: 'string' },
          chars: { type: 'integer' },
          text: { type: 'string' },
          /** The Float32 vector, little-endian, base64 — 5.5 KB for 1,024 dims where JSON digits would be 18 KB. */
          vector: { type: 'string' },
          at: { type: 'string' },
        },
      },
      key: '/key',
    },
    completions: {
      schema: {
        type: 'object',
        required: ['key', 'provider', 'model', 'request', 'reply', 'usage', 'ms', 'at'],
        properties: {
          key: ID,
          provider: { type: 'string' },
          model: { type: 'string' },
          request: { type: 'object' },
          reply: { type: 'object' },
          usage: {},
          ms: { type: 'number' },
          at: { type: 'string' },
        },
      },
      key: '/key',
    },
  },
} as const;

/** One remembered embedding. */
export interface EmbeddingRow {
  key: string;
  model: string;
  dims: number;
  hash: string;
  chars: number;
  text: string;
  vector: string;
  at: string;
}

/** One remembered completion: what was asked, what came back, what it cost. */
export interface CompletionRow {
  key: string;
  provider: string;
  model: string;
  /** The request as sent, credential-free: messages, response format, thinking control, sampling knobs. */
  request: Record<string, unknown>;
  /** The client's result — `message`, `finishReason`, `usage`, whatever else it carried — JSON only. */
  reply: Record<string, unknown>;
  usage: unknown;
  /** Wall time of the call that bought it. */
  ms: number;
  at: string;
}

/** The identity of a chat endpoint, without its credential. */
export interface EndpointIdentity {
  provider: string;
  base?: string;
  model: string;
}

export interface WireCache {
  path: string;
  embeddings: {
    /** One lookup per text; `undefined` where the cache holds nothing for this model. */
    get(model: string, texts: readonly string[]): Promise<Array<Float32Array | undefined>>;
    put(model: string, dims: number, texts: readonly string[], vectors: ReadonlyArray<ArrayLike<number>>): Promise<void>;
  };
  completions: {
    /** The key one request has under one endpoint — the same request keys the same row on every host. */
    key(endpoint: EndpointIdentity, request: Record<string, unknown>): Promise<string>;
    get(key: string): Promise<CompletionRow | undefined>;
    put(row: CompletionRow): Promise<void>;
  };
  /** How much is remembered. */
  stats(): Promise<{ embeddings: number, completions: number }>;
  close(): Promise<void>;
}

export interface OpenWireCacheOptions {
  /** The SQLite file; the directory is created. `:memory:` for a cache that lives one process. */
  path?: string;
  /** Driver override (tests inject `nodeDriver()` explicitly). */
  driver?: OpenStoreOptions['driver'];
  /** The instant a row is stamped with; injected so a test can pin it. */
  clock?: () => Date;
}

function pickDriver(): OpenStoreOptions['driver'] {
  return typeof process !== 'undefined' && process.versions?.bun !== undefined ? bunDriver() : nodeDriver();
}

/** SHA-256 over the UTF-8 text — the embedding key's content half. */
export function textHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The embedding row's key: the embedder's model and the text's hash. */
export function embeddingKey(model: string, text: string): string {
  return `${model} ${textHash(text)}`;
}

/** A Float32 vector as base64 of its little-endian bytes. */
export function encodeVector(vector: ArrayLike<number>): string {
  const floats = vector instanceof Float32Array ? vector : Float32Array.from(vector);
  const bytes = new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
  return Buffer.from(bytes).toString('base64');
}

/** The vector back, exactly the floats that were stored. */
export function decodeVector(encoded: string): Float32Array {
  const bytes = Buffer.from(encoded, 'base64');
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

/** The request members that decide a reply. Never the signal, the stream flag or a callback. */
const KEYED_REQUEST_MEMBERS = ['messages', 'responseFormat', 'reasoning', 'temperature', 'maxTokens', 'tools', 'toolChoice', 'model'] as const;

/** The credential-free, JSON-only view of a request — what is keyed and what is stored. */
export function keyedRequest(request: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const member of KEYED_REQUEST_MEMBERS) if (request[member] !== undefined) out[member] = request[member];
  return out;
}

/** The completion row's key: SHA-256 over the canonical JSON of the endpoint identity and the keyed request. */
export async function completionKey(endpoint: EndpointIdentity, request: Record<string, unknown>): Promise<string> {
  return canonicalSha256({
    provider: endpoint.provider,
    base: endpoint.base ?? '',
    model: endpoint.model,
    request: keyedRequest(request),
  });
}

/** A reply as JSON — a client result may carry nothing else, but the cache states it. */
function jsonOnly<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const LIST_KEYS = { $for: { r: '$[*]' }, $return: '$r.key' };

/** The engine's `SequenceResult`: nothing, one, or many. */
function countOf(result: unknown): number {
  if (result === undefined || result === null) return 0;
  return Array.isArray(result) ? result.length : 1;
}

/** Open (or create) the cache. */
export async function openWireCache(options: OpenWireCacheOptions = {}): Promise<WireCache> {
  const path = options.path ?? WIRE_CACHE_PATH;
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const clock = options.clock ?? ((): Date => new Date());
  const store: Store = await openStore(WIRE_CACHE_MODEL, { driver: options.driver ?? pickDriver(), path });
  const embeddings: Collection<EmbeddingRow> = store.collection<EmbeddingRow>('embeddings');
  const completions: Collection<CompletionRow> = store.collection<CompletionRow>('completions');

  return {
    path,
    embeddings: {
      async get(model, texts) {
        const out: Array<Float32Array | undefined> = [];
        for (const text of texts) {
          const row = await embeddings.get(embeddingKey(model, text));
          out.push(row === undefined ? undefined : decodeVector(row.vector));
        }
        return out;
      },
      async put(model, dims, texts, vectors) {
        if (texts.length !== vectors.length) throw new Error(`wire cache: ${texts.length} texts against ${vectors.length} vectors`);
        const at = clock().toISOString();
        for (let i = 0; i < texts.length; i++) {
          await embeddings.put({
            key: embeddingKey(model, texts[i]),
            model,
            dims,
            hash: textHash(texts[i]),
            chars: texts[i].length,
            text: texts[i],
            vector: encodeVector(vectors[i]),
            at,
          });
        }
      },
    },
    completions: {
      key: completionKey,
      async get(key) {
        return completions.get(key);
      },
      async put(row) {
        await completions.put({ ...row, request: jsonOnly(row.request), reply: jsonOnly(row.reply), usage: jsonOnly(row.usage ?? null) });
      },
    },
    async stats() {
      return {
        embeddings: countOf(await embeddings.execute(LIST_KEYS)),
        completions: countOf(await completions.execute(LIST_KEYS)),
      };
    },
    async close() {
      await store.close();
    },
  };
}

// ---------------------------------------------------------------------------
// the wrappers an instrument puts its wires behind
// ---------------------------------------------------------------------------

/** What every chat client this workspace meters looks like. */
export interface WireChatClient {
  endpoint: { provider: string, base?: string, model: string } & Record<string, unknown>;
  complete: (request: any) => Promise<any>;
}

/** A chat client that remembers: `cached` says whether a request would be a replay, `complete` replays or buys and remembers. */
export interface CachingChatClient extends WireChatClient {
  cached(request: Record<string, unknown>): Promise<boolean>;
}

export interface CachedClientOptions {
  /** Ignore what is remembered (still remember what is bought). */
  fresh?: boolean;
  /** The client's own defaults that the request may not restate — the thinking control above all — so two clients that differ only there never share a row. */
  defaults?: { reasoning?: unknown, temperature?: number, maxTokens?: number };
  /** Milliseconds, for the wall time a bought reply is remembered with. */
  timer?: () => number;
  clock?: () => Date;
}

/** A reply served from the cache, marked so a meter can count it and read the wall time of the call that bought it. */
export interface ReplayedReply { replayed: true, replayedMs: number }

/**
 * Put a chat client behind the cache. The endpoint's identity is read
 * off the client (`provider`, `base`, `model`) — never its headers, which
 * carry the credential.
 */
export function cachedChatClient<C extends WireChatClient>(client: C, cache: WireCache, options: CachedClientOptions = {}): C & CachingChatClient {
  const identity: EndpointIdentity = { provider: client.endpoint.provider, base: client.endpoint.base, model: client.endpoint.model };
  const timer = options.timer ?? ((): number => performance.now());
  const clock = options.clock ?? ((): Date => new Date());
  const withDefaults = (request: Record<string, unknown>): Record<string, unknown> => ({
    ...request,
    ...(request.reasoning === undefined && options.defaults?.reasoning !== undefined ? { reasoning: options.defaults.reasoning } : {}),
    ...(request.temperature === undefined && options.defaults?.temperature !== undefined ? { temperature: options.defaults.temperature } : {}),
    ...(request.maxTokens === undefined && options.defaults?.maxTokens !== undefined ? { maxTokens: options.defaults.maxTokens } : {}),
  });
  const keyOf = (request: Record<string, unknown>): Promise<string> => cache.completions.key(identity, withDefaults(request));

  const wrapped: CachingChatClient = {
    endpoint: client.endpoint,
    async cached(request) {
      if (options.fresh === true) return false;
      return (await cache.completions.get(await keyOf(request))) !== undefined;
    },
    async complete(request: Record<string, unknown>) {
      const key = await keyOf(request);
      if (options.fresh !== true) {
        const hit = await cache.completions.get(key);
        if (hit !== undefined) return { ...hit.reply, usage: hit.usage, replayed: true, replayedMs: hit.ms } as Record<string, unknown> & ReplayedReply;
      }
      const started = timer();
      const reply = await client.complete(request);
      const ms = timer() - started;
      await cache.completions.put({
        key,
        provider: identity.provider,
        model: identity.model,
        request: keyedRequest(withDefaults(request)),
        reply: jsonOnly(reply),
        usage: reply?.usage ?? null,
        ms,
        at: clock().toISOString(),
      });
      return reply;
    },
  };
  // the client's own members travel (a host may hang more than `endpoint` and `complete` on one); the two that matter are replaced
  return { ...client, ...wrapped } as C & CachingChatClient;
}

/** Whether a reply came from the cache. */
export function isReplayed(reply: unknown): reply is Record<string, unknown> & ReplayedReply {
  return typeof reply === 'object' && reply !== null && (reply as { replayed?: unknown }).replayed === true;
}

/**
 * Put an embedder behind the cache: known texts come from the file,
 * the rest from the wire in one request per call, and what the wire
 * answered is remembered. `stats` counts what each call did, so an
 * instrument that meters the wire can charge only what was bought.
 */
export function cachedEmbedder(wire: Embedder, cache: WireCache, options: { fresh?: boolean } = {}): Embedder & { stats: { requests: number, hits: number, misses: number } } {
  const stats = { requests: 0, hits: 0, misses: 0 };
  return {
    model: wire.model,
    dims: wire.dims,
    stats,
    async embed(texts, hooks) {
      const known = options.fresh === true ? texts.map(() => undefined) : await cache.embeddings.get(wire.model, texts);
      const out: Float32Array[] = new Array(texts.length);
      const missing: number[] = [];
      known.forEach((vector, i) => { if (vector === undefined) missing.push(i); else out[i] = vector; });
      stats.hits += texts.length - missing.length;
      stats.misses += missing.length;
      if (missing.length > 0) {
        stats.requests++;
        const vectors = await wire.embed(missing.map((i) => texts[i]), hooks);
        const dims = wire.dims ?? vectors[0]?.length ?? 0;
        await cache.embeddings.put(wire.model, dims, missing.map((i) => texts[i]), vectors);
        missing.forEach((i, j) => { out[i] = vectors[j]; });
      }
      return out;
    },
  };
}
