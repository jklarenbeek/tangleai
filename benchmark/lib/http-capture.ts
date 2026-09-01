/**
 * The benchmark-owned exact HTTP capture — how a dynamic web row stays
 * a measurement instead of a memory.
 *
 * The adapter wraps an INJECTED `fetch` — never `SafeStaticFetcher`'s
 * internals — and records, per credential-free request, exactly what
 * arrived: status, the ordered response headers extraction depends on,
 * the exact body bytes with their SHA-256, sizes, an attempt index and
 * the captured-at clock; a request that produced no response records
 * its failure code instead. The safe fetcher follows redirects itself
 * (`redirect: 'manual'`), so each hop is its own captured request and a
 * replayed redirect chain walks exactly as the live one did.
 *
 * Replay serves a fresh `Response` from the stored bytes and headers
 * and makes ZERO network calls: a missing or malformed capture is a
 * thrown named failure, never a fall-through request. Bodies stay in
 * the gitignored SQLite file; a report carries only the manifest —
 * urls, statuses, hashes, sizes — never a third-party body.
 *
 * This adapter does not create or reinterpret the JarenJS model replay
 * key: model calls keep the suite's client cache seam, and the capture
 * key here is canonical over `{ kind, method, url }` alone. A URL
 * carrying userinfo is refused before it can enter a key, a row or a
 * request.
 */

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { openStore, type Collection, type OpenStoreOptions, type Store } from '@jarenjs/db';
import { bunDriver } from '@jarenjs/db/bun';
import { nodeDriver } from '@jarenjs/db/node';
import { canonicalSha256 } from '@jarenjs/json/canonical';

/** Where the capture lives, relative to the repository root. Gitignored with the rest of `benchmark/cache/`. */
export const HTTP_CAPTURE_PATH = 'benchmark/cache/grounding-http.sqlite';

/** The response headers extraction and the safe fetcher read; nothing else is retained. */
export const CAPTURED_HEADERS = ['content-type', 'content-length', 'etag', 'last-modified', 'location'] as const;

export type CaptureKind = 'searxng' | 'document';

const CAPTURE_MODEL = {
  $model: '0.1',
  collections: {
    captures: {
      schema: {
        type: 'object',
        required: ['key', 'kind', 'method', 'url', 'attempt', 'at'],
        properties: {
          key: { type: 'string', minLength: 1 },
          kind: { type: 'string' },
          method: { type: 'string' },
          url: { type: 'string' },
          status: { type: 'integer' },
          headers: { type: 'array' },
          bodyBase64: { type: 'string' },
          bodySha256: { type: 'string' },
          requestBytes: { type: 'integer' },
          responseBytes: { type: 'integer' },
          attempt: { type: 'integer' },
          at: { type: 'string' },
          failure: { type: 'object' },
        },
      },
      key: '/key',
    },
  },
} as const;

interface CaptureRow {
  key: string;
  kind: CaptureKind;
  method: string;
  url: string;
  status?: number;
  headers?: Array<[string, string]>;
  bodyBase64?: string;
  bodySha256?: string;
  requestBytes?: number;
  responseBytes?: number;
  attempt: number;
  at: string;
  failure?: { code: string, message: string };
}

/** One manifest row a report may carry — hashes and sizes, never a body. */
export interface CaptureManifestRow {
  kind: CaptureKind;
  method: 'GET';
  url: string;
  status: number | null;
  bodySha256: string | null;
  responseBytes: number | null;
  attempt: number;
  failure: { code: string, message: string } | null;
}

export interface CaptureStats {
  captures: number;
  replayHits: number;
  replayMisses: number;
}

export interface HttpCapture {
  path: string;
  /**
   * A fetch for one kind of traffic. `replay: false` records every
   * response (and every failure) through the inner transport;
   * `replay: true` serves exclusively from the store — the inner
   * transport is never touched, and a missing capture throws a named
   * failure the caller's own error path keeps as a value.
   */
  fetchFor(kind: CaptureKind, options: { replay: boolean, inner?: typeof globalThis.fetch }): typeof globalThis.fetch;
  manifest(): Promise<CaptureManifestRow[]>;
  stats(): CaptureStats;
  close(): Promise<void>;
}

function pickDriver(): OpenStoreOptions['driver'] {
  return typeof process !== 'undefined' && process.versions?.bun !== undefined ? bunDriver() : nodeDriver();
}

/** The canonical, credential-free capture key. Userinfo is refused, never hashed. */
export async function captureKeyOf(kind: CaptureKind, method: string, url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('a capture key may not cover a credential-bearing URL; credentials travel in no capture, manifest or report');
  }
  return canonicalSha256({ kind, method: method.toUpperCase(), url: parsed.toString() });
}

export interface OpenHttpCaptureOptions {
  path?: string;
  driver?: OpenStoreOptions['driver'];
  clock?: () => Date;
}

/** Open (or create) the SQLite HTTP capture. */
export async function openHttpCapture(options: OpenHttpCaptureOptions = {}): Promise<HttpCapture> {
  const path = options.path ?? HTTP_CAPTURE_PATH;
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const clock = options.clock ?? ((): Date => new Date());
  const store: Store = await openStore(CAPTURE_MODEL, { driver: options.driver ?? pickDriver(), path });
  const captures: Collection<CaptureRow> = store.collection<CaptureRow>('captures');
  const stats: CaptureStats = { captures: 0, replayHits: 0, replayMisses: 0 };

  return {
    path,
    fetchFor(kind, fetchOptions) {
      const inner = fetchOptions.inner ?? globalThis.fetch;
      if (fetchOptions.replay) {
        return (async (input: RequestInfo | URL): Promise<Response> => {
          const url = String(input);
          const key = await captureKeyOf(kind, 'GET', url);
          const row = await captures.get(key);
          if (row === undefined) {
            stats.replayMisses++;
            throw new Error(`no capture holds ${kind} GET ${url}; replay makes no network call and a missing capture is this named failure`);
          }
          if (row.failure !== undefined) {
            stats.replayHits++;
            throw new Error(`captured failure for ${kind} GET ${url}: ${row.failure.code} ${row.failure.message}`);
          }
          if (typeof row.status !== 'number' || typeof row.bodyBase64 !== 'string' || typeof row.bodySha256 !== 'string') {
            stats.replayMisses++;
            throw new Error(`the capture for ${kind} GET ${url} is malformed; refusing to serve it`);
          }
          const bytes = Buffer.from(row.bodyBase64, 'base64');
          const digest = createHash('sha256').update(bytes).digest('hex');
          if (digest !== row.bodySha256) {
            stats.replayMisses++;
            throw new Error(`the captured bytes for ${kind} GET ${url} no longer match their recorded digest`);
          }
          stats.replayHits++;
          return new Response(bytes.length === 0 ? null : new Uint8Array(bytes), {
            status: row.status,
            headers: Object.fromEntries(row.headers ?? []),
          });
        }) as typeof globalThis.fetch;
      }
      return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        const key = await captureKeyOf(kind, 'GET', url);
        const existing = await captures.get(key);
        const attempt = (existing?.attempt ?? 0) + 1;
        const base = {
          key,
          kind,
          method: 'GET',
          url,
          attempt,
          at: clock().toISOString(),
          requestBytes: typeof init?.body === 'string' ? init.body.length : 0,
        };
        let response: Response;
        try {
          response = await inner(input, init);
        } catch (error) {
          await captures.put({ ...base, failure: { code: 'transport', message: error instanceof Error ? error.message : String(error) } });
          stats.captures++;
          throw error;
        }
        const bytes = new Uint8Array(await response.clone().arrayBuffer());
        const headers: Array<[string, string]> = [];
        for (const name of CAPTURED_HEADERS) {
          const value = response.headers.get(name);
          if (value !== null) headers.push([name, value]);
        }
        await captures.put({
          ...base,
          status: response.status,
          headers,
          bodyBase64: Buffer.from(bytes).toString('base64'),
          bodySha256: createHash('sha256').update(bytes).digest('hex'),
          responseBytes: bytes.length,
        });
        stats.captures++;
        return response;
      }) as typeof globalThis.fetch;
    },
    async manifest() {
      const result = await captures.execute<CaptureRow>({ $for: { c: '$[*]' }, $return: '$c' });
      const rows = (Array.isArray(result) ? result : result === undefined || result === null ? [] : [result]) as CaptureRow[];
      return rows
        .map((row): CaptureManifestRow => ({
          kind: row.kind,
          method: 'GET',
          url: row.url,
          status: row.status ?? null,
          bodySha256: row.bodySha256 ?? null,
          responseBytes: row.responseBytes ?? null,
          attempt: row.attempt,
          failure: row.failure ?? null,
        }))
        .sort((a, b) => a.url.localeCompare(b.url) || a.kind.localeCompare(b.kind));
    },
    stats: () => ({ ...stats }),
    close: () => store.close(),
  };
}
