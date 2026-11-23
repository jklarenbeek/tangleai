/**
 * The desktop's web reader: the `web_reader` provider contract a Tangle
 * desktop page calls, because a browser page cannot fetch most of the web
 * itself. A page is fetched by the store's safe static fetcher (public
 * addresses only, admission, robots, a byte cap, redirects followed and
 * checked) and comes back as readable blocks: never markup, never a script.
 * Search goes to the SearxNG the settings name.
 *
 * Served on its own path ({@link WEB_READER_PATH}) beside the desktop's API,
 * to the desktop's own page and to the published desktop at
 * {@link WEB_READER_ORIGINS}, and to nothing else.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { extractHtml, extractTextDocument, SafeStaticFetcher, type ExtractedDocument, type StaticFetchOptions } from '@tangleai/documents';
import { createSearxngClient } from '@tangleai/search';
import type { TangleDb } from '@tangleai/store';
import { createSettingsStore } from './settings.ts';

/**
 * The contract as `@tangleai/os` defines it (`WEB_READER_CONTRACT`), copied
 * because the desktop does not depend on the OS package; a test holds the
 * two equal.
 */
const TEXT = (max: number) => ({ type: 'string', maxLength: max });
const URL_SCHEMA = { type: 'string', minLength: 1, maxLength: 2048 } as const;
const LINK = { type: 'object', additionalProperties: false, required: ['text', 'href'], properties: { text: TEXT(500), href: URL_SCHEMA } } as const;
const WEB_ERRORS = { refused: { status: 403 }, unreadable: { status: 502 } } as const;
export const WEB_READER_CONTRACT = {
  $contract: '0.1',
  id: 'web_reader',
  operations: {
    'web.read': {
      kind: 'read', doc: 'Read one web page: its title, its readable blocks in order and its links, with the address the redirects ended at.',
      input: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: URL_SCHEMA } },
      output: {
        type: 'object', additionalProperties: false,
        required: ['url', 'finalUrl', 'title', 'blocks', 'links', 'fetchedAt', 'redirects'],
        properties: {
          url: URL_SCHEMA, finalUrl: URL_SCHEMA, title: TEXT(500), lang: TEXT(35),
          blocks: { type: 'array', maxItems: 2000, items: { type: 'object', required: ['kind'], properties: { kind: { enum: ['heading', 'paragraph', 'list', 'quote', 'code', 'table'] } } } },
          links: { type: 'array', maxItems: 1000, items: LINK },
          fetchedAt: { type: 'string', maxLength: 40 }, redirects: { type: 'array', maxItems: 20, items: URL_SCHEMA }, truncated: { type: 'boolean' },
        },
      },
      errors: WEB_ERRORS,
    },
    'web.search': {
      kind: 'read', doc: 'Search the web: titles, addresses and snippets of the results, best first.',
      input: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', minLength: 1, maxLength: 400 }, limit: { type: 'integer', minimum: 1, maximum: 20 } } },
      output: { type: 'object', additionalProperties: false, required: ['results'], properties: { results: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: TEXT(500), url: URL_SCHEMA, snippet: TEXT(1000) } } } } },
      errors: WEB_ERRORS,
    },
  },
} as const;

export type WebLink = { text: string, href: string };
export type WebBlock =
  | { kind: 'heading', level: 1 | 2 | 3 | 4 | 5 | 6, text: string }
  | { kind: 'paragraph', text: string, links?: WebLink[] }
  | { kind: 'list', ordered: boolean, items: string[] }
  | { kind: 'quote', text: string }
  | { kind: 'code', text: string }
  | { kind: 'table', rows: string[][] };
export type WebPage = { url: string, finalUrl: string, title: string, lang?: string, blocks: WebBlock[], links: WebLink[], fetchedAt: string, redirects: string[], truncated?: boolean };
export type WebResult = { title: string, url: string, snippet?: string };

/** Where the reader is served, beside the desktop's API. */
export const WEB_READER_PATH = '/api/web-reader';
/** The published desktop; the desktop's own page and any loopback page are admitted too. */
export const WEB_READER_ORIGINS = ['https://jklarenbeek.github.io'] as const;
/** The most of one page the reader fetches. */
export const WEB_MAX_BYTES = 5 * 1024 * 1024;

const MAX = { blocks: 2000, links: 1000, redirects: 20, title: 500, linkText: 500, url: 2048, block: 20_000, results: 20, snippet: 1000 } as const;

/** A coded refusal the handlers answer: `refused` is the address, `unreadable` the site. */
export class WebReaderError extends Error {
  readonly code: 'refused' | 'unreadable';
  constructor(code: 'refused' | 'unreadable', message: string) { super(message); this.code = code; }
}
/** The fetcher's refusals that are about the address, not the site. */
const REFUSED = new Set(['blocked-address', 'blocked-url', 'invalid-url', 'policy-denied', 'robots-denied', 'terms-denied']);
const why = (error: any): WebReaderError => {
  if (error instanceof WebReaderError) return error;
  const code = typeof error?.code === 'string' ? error.code : '';
  return new WebReaderError(REFUSED.has(code) ? 'refused' : 'unreadable', String(error?.message ?? error));
};

const webAddress = (value: string) => {
  if (value.length > MAX.url) return null;
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null; } catch { return null; }
};
const linksOf = (links: readonly { text: string, url: string }[] | undefined): WebLink[] => {
  const out: WebLink[] = [];
  for (const link of links ?? []) {
    const href = webAddress(link.url);
    if (href) out.push({ text: link.text.slice(0, MAX.linkText), href });
  }
  return out;
};
const cap = (text: string) => text.slice(0, MAX.block);

/**
 * An extraction's elements as the reader's blocks: headings at their depth,
 * paragraphs with their links, list items gathered into lists, tables as
 * rows of cells. Navigation, footers and other furniture are left out.
 */
export function blocksOf(elements: ExtractedDocument['elements']): WebBlock[] {
  const blocks: WebBlock[] = [];
  for (const element of elements) {
    const text = cap(element.text);
    switch (element.role) {
      case 'title': blocks.push({ kind: 'heading', level: 1, text }); break;
      case 'heading': blocks.push({ kind: 'heading', level: Math.min(6, Math.max(1, element.headingPath.length)) as 1, text }); break;
      case 'paragraph': case 'figure-caption': {
        const links = linksOf(element.links);
        blocks.push({ kind: 'paragraph', text, ...(links.length ? { links } : {}) });
        break;
      }
      case 'list-item': {
        const last = blocks.at(-1);
        if (last?.kind === 'list') last.items.push(text); else blocks.push({ kind: 'list', ordered: false, items: [text] });
        break;
      }
      case 'quote': blocks.push({ kind: 'quote', text }); break;
      case 'code': blocks.push({ kind: 'code', text }); break;
      case 'table': blocks.push({ kind: 'table', rows: text.split('\n').map(row => row.split(' | ')) }); break;
      default: break;
    }
  }
  return blocks;
}

/** A page from what the fetcher answered and what the extractor found, held to the contract's caps. */
export function pageOf(fetched: { requestedUrl: string, finalUrl: string, fetchedAt: string, redirects?: string[] }, extracted: ExtractedDocument, lang?: string): WebPage {
  const blocks = blocksOf(extracted.elements);
  const seen = new Set<string>();
  const links: WebLink[] = [];
  for (const element of extracted.elements) for (const link of linksOf(element.links)) {
    if (seen.has(link.href)) continue;
    seen.add(link.href);
    links.push(link);
  }
  const truncated = blocks.length > MAX.blocks || links.length > MAX.links || extracted.warnings.some(w => w.startsWith('partial extraction'));
  const redirects = (fetched.redirects ?? []).map(webAddress).filter((u): u is string => u !== null).slice(0, MAX.redirects);
  return {
    url: webAddress(fetched.requestedUrl) ?? fetched.requestedUrl.slice(0, MAX.url),
    finalUrl: webAddress(fetched.finalUrl) ?? fetched.finalUrl.slice(0, MAX.url),
    title: (extracted.title ?? '').slice(0, MAX.title),
    ...(lang ? { lang } : {}),
    blocks: blocks.slice(0, MAX.blocks), links: links.slice(0, MAX.links),
    fetchedAt: fetched.fetchedAt, redirects,
    ...(truncated ? { truncated: true } : {}),
  };
}

const LANG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;
const langOf = (html: string) => { const found = /<html\b[^>]*\blang\s*=\s*["']?([^"'\s>]+)/i.exec(html.slice(0, 4096))?.[1]; return found && found.length <= 35 && LANG.test(found) ? found : undefined; };
const decode = (bytes: Uint8Array) => {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
  const charset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  try { return new TextDecoder(charset ?? 'utf-8').decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
};

/** What the reader needs from its host: the fetcher, where SearxNG is (null when none is set), and a fetch for search. */
export type WebReaderOptions = {
  fetcher: Pick<SafeStaticFetcher, 'fetch'>,
  searxngUrl: () => Promise<string | null> | string | null,
  fetch?: typeof globalThis.fetch,
  maxBytes?: number,
};

/** The reader: read and search, each answering a page or throwing a {@link WebReaderError}. */
export function createWebReader(options: WebReaderOptions) {
  return {
    async read({ url }: { url: string }): Promise<WebPage> {
      if (!webAddress(url)) throw new WebReaderError('refused', `only http and https addresses are read, not '${url.slice(0, 80)}'`);
      try {
        const fetched = await options.fetcher.fetch(url, {}, undefined, { maxBytes: options.maxBytes ?? WEB_MAX_BYTES });
        if (fetched.status !== 'ok' || !fetched.bytes) throw new WebReaderError('unreadable', `the site answered HTTP ${fetched.responseStatus} without a page`);
        const mime = fetched.mimeType ?? '';
        if (mime === 'text/html' || mime === 'application/xhtml+xml') {
          const html = decode(fetched.bytes);
          return pageOf(fetched, extractHtml(html, fetched.finalUrl, { allowPartial: true }), langOf(html));
        }
        if (mime === 'text/plain' || mime === 'text/markdown')
          return pageOf(fetched, extractTextDocument(new TextDecoder().decode(fetched.bytes), mime === 'text/markdown', { allowPartial: true }));
        throw new WebReaderError('unreadable', `not a page the reader can show (${mime || 'an unknown type'})`);
      } catch (error) { throw why(error); }
    },
    async search({ query, limit }: { query: string, limit?: number }): Promise<{ results: WebResult[] }> {
      const base = await options.searxngUrl();
      if (!base) throw new WebReaderError('unreadable', 'this desktop has no search service configured (settings: search.searxngUrl)');
      try {
        const answer = await createSearxngClient({ baseUrl: base, ...(options.fetch ? { fetch: options.fetch } : {}) }).search(query);
        const results: WebResult[] = [];
        for (const r of answer.results) {
          const url = webAddress(r.url);
          if (!url) continue;
          results.push({ title: (r.title || url).slice(0, MAX.title), url, ...(r.content ? { snippet: r.content.slice(0, MAX.snippet) } : {}) });
          if (results.length >= Math.min(limit ?? MAX.results, MAX.results)) break;
        }
        return { results };
      } catch (error) { throw why(error); }
    },
  };
}
export type DesktopWebReader = ReturnType<typeof createWebReader>;

/** The contract's handlers over a reader: a refusal is the contract's declared error, with its reason. */
export function webReaderHandlers(reader: DesktopWebReader) {
  const answer = (run: () => Promise<unknown>, ctx: any) => run().catch((error) => { const coded = why(error); return ctx.fail(coded.code, {}, { detail: coded.message }); });
  return {
    'web.read': (input: { url: string }, ctx: any) => answer(() => reader.read(input), ctx),
    'web.search': (input: { query: string, limit?: number }, ctx: any) => answer(() => reader.search(input), ctx),
  };
}

const LOOPBACK = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/;
/** Whether a page at `origin` may call the reader: the desktop's own page, a loopback page, or the published desktop. */
export const admittedOrigin = (origin: string | undefined, origins: readonly string[] = WEB_READER_ORIGINS) =>
  origin === undefined || LOOPBACK.test(origin) || origins.includes(origin);

/**
 * The reader as a node:http handler for {@link WEB_READER_PATH} and below:
 * the preflight a cross-origin page sends (with private network access, so
 * the published desktop may reach a desktop on this machine), and the
 * contract's operations at `<path>/web.read` and `<path>/web.search`. A
 * page from any other origin is refused before anything is fetched.
 */
export function webReaderRoute(reader: DesktopWebReader, options: { origins?: readonly string[] } = {}) {
  const dispatcher = serveHttp(compileContract(WEB_READER_CONTRACT as any), webReaderHandlers(reader) as any, { validateOutput: 'always' });
  const handle = toNodeHandler(dispatcher);
  const route = (req: IncomingMessage, res: ServerResponse) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    if (!admittedOrigin(origin, options.origins)) {
      res.writeHead(403, { 'content-type': 'application/json', vary: 'Origin' });
      res.end(JSON.stringify({ error: 'this origin may not use the web reader' }));
      return;
    }
    if (origin !== undefined) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'content-type, accept, idempotency-key, if-match, if-none-match',
        'access-control-max-age': '600',
        ...(req.headers['access-control-request-private-network'] === 'true' ? { 'access-control-allow-private-network': 'true' } : {}),
      });
      res.end();
      return;
    }
    req.url = (req.url ?? '').slice(WEB_READER_PATH.length) || '/';
    handle(req, res);
  };
  return Object.assign(route, { close: () => dispatcher.close() });
}

/**
 * The desktop's route: a reader with its own safe fetcher (so reading a page
 * never waits behind an ingest), searching the SearxNG the desktop's
 * settings name at the moment of each search.
 */
export function desktopWebRoute(db: TangleDb, options: { documentFetch?: StaticFetchOptions, fetch?: typeof globalThis.fetch } = {}) {
  const fetcher = new SafeStaticFetcher({ ...options.documentFetch, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const settings = createSettingsStore(db);
  const route = webReaderRoute(createWebReader({ fetcher, searxngUrl: async () => (await settings.read()).search.searxngUrl, ...(options.fetch ? { fetch: options.fetch } : {}) }));
  return Object.assign((req: IncomingMessage, res: ServerResponse) => route(req, res), { close: async () => { await route.close(); await fetcher.close(); } });
}
