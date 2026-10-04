import { createBoundedCache } from '@jarenjs/core/cache';
import { createScheduler } from '@jarenjs/core/schedule';
import { DocumentError } from './contracts.ts';
import { assertPublicUrl, normalizeUrl, type UrlPolicyOptions } from './url-policy.ts';

export interface StaticFetchLimits {
  timeoutMs: number;
  maxRedirects: number;
  maxCompressedBytes: number;
  maxBytes: number;
  concurrency: number;
  perHostDelayMs: number;
  respectRobots: boolean;
  userAgent: string;
}

export const DEFAULT_FETCH_LIMITS: StaticFetchLimits = {
  timeoutMs: 20_000,
  maxRedirects: 5,
  maxCompressedBytes: 8 * 1024 * 1024,
  maxBytes: 24 * 1024 * 1024,
  concurrency: 4,
  perHostDelayMs: 250,
  respectRobots: true,
  userAgent: 'TangleAI-DocumentBot/0.1 (+local document ingestion)',
};

export interface FetchValidators {
  etag?: string;
  lastModified?: string;
}

export type AdmissionDecision = { admitted: true; tier?: string; ruleId?: string } | { admitted: false; reason: string };

export interface StaticFetchOptions extends UrlPolicyOptions {
  fetch?: typeof globalThis.fetch;
  /** Admission clock and sleep, injectable for deterministic hosts. */
  schedule?: Pick<NonNullable<Parameters<typeof createScheduler>[0]>, 'now' | 'sleep' | 'maxQueue' | 'maxScopes'>;
  limits?: Partial<StaticFetchLimits>;
  now?: () => string;
  /** Checked after public-URL validation for every document hop and auxiliary robots request. */
  admission?: (url: string, hop: number) => AdmissionDecision | Promise<AdmissionDecision>;
  /** Optional host policy for sites whose terms have been reviewed out of band. */
  termsPolicy?: (url: string) => boolean | Promise<boolean>;
  /** Counts every body chunk delivered, including robots and a chunk exceeding its cap. */
  onBytesRead?: (bytes: number) => void;
}

/** Host-only request narrowing; machine search APIs may explicitly skip robots. */
export interface StaticFetchRequestOptions {
  maxBytes?: number;
  respectRobots?: boolean;
}

export interface StaticFetchResult {
  status: 'ok' | 'not-modified';
  requestedUrl: string;
  finalUrl: string;
  mimeType?: string;
  bytes?: Uint8Array;
  fetchedAt: string;
  etag?: string;
  lastModified?: string;
  responseStatus: number;
  /** Redirect target URLs in the order they were followed. */
  redirects?: string[];
}

function contentType(value: string | null): string | undefined {
  return value?.split(';', 1)[0]?.trim().toLowerCase() || undefined;
}

function asciiPrefix(bytes: Uint8Array, length = 1024): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, Math.min(length, bytes.length))).trimStart().toLowerCase();
}

export function sniffMime(bytes: Uint8Array, declared?: string): string {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-') return 'application/pdf';
  const prefix = asciiPrefix(bytes);
  if (/^(?:<!doctype\s+html|<html\b|<head\b|<body\b|<article\b)/i.test(prefix)) return 'text/html';
  if (declared === 'text/html' || declared === 'application/xhtml+xml') return 'text/html';
  if (declared === 'text/markdown' || declared === 'text/x-markdown') return 'text/markdown';
  if (declared?.startsWith('text/')) return 'text/plain';
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let suspicious = 0;
  for (const byte of sample) if (byte === 0 || (byte < 9) || (byte > 13 && byte < 32)) suspicious++;
  if (sample.length === 0 || suspicious / sample.length < 0.01) return 'text/plain';
  throw new DocumentError('unsupported-mime', `Unsupported document MIME type${declared === undefined ? '' : `: ${declared}`}`);
}

/** Shared bounded reader for fetch and capture; count delivered chunks before enforcing the ceiling. */
export async function readBoundedResponseBytes(response: Response, maxBytes: number, onBytesRead?: (bytes: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('A response byte ceiling must be a nonnegative integer.');
  signal?.throwIfAborted();
  const body = response.body;
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) { signal?.throwIfAborted(); break; }
      total += item.value.byteLength;
      if (onBytesRead) {
        try { onBytesRead(item.value.byteLength); }
        catch (cause) { await reader.cancel(cause); throw new DocumentError('byte-budget-exhausted', 'The host transfer budget is exhausted.', { cause }); }
      }
      if (total > maxBytes) {
        await reader.cancel('document byte budget exceeded');
        throw new DocumentError('response-too-large', `Document exceeds the ${maxBytes}-byte decompressed limit`);
      }
      signal?.throwIfAborted();
      chunks.push(item.value);
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function abortContext(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; close(): void } {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DocumentError('fetch-timeout', `Fetch timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function robotsAllows(text: string, path: string, agent: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match === null) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === 'user-agent') {
      if (current === undefined || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((field === 'allow' || field === 'disallow') && current !== undefined && value !== '') {
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  const lowerAgent = agent.toLowerCase();
  const matches = groups.filter((group) => group.agents.some((item) => item === '*' || lowerAgent.includes(item)));
  let winner: { allow: boolean; path: string } | undefined;
  for (const rule of matches.flatMap((group) => group.rules)) {
    const pattern = rule.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\$$/, '$');
    if (new RegExp(`^${pattern}`).test(path) && (winner === undefined || rule.path.length > winner.path.length || (rule.path.length === winner.path.length && rule.allow))) {
      winner = rule;
    }
  }
  return winner?.allow ?? true;
}

export class SafeStaticFetcher {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly limits: StaticFetchLimits;
  private readonly policy: UrlPolicyOptions;
  private readonly scheduler: ReturnType<typeof createScheduler>;
  private readonly robots = createBoundedCache<string, Promise<string | undefined>>(256);
  private readonly now: () => string;
  private readonly termsPolicy?: StaticFetchOptions['termsPolicy'];
  private readonly admission?: StaticFetchOptions['admission'];
  private readonly onBytesRead?: StaticFetchOptions['onBytesRead'];

  constructor(options: StaticFetchOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.limits = { ...DEFAULT_FETCH_LIMITS, ...options.limits };
    this.policy = { allowPrivate: options.allowPrivate, lookup: options.lookup };
    this.scheduler = createScheduler({ ...options.schedule, concurrency: this.limits.concurrency, spacingMs: this.limits.perHostDelayMs });
    this.now = options.now ?? ((): string => new Date().toISOString());
    this.termsPolicy = options.termsPolicy;
    this.admission = options.admission;
    this.onBytesRead = options.onBytesRead;
  }

  /** Stop queued requests and drain admitted bodies before releasing host resources. */
  async close(): Promise<void> { await this.scheduler.close(); this.robots.clear(); }

  private async admit(input: string, hop: number, redirects: readonly string[] = []): Promise<string> {
    const url = await assertPublicUrl(input, this.policy);
    if (this.admission) {
      const decision = await this.admission(url, hop);
      if (!decision || decision.admitted !== true) {
        throw new DocumentError('policy-denied', 'The document destination is outside the admitted policy.', {
          reason: decision && decision.admitted === false ? decision.reason : 'Invalid admission result.', hop, url, redirects: [...redirects],
        });
      }
    }
    return url;
  }

  private request(url: string, init: RequestInit, maxBytes: number): Promise<{ response: Response; bytes?: Uint8Array }> {
    return this.scheduler.run(async () => {
      const response = await this.fetchImpl(url, init);
      if (!response.ok || response.status === 304) {
        await response.body?.cancel();
        return { response };
      }
      const compressed = Number(response.headers.get('content-length'));
      if (Number.isFinite(compressed) && compressed > this.limits.maxCompressedBytes) {
        await response.body?.cancel();
        throw new DocumentError('response-too-large', `Document exceeds the ${this.limits.maxCompressedBytes}-byte transfer limit`);
      }
      return { response, bytes: await readBoundedResponseBytes(response, maxBytes, this.onBytesRead) };
    }, { scope: new URL(url).host, signal: init.signal ?? undefined });
  }

  private async robotsText(url: URL, signal: AbortSignal): Promise<string | undefined> {
    const origin = url.origin;
    let pending = this.robots.get(origin);
    if (pending === undefined) {
      pending = (async () => {
        const robotsUrl = await this.admit(new URL('/robots.txt', origin).toString(), 0);
        try {
          const { response, bytes } = await this.request(robotsUrl, {
            headers: { 'user-agent': this.limits.userAgent, accept: 'text/plain' },
            redirect: 'manual',
            signal,
          }, 128 * 1024);
          if (!response.ok) return undefined;
          return new TextDecoder().decode(bytes);
        } catch (error) {
          if (signal.aborted || error instanceof DocumentError && error.code === 'byte-budget-exhausted') throw error;
          return undefined;
        }
      })();
      this.robots.set(origin, pending);
      void pending.catch(() => { if (this.robots.get(origin) === pending) this.robots.delete(origin); });
    }
    return pending;
  }

  async fetch(urlInput: string, validators: FetchValidators = {}, signal?: AbortSignal, options: StaticFetchRequestOptions = {}): Promise<StaticFetchResult> {
    const requestedUrl = normalizeUrl(urlInput);
    const maxBytes = options.maxBytes ?? this.limits.maxBytes;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > this.limits.maxBytes)
      throw new DocumentError('invalid-fetch-budget', 'A request byte cap must be finite and cannot widen the fetcher limit.');
    const respectRobots = options.respectRobots ?? this.limits.respectRobots;
    const abort = abortContext(signal, this.limits.timeoutMs);
    const redirectUrls: string[] = [];
    try {
      let current = requestedUrl;
      for (let redirects = 0; redirects <= this.limits.maxRedirects; redirects++) {
        current = await this.admit(current, redirects, redirectUrls);
        if (this.termsPolicy !== undefined && !await this.termsPolicy(current)) {
          throw new DocumentError('terms-denied', `Document fetch is not permitted by the configured terms policy for ${new URL(current).origin}`);
        }
        const parsed = new URL(current);
        if (respectRobots) {
          const robots = await this.robotsText(parsed, abort.signal);
          if (robots !== undefined && !robotsAllows(robots, `${parsed.pathname}${parsed.search}`, this.limits.userAgent)) {
            throw new DocumentError('robots-denied', `robots.txt disallows ${parsed.pathname}`);
          }
        }
        const headers: Record<string, string> = {
          'user-agent': this.limits.userAgent,
          accept: 'text/html,application/xhtml+xml,application/pdf,text/markdown,text/plain;q=0.9,*/*;q=0.1',
        };
        if (validators.etag !== undefined) headers['if-none-match'] = validators.etag;
        if (validators.lastModified !== undefined) headers['if-modified-since'] = validators.lastModified;
        const { response, bytes } = await this.request(current, { headers, redirect: 'manual', signal: abort.signal }, maxBytes);
        if (response.status === 304) {
          return {
            status: 'not-modified', requestedUrl, finalUrl: current, fetchedAt: this.now(), redirects: [...redirectUrls],
            responseStatus: response.status, etag: response.headers.get('etag') ?? validators.etag,
            lastModified: response.headers.get('last-modified') ?? validators.lastModified,
          };
        }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (location === null) throw new DocumentError('bad-redirect', `Redirect ${response.status} has no Location header`);
          if (redirects === this.limits.maxRedirects) throw new DocumentError('too-many-redirects', 'Document exceeded the redirect limit');
          current = normalizeUrl(new URL(location, current).toString());
          redirectUrls.push(current);
          continue;
        }
        if (!response.ok) throw new DocumentError('fetch-failed', `Document fetch returned HTTP ${response.status}`, { status: response.status });
        const mimeType = sniffMime(bytes!, contentType(response.headers.get('content-type')));
        return {
          status: 'ok', requestedUrl, finalUrl: current, mimeType, bytes, fetchedAt: this.now(), redirects: [...redirectUrls],
          responseStatus: response.status, etag: response.headers.get('etag') ?? undefined,
          lastModified: response.headers.get('last-modified') ?? undefined,
        };
      }
      throw new DocumentError('too-many-redirects', 'Document exceeded the redirect limit');
    } catch (error) {
      if (abort.signal.aborted && !(error instanceof DocumentError)) {
        throw abort.signal.reason instanceof DocumentError
          ? abort.signal.reason : new DocumentError('fetch-aborted', 'Document fetch was aborted');
      }
      throw error;
    } finally {
      abort.close();
    }
  }
}
