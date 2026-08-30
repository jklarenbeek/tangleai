/**
 * The live instruments' durable adapter for JarenJS's replay-cache seam.
 *
 * JarenJS owns request normalization, canonical replay keys, partial
 * embedding hits, replay marking and malformed-entry refusal. Tangle owns
 * the SQLite persistence and audit trail. The client hands this adapter the
 * complete credential-free semantic key; the database keys it by SHA-256 and
 * keeps the full string beside the digest so a collision is always a miss.
 *
 * The two pre-0.56 collections remain declared because the paid 63 MB cache is
 * useful audit material. Their keys did not include the full resolved endpoint,
 * so serving them through the stricter 0.56 contract would be unsafe. New
 * purchases go only to `replays`; legacy row counts are reported separately.
 */

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { openStore, type Collection, type OpenStoreOptions, type Store } from '@jarenjs/db';
import { bunDriver } from '@jarenjs/db/bun';
import { nodeDriver } from '@jarenjs/db/node';
import { canonicalSha256 } from '@jarenjs/json/canonical';

/** Where the cache lives, relative to the repository root. Gitignored. */
export const WIRE_CACHE_PATH = 'benchmark/cache/wire.sqlite';

const ID = { type: 'string', minLength: 1 } as const;

/**
 * The cache model. `embeddings` and `completions` are the read-only legacy
 * tables; `replays` and `embedding_replays` implement the 0.56 seam.
 */
export const WIRE_CACHE_MODEL = {
  $model: '0.1',
  collections: {
    embeddings: {
      schema: {
        type: 'object',
        required: ['key', 'model', 'dims', 'hash', 'chars', 'text', 'vector', 'at'],
        properties: {
          key: ID, model: { type: 'string' }, dims: { type: 'integer' },
          hash: { type: 'string' }, chars: { type: 'integer' }, text: { type: 'string' },
          vector: { type: 'string' }, at: { type: 'string' },
        },
      },
      key: '/key',
    },
    completions: {
      schema: {
        type: 'object',
        required: ['key', 'provider', 'model', 'request', 'reply', 'usage', 'ms', 'at'],
        properties: {
          key: ID, provider: { type: 'string' }, model: { type: 'string' },
          request: { type: 'object' }, reply: { type: 'object' }, usage: {},
          ms: { type: 'number' }, at: { type: 'string' },
        },
      },
      key: '/key',
    },
    replays: {
      schema: {
        type: 'object',
        required: ['key', 'requestKey', 'wire', 'provider', 'base', 'model', 'request', 'entry', 'at'],
        properties: {
          key: ID,
          requestKey: ID,
          wire: { type: 'string' },
          provider: { type: 'string' },
          base: { type: 'string' },
          model: { type: 'string' },
          request: {},
          entry: {},
          at: { type: 'string' },
        },
      },
      key: '/key',
    },
    embedding_replays: {
      schema: {
        type: 'object',
        required: ['key', 'provider', 'base', 'model', 'text', 'replayKey'],
        properties: {
          key: ID,
          provider: { type: 'string' },
          base: { type: 'string' },
          model: { type: 'string' },
          text: { type: 'string' },
          replayKey: ID,
        },
      },
      key: '/key',
    },
  },
} as const;

/** The structural cache contract accepted by both JarenJS wire clients. */
export interface ReplayCache {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown): void | Promise<void>;
}

interface ReplayRow {
  /** SHA-256 of `requestKey`. */
  key: string;
  /** The complete JarenJS semantic key, retained to detect a hash collision. */
  requestKey: string;
  wire: string;
  provider: string;
  base: string;
  model: string;
  request: unknown;
  /** Chat entry verbatim; embedding vectors are packed as Float32 base64. */
  entry: unknown;
  at: string;
}

interface EmbeddingReplayRow {
  key: string;
  provider: string;
  base: string;
  model: string;
  text: string;
  replayKey: string;
}

interface ReplayIdentity {
  wire: string;
  provider: string;
  base: string;
  model: string;
  request: Record<string, unknown>;
}

export interface ReplayEndpoint {
  provider: string;
  base: string;
  model: string;
}

export interface WireCacheStats {
  embeddings: number;
  completions: number;
  legacyEmbeddings: number;
  legacyCompletions: number;
}

export interface WireCache extends ReplayCache {
  path: string;
  /** A view for one run. Fresh reads miss while purchases are still stored. */
  adapter(options?: { fresh?: boolean }): ReplayCache;
  /** Exact endpoint-aware embedding hits used by the spend preflight. */
  embeddingHits(endpoint: ReplayEndpoint, texts: readonly string[]): Promise<Array<Float32Array | undefined>>;
  stats(): Promise<WireCacheStats>;
  close(): Promise<void>;
}

export interface OpenWireCacheOptions {
  path?: string;
  driver?: OpenStoreOptions['driver'];
  clock?: () => Date;
}

function pickDriver(): OpenStoreOptions['driver'] {
  return typeof process !== 'undefined' && process.versions?.bun !== undefined ? bunDriver() : nodeDriver();
}

/** SHA-256 of the complete client-owned replay key. */
export function replayDigest(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
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

function jsonOnly<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Actual client keys are JSON-compatible; an exotic semantic token stays auditable but unclassified. */
function identityOf(key: string): ReplayIdentity {
  try {
    const parsed = record(JSON.parse(key));
    const request = record(parsed?.request);
    const wire = typeof parsed?.wire === 'string' ? parsed.wire : 'unknown';
    return {
      wire,
      provider: typeof parsed?.provider === 'string' ? parsed.provider : '',
      base: typeof parsed?.base === 'string' ? parsed.base : '',
      model: typeof request?.model === 'string' ? request.model : '',
      request: request ?? {},
    };
  } catch {
    return { wire: 'unknown', provider: '', base: '', model: '', request: {} };
  }
}

function packedEntry(wire: string, value: unknown): unknown {
  const entry = record(value);
  if (wire !== 'embeddings' || !Array.isArray(entry?.vector)) return jsonOnly(value);
  return { ...entry, vector: encodeVector(entry.vector as number[]), encoding: 'float32-base64' };
}

function unpackedEntry(wire: string, value: unknown): unknown {
  const entry = record(value);
  if (wire !== 'embeddings' || entry?.encoding !== 'float32-base64' || typeof entry.vector !== 'string') return jsonOnly(value);
  const { encoding: _encoding, ...rest } = entry;
  return { ...rest, vector: [...decodeVector(entry.vector)] };
}

const LIST_KEYS = { $for: { r: '$[*]' }, $return: '$r.key' };

function countOf(result: unknown): number {
  if (result === undefined || result === null) return 0;
  return Array.isArray(result) ? result.length : 1;
}

async function embeddingLookupKey(endpoint: ReplayEndpoint, text: string): Promise<string> {
  // Auxiliary database index only. Reply identity remains the complete key
  // constructed and supplied by JarenJS.
  return canonicalSha256([endpoint.provider, endpoint.base, endpoint.model, text]);
}

/** Open (or create) the SQLite replay adapter. */
export async function openWireCache(options: OpenWireCacheOptions = {}): Promise<WireCache> {
  const path = options.path ?? WIRE_CACHE_PATH;
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const clock = options.clock ?? ((): Date => new Date());
  const store: Store = await openStore(WIRE_CACHE_MODEL, { driver: options.driver ?? pickDriver(), path });
  const legacyEmbeddings = store.collection('embeddings');
  const legacyCompletions = store.collection('completions');
  const replays: Collection<ReplayRow> = store.collection<ReplayRow>('replays');
  const embeddingReplays: Collection<EmbeddingReplayRow> = store.collection<EmbeddingReplayRow>('embedding_replays');

  const get = async (requestKey: string): Promise<unknown> => {
    const row = await replays.get(replayDigest(requestKey));
    if (row === undefined || row.requestKey !== requestKey) return undefined;
    return unpackedEntry(row.wire, row.entry);
  };

  const set = async (requestKey: string, value: unknown): Promise<void> => {
    const identity = identityOf(requestKey);
    const key = replayDigest(requestKey);
    await replays.put({
      key,
      requestKey,
      ...identity,
      entry: packedEntry(identity.wire, value),
      at: clock().toISOString(),
    });
    const text = identity.wire === 'embeddings' && typeof identity.request.input === 'string'
      ? identity.request.input
      : null;
    if (text !== null) {
      const endpoint = { provider: identity.provider, base: identity.base, model: identity.model };
      await embeddingReplays.put({
        key: await embeddingLookupKey(endpoint, text),
        ...endpoint,
        text,
        replayKey: key,
      });
    }
  };

  return {
    path,
    get,
    set,
    adapter({ fresh = false } = {}) {
      return fresh ? { get: () => undefined, set } : { get, set };
    },
    async embeddingHits(endpoint, texts) {
      const out: Array<Float32Array | undefined> = [];
      for (const text of texts) {
        const index = await embeddingReplays.get(await embeddingLookupKey(endpoint, text));
        if (index === undefined || index.provider !== endpoint.provider || index.base !== endpoint.base
          || index.model !== endpoint.model || index.text !== text) {
          out.push(undefined);
          continue;
        }
        const row = await replays.get(index.replayKey);
        if (row === undefined || row.wire !== 'embeddings'
          || row.provider !== endpoint.provider || row.base !== endpoint.base
          || row.model !== endpoint.model || record(row.request)?.input !== text) {
          out.push(undefined);
          continue;
        }
        const entry = record(unpackedEntry(row.wire, row.entry));
        const vector = entry?.vector;
        out.push(Array.isArray(vector) && vector.length > 0 && vector.every(Number.isFinite)
          ? Float32Array.from(vector as number[])
          : undefined);
      }
      return out;
    },
    async stats() {
      const embeddings = countOf(await embeddingReplays.execute(LIST_KEYS));
      const total = countOf(await replays.execute(LIST_KEYS));
      return {
        embeddings,
        completions: Math.max(0, total - embeddings),
        legacyEmbeddings: countOf(await legacyEmbeddings.execute(LIST_KEYS)),
        legacyCompletions: countOf(await legacyCompletions.execute(LIST_KEYS)),
      };
    },
    async close() {
      await store.close();
    },
  };
}
