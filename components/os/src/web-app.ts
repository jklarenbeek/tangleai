/**
 * The desktop's Web: a reader of web pages, never a browser frame. A host
 * reads a page for it (a page cannot fetch most of the web itself; see
 * `./web.ts`), and the reader draws the page's extracted blocks in the
 * desktop's own look: headings, paragraphs with their links, lists, quotes,
 * code and tables. Nothing a page carries runs or is drawn as markup, and no
 * third-party page is ever framed: "Open original" is a new tab.
 *
 * The address bar takes an address or search words. A link on a page opens
 * in the reader (only http and https); back and forward walk what the person
 * read and searched.
 */
import { createOsMessages, type OsCatalogue } from './messages.ts';
import { WEB_CODES, type WebBlock, type WebLink, type WebPage, type WebReader, type WebResult } from './web.ts';
import type { ModuleManifest } from './manifest.ts';
import type { ShippedContext, ShippedMount } from './shell.ts';

export type WebOptions = {
  /** Reads and searches for the desktop: the host's, or `unconfiguredWebReader()` where it has none. */
  reader: WebReader,
  /** Where the person sets up web access (the host's own Settings section); the desktop's Settings by default. */
  configure?: () => void,
  messages?: Partial<OsCatalogue>,
  /** The language `messages` is in: the desktop's own title of Web in it. */
  locale?: string,
  id?: string,
};

/** What the address bar holds: an address to read, words to search for, or nothing. */
export type AddressIntent = { kind: 'read', url: string } | { kind: 'search', query: string } | { kind: 'empty' };

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}(?::\d{1,5})?(?:[/?#].*)?$/i;
/** An address when it is one (`https://…`, or a bare host such as `example.org/page`), else a search. */
export function classifyAddress(text: string): AddressIntent {
  const value = text.trim();
  if (!value) return { kind: 'empty' };
  if (/^https?:\/\//i.test(value)) {
    const url = admitLink(value);
    return url ? { kind: 'read', url } : { kind: 'search', query: value };
  }
  if (!/\s/.test(value) && HOST.test(value)) { const url = admitLink(`https://${value}`); if (url) return { kind: 'read', url }; }
  return { kind: 'search', query: value };
}

/** A link the reader may follow: an absolute http(s) address (resolved against `base`), or null. */
export function admitLink(href: string, base?: string): string | null {
  let url: URL;
  try { url = base ? new URL(href, base) : new URL(href); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.href;
}

/** A paragraph's text with its links placed where their words stand; a link whose words are not in it follows at the end. */
export function linkify(text: string, links: readonly WebLink[] = []): (string | WebLink)[] {
  const out: (string | WebLink)[] = [];
  const rest: WebLink[] = [];
  let from = 0;
  for (const link of links) {
    const at = link.text ? text.indexOf(link.text, from) : -1;
    if (at < 0) { rest.push(link); continue; }
    if (at > from) out.push(text.slice(from, at));
    out.push(link);
    from = at + link.text.length;
  }
  if (from < text.length) out.push(text.slice(from));
  for (const link of rest) out.push(' ', link);
  return out;
}

/** A block as the desktop draws it: a tag, its text or children; never a page's markup. */
export type ReaderNode = { tag: string, text?: string, link?: WebLink, children?: ReaderNode[] };
export function blockNodes(blocks: readonly WebBlock[]): ReaderNode[] {
  return blocks.map((block): ReaderNode => {
    switch (block.kind) {
      case 'heading': return { tag: `h${Math.min(6, Math.max(2, block.level + 1))}`, text: block.text };
      case 'paragraph': return { tag: 'p', children: linkify(block.text, block.links).map(part => typeof part === 'string' ? { tag: '#text', text: part } : { tag: 'a', link: part }) };
      case 'list': return { tag: block.ordered ? 'ol' : 'ul', children: block.items.map(item => ({ tag: 'li', text: item })) };
      case 'quote': return { tag: 'blockquote', text: block.text };
      case 'code': return { tag: 'pre', children: [{ tag: 'code', text: block.text }] };
      case 'table': return { tag: 'table', children: [{ tag: 'tbody', children: block.rows.map(row => ({ tag: 'tr', children: row.map(cell => ({ tag: 'td', text: cell })) })) }] };
      default: return { tag: 'p', text: '' };
    }
  });
}

/** The Web module: its manifest and its mount. */
export function webModule(options: WebOptions): { manifest: ModuleManifest, mount: ShippedMount } {
  const id = options.id ?? 'web';
  const t = createOsMessages(options.messages);
  const named = (en: string, text: string) => ({ en, ...(options.locale && options.locale !== 'en' && options.messages ? { [options.locale]: text } : {}) });
  const manifest: ModuleManifest = {
    $module: '0.1', id, version: '1.0.0', category: 'system',
    title: named('Web', t('web/title')), icon: { glyph: 'web', hue: 210 },
    host: { kind: 'shipped', mount: id },
    window: { width: 960, height: 700, minWidth: 380, minHeight: 360, singleton: true },
  };
  return { manifest, mount: (node, context) => mountWeb(node, context, options) };
}

type Visit = { kind: 'read', url: string } | { kind: 'search', query: string };

function mountWeb(node: HTMLElement, context: ShippedContext, options: WebOptions) {
  const doc = node.ownerDocument;
  const t = createOsMessages(options.messages);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) => { const e = doc.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
  const root = el('div', 'tos-web');
  const form = el('form', 'tos-web-bar');
  const address = el('input', 'tos-web-address');
  address.type = 'text'; address.name = 'address'; address.autocomplete = 'off'; address.spellcheck = false;
  address.setAttribute('aria-label', t('web/address')); address.placeholder = t('web/address');
  address.setAttribute('inputmode', 'url'); address.dir = 'auto';
  const go = el('button', 'tos-web-go', t('web/go')); go.type = 'submit';
  form.append(address, go);
  const status = el('p', 'tos-web-status'); status.setAttribute('role', 'status');
  const view = el('div', 'tos-web-view');
  root.append(form, status, view);
  node.append(root);

  let back: Visit[] = [], forward: Visit[] = [], here: Visit | null = null, ticket = 0;
  const header = () => context.setHeader({ start: [
    { kind: 'button', id: 'back', label: t('web/back'), glyph: 'back', disabled: back.length === 0 },
    { kind: 'button', id: 'forward', label: t('web/forward'), glyph: 'forward', disabled: forward.length === 0 },
    { kind: 'button', id: 'reload', label: t('web/reload'), glyph: 'refresh', disabled: here === null },
  ] });
  const say = (text: string, failed = false, code = '') => { status.textContent = text; status.dataset.tone = failed ? 'fail' : ''; if (code) status.dataset.code = code; else delete status.dataset.code; };

  /** A refusal said plainly, with what the person can do about it. */
  const refused = (error: any, visit: Visit) => {
    view.replaceChildren();
    const where = visit.kind === 'read' ? visit.url : visit.query;
    const reason = String(error?.message ?? error ?? '');
    const code = typeof error?.code === 'string' ? error.code : '';
    if (code === WEB_CODES.unconfigured) {
      say(t('web/unconfigured'), true, code);
      const box = el('div', 'tos-web-empty');
      const button = el('button', 'tos-web-configure', t('web/configure')); button.type = 'button';
      button.addEventListener('click', () => (options.configure ?? (() => context.openSettings()))());
      box.append(el('p', '', t('web/unconfigured-detail')), button);
      view.append(box);
    }
    else if (code === WEB_CODES.refused) say(t('web/refused', { address: where, reason }), true, code);
    else if (code === WEB_CODES.unreadable) say(t('web/unreadable', { address: where, reason }), true, code);
    else say(t('web/failed', { detail: reason }), true, code);
  };

  const link = (target: WebLink, base: string) => {
    const a = el('a', 'tos-web-link', target.text || target.href);
    const url = admitLink(target.href, base);
    if (!url) { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); return a; }
    a.href = url; a.title = url;
    // a link on a page reads in the reader; a modified click still goes to the browser
    a.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      visit({ kind: 'read', url });
    });
    return a;
  };
  const draw = (nodes: ReaderNode[], parent: HTMLElement, base: string) => {
    for (const n of nodes) {
      if (n.tag === '#text') { parent.append(doc.createTextNode(n.text ?? '')); continue; }
      if (n.tag === 'a' && n.link) { parent.append(link(n.link, base)); continue; }
      const e = doc.createElement(n.tag);
      if (n.text !== undefined) e.textContent = n.text;
      if (n.children) draw(n.children, e, base);
      parent.append(e);
    }
  };

  const showPage = (page: WebPage) => {
    view.replaceChildren();
    const top = el('div', 'tos-web-page-top');
    const where = el('p', 'tos-web-where', page.finalUrl);
    where.dir = 'ltr';
    const original = el('a', 'tos-web-original', t('web/open-original'));
    original.href = page.finalUrl; original.target = '_blank'; original.rel = 'noopener noreferrer';
    top.append(where, original);
    const article = el('article', 'tos-web-page');
    article.setAttribute('aria-label', page.title || page.finalUrl);
    if (page.lang) article.lang = page.lang;
    article.dir = 'auto';
    const title = el('h1', 'tos-web-title', page.title || page.finalUrl);
    article.append(title);
    draw(blockNodes(page.blocks), article, page.finalUrl);
    view.append(top, article);
    if (page.truncated) view.append(el('p', 'tos-muted', t('web/truncated')));
    say('');
    address.value = page.finalUrl;
    context.setTitle(page.title || t('web/title'));
  };
  const showResults = (query: string, results: WebResult[]) => {
    view.replaceChildren();
    if (!results.length) { say(t('web/no-results', { query })); return; }
    say(results.length === 1 ? t('web/result-one', { query }) : t('web/results', { count: results.length, query }));
    const list = el('ol', 'tos-web-results');
    list.setAttribute('aria-label', t('web/results-label'));
    for (const result of results) {
      const url = admitLink(result.url);
      if (!url) continue;
      const li = el('li', 'tos-web-result');
      const a = link({ text: result.title || url, href: url }, url);
      a.classList.add('tos-web-result-title');
      const where = el('p', 'tos-web-result-url', url); where.dir = 'ltr';
      li.append(a, where);
      if (result.snippet) li.append(el('p', 'tos-web-result-snippet', result.snippet));
      list.append(li);
    }
    view.append(list);
    context.setTitle(t('web/title'));
  };

  async function show(target: Visit) {
    const mine = ++ticket;
    here = target; header();
    address.value = target.kind === 'read' ? target.url : target.query;
    say(target.kind === 'read' ? t('web/loading', { address: target.url }) : t('web/searching', { query: target.query }));
    try {
      if (target.kind === 'read') { const page = await options.reader.read({ url: target.url }); if (mine === ticket) showPage(page); }
      else { const { results } = await options.reader.search({ query: target.query, limit: 10 }); if (mine === ticket) showResults(target.query, results); }
    } catch (error) { if (mine === ticket) refused(error, target); }
  }
  function visit(target: Visit) {
    if (here) back.push(here);
    forward = [];
    void show(target);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const intent = classifyAddress(address.value);
    if (intent.kind === 'empty') return;
    visit(intent.kind === 'read' ? { kind: 'read', url: intent.url } : { kind: 'search', query: intent.query });
  });
  context.onHeader(({ item }) => {
    if (item === 'back' && back.length) { if (here) forward.push(here); void show(back.pop()!); }
    else if (item === 'forward' && forward.length) { if (here) back.push(here); void show(forward.pop()!); }
    else if (item === 'reload' && here) void show(here);
    else return { refused: `Web has no '${item}'` };
  });
  header();
  say(t('web/start'));
  return () => { ticket++; root.remove(); };
}
