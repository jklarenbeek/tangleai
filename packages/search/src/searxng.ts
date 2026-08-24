/**
 * SearxNG JSON client — salvaged from the old tangleai (Perplexica fork)
 * `apps/scraper/src/utils/searxng.ts`, stripped to the part that earned
 * its keep. What fell away: the LangChain `Document` wrapper, the
 * xxhash id (a URL already identifies a result), the per-result
 * HEAD-probe for content type (a separate concern — the caller that
 * intends to FETCH a result can probe it), and the module-level config
 * read. What remains is one seam-shaped function: query in, results out.
 *
 * The docker-side half lives in `compose/searxng/` (settings.yml with
 * the JSON format enabled — SearxNG denies `format=json` by default, and
 * a 403 here usually means that setting is missing).
 */

import { callerError, transportError, payloadError } from '@tangleai/core/errors';

export interface SearxngResult {
  title: string;
  url: string;
  /** Result snippet. */
  content?: string;
  author?: string;
  img_src?: string;
  thumbnail?: string;
  iframe_src?: string;
}

export type SearxngCategory =
  | 'general' | 'images' | 'videos' | 'news' | 'map'
  | 'it' | 'science' | 'files' | 'social_media';

export interface SearxngSearchOptions {
  categories?: SearxngCategory;
  language?: string;
  pageno?: number;
  /** Comma-separated engine list. */
  engines?: string;
  time_range?: string;
}

export interface SearxngSearchOutcome {
  results: SearxngResult[];
  suggestions: string[];
}

export interface SearxngClient {
  search(query: string, options?: SearxngSearchOptions & { signal?: AbortSignal }): Promise<SearxngSearchOutcome>;
}

export interface SearxngClientOptions {
  /** e.g. `http://localhost:8080` */
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  /** Per-request budget, default 5000. */
  timeoutMs?: number;
}

export function createSearxngClient(options: SearxngClientOptions): SearxngClient {
  if (!options?.baseUrl) throw callerError('baseUrl is required');
  const doFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 5000;

  return {
    async search(query, { signal, ...searchOptions } = {}) {
      if (!query) throw callerError('query is required');

      const url = new URL(`${baseUrl}/search`);
      url.searchParams.set('format', 'json');
      url.searchParams.set('q', query);
      for (const [key, value] of Object.entries(searchOptions)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }

      const response = await doFetch(url.toString(), {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw transportError(
          `searxng answered HTTP ${response.status} — a 403 usually means format=json is not enabled in settings.yml`,
          { status: response.status },
        );
      }

      const payload: any = await response.json();
      if (!Array.isArray(payload?.results)) {
        throw payloadError('searxng reply carried no results array');
      }

      return {
        results: payload.results.map(normalizeResult),
        suggestions: Array.isArray(payload.suggestions) ? payload.suggestions as string[] : [],
      };
    },
  };
}

function normalizeResult(raw: any): SearxngResult {
  const result: SearxngResult = {
    title: collapseWhitespace(String(raw?.title ?? '')),
    url: String(raw?.url ?? ''),
  };
  if (raw?.content) result.content = collapseWhitespace(String(raw.content));
  if (raw?.author) result.author = String(raw.author);
  if (raw?.img_src) result.img_src = String(raw.img_src);
  if (raw?.thumbnail) result.thumbnail = String(raw.thumbnail);
  if (raw?.iframe_src) result.iframe_src = String(raw.iframe_src);
  return result;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
