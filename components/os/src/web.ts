/**
 * Web reading: how the desktop, and its assistant, read websites. A page in a
 * browser cannot fetch most of the web (cross-origin rules, and no address
 * lookup to refuse private hosts), so a HOST reads for it: it serves the
 * `web_reader` provider contract from its server (built on a safe static
 * fetcher and an HTML extractor), and the desktop draws what comes back in
 * its own look. A third-party page is never framed: the reader shows the
 * page's extracted blocks, and "open original" is a new tab.
 *
 * The assistant reads through the kernel's `tangle_os_web` contract, under
 * grants, in the ledger and within a budget (a rolling window per caller),
 * and every answer it gets frames the page's text as untrusted data, never
 * instructions.
 */

/** A link a page carries: its text and the absolute address it points to. */
export type WebLink = { text: string, href: string };
/** One readable block of a page, in reading order. */
export type WebBlock =
  | { kind: 'heading', level: 1 | 2 | 3 | 4 | 5 | 6, text: string }
  | { kind: 'paragraph', text: string, links?: WebLink[] }
  | { kind: 'list', ordered: boolean, items: string[] }
  | { kind: 'quote', text: string }
  | { kind: 'code', text: string }
  | { kind: 'table', rows: string[][] };
/** A page as the reader shows it. `finalUrl` is where the redirects ended; `truncated` when the byte cap cut it. */
export type WebPage = {
  url: string, finalUrl: string, title: string, lang?: string,
  blocks: WebBlock[], links: WebLink[],
  fetchedAt: string, redirects: string[], truncated?: boolean,
};
/** One search result. */
export type WebResult = { title: string, url: string, snippet?: string };

/** What a host's reader does: the desktop's Web app and the kernel's `tangle_os_web` call it. */
export type WebReader = {
  read(input: { url: string }): Promise<WebPage>,
  search(input: { query: string, limit?: number }): Promise<{ results: WebResult[] }>,
};

/**
 * Refusals a reader answers, each a coded error:
 * `OS0180` no web access is configured on this desktop; `OS0181` the address is
 * refused (not http(s), a private or local host, a policy, robots); `OS0182` the
 * site could not be read (unreachable, a timeout, an HTTP error, not a page it
 * can read); `OS0183` the caller's web budget is spent (see `WebBudget`).
 */
export const WEB_CODES = { unconfigured: 'OS0180', refused: 'OS0181', unreadable: 'OS0182', budget: 'OS0183' } as const;

const TEXT = (max: number) => ({ type: 'string', maxLength: max });
const URL_SCHEMA = { type: 'string', minLength: 1, maxLength: 2048 } as const;
const LINK = { type: 'object', additionalProperties: false, required: ['text', 'href'], properties: { text: TEXT(500), href: URL_SCHEMA } } as const;
export const WEB_PAGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['url', 'finalUrl', 'title', 'blocks', 'links', 'fetchedAt', 'redirects'],
  properties: {
    url: URL_SCHEMA, finalUrl: URL_SCHEMA, title: TEXT(500), lang: TEXT(35),
    blocks: { type: 'array', maxItems: 2000, items: { type: 'object', required: ['kind'], properties: { kind: { enum: ['heading', 'paragraph', 'list', 'quote', 'code', 'table'] } } } },
    links: { type: 'array', maxItems: 1000, items: LINK },
    fetchedAt: { type: 'string', maxLength: 40 }, redirects: { type: 'array', maxItems: 20, items: URL_SCHEMA }, truncated: { type: 'boolean' },
  },
} as const;

/** What a reader refuses, by name: `refused` is the address, `unreadable` the site (the codes above). */
const WEB_ERRORS = { refused: { status: 403 }, unreadable: { status: 502 } } as const;

/** The provider contract a host serves (over HTTP from its server, or locally in a test). */
export const WEB_READER_CONTRACT = {
  $contract: '0.1',
  id: 'web_reader',
  operations: {
    'web.read': {
      kind: 'read', doc: 'Read one web page: its title, its readable blocks in order and its links, with the address the redirects ended at.',
      input: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: URL_SCHEMA } },
      output: WEB_PAGE_SCHEMA,
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

/** A reader that answers `OS0180` for everything: the desktop with no web access configured. */
export const unconfiguredWebReader = (): WebReader => {
  const refuse = async (): Promise<never> => { throw Object.assign(new Error('no web access is configured on this desktop'), { code: WEB_CODES.unconfigured }); };
  return { read: refuse, search: refuse };
};
