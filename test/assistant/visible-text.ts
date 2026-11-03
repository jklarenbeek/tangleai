/** The census of what the assistant panel shows a person, by who wrote it. */
const VISIBLE = ['title', 'aria-label', 'placeholder', 'alt'];
const TOKEN = /‹h:([^›]+)›/g;

export type VisibleString = { text: string, where: string };
export type TextClass = 'owned' | 'default' | 'technical' | 'glyph' | 'host' | 'foreign' | 'suite' | 'fragment' | 'unframed';

const label = (element: any) => String(element.tagName).toLowerCase()
  + String(element.getAttribute?.('class') ?? '').split(/\s+/).filter(Boolean).map(name => '.' + name).join('');
/** Text nodes (runs of whitespace collapsed, blank ones skipped) and accessible attributes, in document order. */
export function visibleStrings(container: any): VisibleString[] {
  const found: VisibleString[] = [];
  const walk = (node: any, parent: any) => {
    if (node.nodeType === 3) {
      const text = String(node.nodeValue).replace(/\s+/g, ' ');
      if (text.trim() !== '') found.push({ text, where: label(parent) });
      return;
    }
    for (const name of VISIBLE) {
      const value = node.getAttribute(name);
      if (value !== null && value.trim() !== '') found.push({ text: value.replace(/\s+/g, ' '), where: `${label(node)}@${name}` });
    }
    for (const child of node.childNodes) walk(child, node);
  };
  for (const child of container.childNodes) walk(child, container);
  return found;
}

/** Adjacent text of one element type reads as one run; attributes stay apart. */
export function textRuns(strings: VisibleString[]): VisibleString[] {
  const runs: VisibleString[] = [];
  for (const { text, where } of strings) {
    const last = runs.at(-1);
    if (last && last.where === where && !where.includes('@')) last.text += text;
    else runs.push({ text, where });
  }
  return runs;
}

/** A catalogue whose every message renders as `⟦key⟧`, its parameters appended as JSON inside the brackets. */
export function sentinelMessages(keys: string[]) {
  return Object.fromEntries(keys.map(key => [key, (params?: object) =>
    `⟦${key}${params && Object.keys(params).length ? ' ' + JSON.stringify(params) : ''}⟧`]));
}
const MESSAGE = /⟦([^\s⟦⟧]+)(?: ([^⟦⟧]*))?⟧/g;
/** A message the view split around a value it wraps in its own element. */
const OPENED = /⟦([^\s⟦⟧]+)(?: [^⟦⟧]*)?$/, CLOSED = /^[^⟦⟧]*⟧/;
/** Presentation options a host may pass; without them the catalogue supplies the text. */
const DEFAULT_KEYS = ['launcher/label', 'launcher/title', 'panel/title', 'intro/text', 'settings/hint'];
/** Labels Jaren's Markdown renderer writes into a reply. */
const SUITE = [/^Page break$/, /^Permalink to (this section)?$/, /^Back to reference \d+(, occurrence \d+)?$/, /^Footnotes$/];

/**
 * Judge one string of a key-sentinel render. A message is named by its key and
 * its parameters are data; `details` are the `detail` parameters, the text
 * another package wrote. Host tokens are removed next. Letters left over, other
 * than a Markdown label, were written outside the catalogue (`unframed`), as is
 * a failure shown without a message around it.
 */
export function classify(text: string): { class: TextClass, keys: string[], details: string[] } {
  const keys: string[] = [], details: string[] = [];
  let rest = text.replace(MESSAGE, (_, key: string, json?: string) => {
    keys.push(key);
    const detail = json === undefined ? undefined : JSON.parse(json).detail;
    if (typeof detail === 'string') details.push(detail);
    return '';
  });
  rest = rest.replace(OPENED, (_, key: string) => { keys.push(key); return ''; });
  const fragment = CLOSED.test(rest);
  rest = rest.replace(CLOSED, '');
  const tokens = [...rest.matchAll(TOKEN)].map(match => match[1]!);
  rest = rest.replace(TOKEN, '');
  const [key] = keys;
  if (/\p{L}/u.test(rest)) return { class: key === undefined && SUITE.some(pattern => pattern.test(rest)) ? 'suite' : 'unframed', keys, details };
  if (key === undefined) return { class: fragment ? 'fragment' : tokens.length === 0 ? 'glyph' : tokens.some(name => name.startsWith('error-')) ? 'unframed' : 'host', keys, details };
  return { class: key === 'error/detail' ? 'foreign' : DEFAULT_KEYS.includes(key) ? 'default' : key.endsWith('-example') ? 'technical' : 'owned', keys, details };
}

/** The literals a rule tree writes: string children not starting with `$`, both `$if` branches and the accessible attributes. */
export function ruleLiterals(rules: { body: unknown }[]): string[] {
  const found: string[] = [];
  const isElement = (node: any[]) => typeof node[0] === 'string' && (node.length === 1
    || (node[1] && typeof node[1] === 'object' && !Array.isArray(node[1]) && !('$if' in node[1]) && !('$apply' in node[1])));
  const walk = (node: any): void => {
    if (typeof node === 'string') { if (!node.startsWith('$')) found.push(node); return; }
    if (Array.isArray(node)) {
      if (isElement(node)) { for (const [key, value] of Object.entries(node[1] ?? {})) if (VISIBLE.includes(key)) walk(value); node.slice(2).forEach(walk); }
      else node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object' && '$if' in node) { walk(node.$if[1]); if (node.$if[2] !== undefined) walk(node.$if[2]); }
  };
  for (const rule of rules) walk(rule.body);
  return found;
}
