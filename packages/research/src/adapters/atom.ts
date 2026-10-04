import type { ScholarlyMetadata } from './normalize.ts';
import { normalizeArxiv, normalizeScholarlyText } from './normalize.ts';
import { isDateTimeRFC3339 } from '@jarenjs/core/dates';

const ATOM = 'http://www.w3.org/2005/Atom', ARXIV = 'http://arxiv.org/schemas/atom', SEARCH = 'http://a9.com/-/spec/opensearch/1.1/';
interface Element { name: string; ns: string; attrs: Record<string, string>; text: string; children: Element[]; namespaces: Record<string, string> }
function decode(text: string): string {
  return text.replace(/&([^;\s]+);|&/g, (whole, name: string | undefined) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (name && Object.hasOwn(named, name)) return named[name];
    const n = name?.match(/^#(x[0-9a-f]+|[0-9]+)$/i), point = n ? Number.parseInt(n[1].startsWith('x') ? n[1].slice(1) : n[1], n[1].startsWith('x') ? 16 : 10) : -1;
    if (point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)) return String.fromCodePoint(point);
    throw new Error('Unknown or invalid XML entity: ' + whole.slice(0, 32));
  });
}
function parse(text: string): Element {
  if (text.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Atom size or declaration refused.');
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>|[^<]+/gy;
  const stack: Array<{ tag: string; value: Element }> = []; let root: Element | undefined, offset = 0, count = 0;
  while (offset < text.length) {
    tokens.lastIndex = offset; const match = tokens.exec(text);
    if (!match) throw new Error('Malformed XML token.');
    const token = match[0]; offset = tokens.lastIndex;
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[') || !token.startsWith('<')) {
      const value = token.startsWith('<![CDATA[') ? token.slice(9, -3) : decode(token);
      if (!stack.length && value.trim()) throw new Error('Text outside the Atom feed.');
      for (const entry of stack) entry.value.text += value;
      continue;
    }
    if (token.startsWith('</')) {
      const tag = token.slice(2, -1).trim();
      if (stack.pop()?.tag !== tag) throw new Error('Unbalanced XML element.');
      continue;
    }
    const tag = token.match(/^<([\w:.-]+)/)![1], attrText = token.slice(tag.length + 1).replace(/\/?\s*>$/, '');
    const attrs: Record<string, string> = Object.create(null), regex = /\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy;
    let cursor = 0;
    while (cursor < attrText.length && attrText.slice(cursor).trim()) {
      regex.lastIndex = cursor; const attribute = regex.exec(attrText);
      if (!attribute || Object.hasOwn(attrs, attribute[1])) throw new Error('Malformed XML attribute.');
      attrs[attribute[1]] = decode(attribute[2] ?? attribute[3]); cursor = regex.lastIndex;
    }
    const namespaces: Record<string, string> = { ...(stack.at(-1)?.value.namespaces ?? {}), xml: 'http://www.w3.org/XML/1998/namespace' };
    for (const [key, uri] of Object.entries(attrs)) if (key === 'xmlns' || key.startsWith('xmlns:')) namespaces[key === 'xmlns' ? '' : key.slice(6)] = uri;
    const names = tag.split(':'), prefix = names.length === 2 ? names[0] : '';
    if (names.length > 2 || prefix && !namespaces[prefix]) throw new Error('Unknown XML namespace.');
    const value: Element = { name: names.at(-1)!, ns: namespaces[prefix] ?? '', attrs, text: '', children: [], namespaces };
    if (++count > 20000 || stack.length >= 32) throw new Error('Atom element budget exceeded.');
    if (stack.length) stack.at(-1)!.value.children.push(value);
    else { if (root) throw new Error('Multiple Atom roots.'); root = value; }
    if (!token.endsWith('/>')) stack.push({ tag, value });
  }
  if (stack.length || !root || root.ns !== ATOM || root.name !== 'feed') throw new Error('Expected a closed Atom feed.');
  return root;
}
const children = (element: Element, name: string, ns = ATOM) => element.children.filter(child => child.ns === ns && child.name === name);
function one(element: Element, name: string, ns = ATOM, optional = false): string {
  const found = children(element, name, ns);
  if (found.length > 1 || !optional && found.length !== 1) throw new Error('Missing or duplicate Atom field: ' + name);
  const value = normalizeScholarlyText(found[0]?.text ?? '');
  if (!optional && !value) throw new Error('Empty Atom field: ' + name);
  return value;
}
export interface AtomReadResult { entries: ScholarlyMetadata[]; malformed: number; total: number | null; start: number | null; pageSize: number | null; errors: string[] }
/** Bounded, namespace-aware arXiv Atom reader. No DTD, external entity or network capability. */
export function readAtomEntries(text: string): AtomReadResult {
  const result: AtomReadResult = { entries: [], malformed: 0, total: null, start: null, pageSize: null, errors: [] };
  let root: Element;
  try { root = parse(text); } catch (cause) { result.errors.push(String(cause)); return result; }
  for (const [field, name] of [['total', 'totalResults'], ['start', 'startIndex'], ['pageSize', 'itemsPerPage']] as const) {
    try {
      const value = one(root, name, SEARCH, true);
      if (value) { const n = Number(value); if (!/^\d+$/.test(value) || !Number.isSafeInteger(n)) throw new Error('Invalid OpenSearch count.'); result[field] = n; }
    } catch (cause) { result.errors.push(String(cause)); }
  }
  for (const entry of root.children.filter(child => child.name === 'entry')) {
    try {
      if (entry.ns !== ATOM) throw new Error('Entry has a foreign Atom namespace.');
      const id = one(entry, 'id');
      if (/\/api\/errors(?:#|$)/.test(id)) throw new Error('arXiv API error: ' + one(entry, 'summary'));
      const canonicalIds = normalizeArxiv(id), doi = one(entry, 'doi', ARXIV, true);
      const published = one(entry, 'published'), updated = one(entry, 'updated');
      if (![published, updated].every(isDateTimeRFC3339)) throw new Error('Invalid Atom timestamp.');
      const category = children(entry, 'primary_category', ARXIV);
      if (category.length > 1 || category.some(c => !c.attrs.term)) throw new Error('Invalid arXiv primary category.');
      const authors = children(entry, 'author').map(author => one(author, 'name'));
      if (!authors.length) throw new Error('Missing Atom author.');
      const source = children(entry, 'link').find(link => link.attrs.rel === 'related' || link.attrs.rel === 'alternate');
      result.entries.push({ canonicalIds: { ...canonicalIds, ...(doi ? { doi } : {}) }, title: one(entry, 'title'), authors,
        date: published.slice(0, 10), updatedAt: updated, categories: category.map(c => c.attrs.term), sourceUrl: source?.attrs.href || id });
    } catch (cause) { result.malformed++; result.errors.push(String(cause)); }
  }
  return result;
}
