import { parseHTML } from 'linkedom';
import { DocumentError, type DocumentLink, type ElementRole, type ExtractedDocument } from './contracts.ts';
import { cleanText, capElements, DEFAULT_EXTRACT_LIMITS, type ElementDraft, type ExtractLimits, type ExtractOptions } from './extract-common.ts';
export { DEFAULT_EXTRACT_LIMITS, type ExtractLimits, type ExtractOptions } from './extract-common.ts';

const BOILERPLATE_SELECTORS = [
  'script', 'style', 'noscript', 'template', 'form', 'button', 'input', 'select', 'textarea',
  'nav', 'aside', 'footer', '[role="navigation"]', '[role="contentinfo"]', '[aria-modal="true"]',
  '.toc', '#toc', '.navbox', '.vertical-navbox', '.mw-editsection', '.mw-jump-link',
  '.reference', '.references', '.reflist', '.printfooter', '.catlinks', '.metadata',
  '[class*="cookie"]', '[id*="cookie"]', '[class*="advert"]', '[id*="advert"]',
  '[class*="related"]', '[aria-label*="navigation" i]',
];

function densityScore(element: Element): number {
  const text = cleanText(element.textContent ?? '');
  if (text.length === 0) return -Infinity;
  let linkChars = 0;
  for (const link of element.querySelectorAll('a')) linkChars += cleanText(link.textContent ?? '').length;
  const paragraphs = element.querySelectorAll('p').length;
  const controls = element.querySelectorAll('button,input,select,nav').length;
  return text.length - linkChars * 1.5 + paragraphs * 120 - controls * 180;
}

function chooseContentRoot(document: Document): Element {
  const preferred = [
    '#mw-content-text .mw-parser-output',
    'main article',
    'main',
    'article',
    '[role="main"]',
  ];
  for (const selector of preferred) {
    const match = document.querySelector(selector);
    if (match !== null && cleanText(match.textContent ?? '').length > 0) return match;
  }
  const body = document.body;
  if (body === null) throw new DocumentError('malformed-html', 'HTML document has no body');
  const candidates = [body, ...Array.from(body.querySelectorAll('section,div')).slice(0, 2_000)];
  return candidates.reduce((best, candidate) => densityScore(candidate) > densityScore(best) ? candidate : best, body);
}

function resolveLinks(element: Element, baseUrl: string): DocumentLink[] | undefined {
  const links: DocumentLink[] = [];
  for (const anchor of element.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (href === null) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      url.hash = '';
      links.push({ text: cleanText(anchor.textContent ?? ''), url: url.toString() });
    } catch {
      // Broken links do not invalidate otherwise useful document text.
    }
  }
  return links.length === 0 ? undefined : links;
}

function tableText(table: Element): string {
  const rows: string[] = [];
  for (const row of table.querySelectorAll('tr')) {
    const cells = Array.from(row.querySelectorAll('th,td')).map((cell) => cleanText(cell.textContent ?? '')).filter(Boolean);
    if (cells.length > 0) rows.push(cells.join(' | '));
  }
  return rows.join('\n');
}

function htmlRole(tag: string): ElementRole {
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'li') return 'list-item';
  if (tag === 'pre') return 'code';
  if (tag === 'blockquote') return 'quote';
  if (tag === 'table') return 'table';
  if (tag === 'figcaption') return 'figure-caption';
  return 'paragraph';
}

export function extractHtml(html: string, url: string, options: Partial<ExtractLimits> = {}): ExtractedDocument {
  const limits = { ...DEFAULT_EXTRACT_LIMITS, ...options };
  const warnings: string[] = [];
  const { document } = parseHTML(html);
  const metadata: NonNullable<ExtractedDocument['metadata']> = {};
  for (const [field, names] of Object.entries({ publishedAt: ['article:published_time', 'datePublished'],
    effectiveAt: ['effectiveAt', 'validFrom'], expiresAt: ['expiresAt', 'expires', 'validThrough'], reviewedAt: ['reviewedAt', 'lastReviewed'] })) {
    const values = new Set(names.flatMap(name => Array.from(document.querySelectorAll(`meta[name="${name}"],meta[property="${name}"],meta[itemprop="${name}"]`)).map(node => node.getAttribute('content')?.trim()).filter((value): value is string => !!value)));
    if (values.size === 1) metadata[field as keyof typeof metadata] = [...values][0];
    else if (values.size > 1) warnings.push(`ignored conflicting ${field} metadata`);
  }
  const canonicalHref = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  let canonicalUrl: string | undefined;
  if (canonicalHref !== null && canonicalHref !== undefined) {
    try {
      const candidate = new URL(canonicalHref, url);
      if (candidate.protocol === 'http:' || candidate.protocol === 'https:') {
        candidate.hash = '';
        canonicalUrl = candidate.toString();
      }
    } catch {
      warnings.push('ignored invalid canonical URL');
    }
  }
  const root = chooseContentRoot(document);
  for (const selector of BOILERPLATE_SELECTORS) {
    for (const element of root.querySelectorAll(selector)) element.remove();
  }

  const title = cleanText(document.querySelector('h1')?.textContent ?? document.title ?? '') || null;
  const elements: ElementDraft[] = [];
  const headingStack: Array<{ level: number; text: string }> = [];
  const candidates = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,table,figcaption'));
  for (const candidate of candidates) {
    const tag = candidate.tagName.toLowerCase();
    const parentBlock = candidate.parentElement?.closest('p,li,pre,blockquote,table,figcaption');
    if (parentBlock !== null && parentBlock !== candidate) continue;
    const text = tag === 'table' ? tableText(candidate) : cleanText(candidate.textContent ?? '');
    if (text.length === 0) continue;
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
      headingStack.push({ level, text });
    }
    elements.push({
      text,
      role: elements.length === 0 && tag === 'h1' ? 'title' : htmlRole(tag),
      order: elements.length,
      headingPath: headingStack.map((heading) => heading.text),
      centroid: { x: Math.max(0, headingStack.length - 1), y: elements.length },
      links: resolveLinks(candidate, canonicalUrl ?? url),
    });
  }
  const usefulChars = elements.reduce((sum, element) => sum + element.text.length, 0);
  if (usefulChars < limits.minUsefulChars) warnings.push(`low-content extraction: ${usefulChars} useful characters`);
  return { title, canonicalUrl, elements: capElements(elements, limits, warnings), warnings, ...(Object.keys(metadata).length ? { metadata } : {}) };
}

interface TextBlock {
  text: string;
  role: ElementRole;
  depth: number;
  headingPath: string[];
}

function textBlocks(text: string, markdown: boolean): TextBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: TextBlock[] = [];
  const current: string[] = [];
  const headings: Array<{ level: number; text: string }> = [];
  let fence: string | undefined;

  const flush = (): void => {
    const value = cleanText(current.join('\n'));
    current.length = 0;
    if (value === '') return;
    const first = value.split('\n', 1)[0];
    const heading = markdown ? first.match(/^(#{1,6})\s+(.+)$/) : null;
    if (heading !== null) {
      const level = heading[1].length;
      const label = heading[2].trim();
      while (headings.length > 0 && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, text: label });
      blocks.push({ text: value, role: 'heading', depth: level - 1, headingPath: headings.map((item) => item.text) });
      return;
    }
    const role: ElementRole = fence !== undefined ? 'code'
      : /^\s*(?:[-*+] |\d+\. )/.test(first) ? 'list-item'
      : /^\s*>/.test(first) ? 'quote' : 'paragraph';
    blocks.push({ text: value, role, depth: Math.max(0, headings.length - 1), headingPath: headings.map((item) => item.text) });
  };

  for (const line of lines) {
    const marker = markdown ? line.trim().match(/^(`{3,}|~{3,})/)?.[1] : undefined;
    if (fence !== undefined) {
      current.push(line);
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && /^(`+|~+)\s*$/.test(line.trim())) {
        flush();
        fence = undefined;
      }
    } else if (marker !== undefined) {
      flush();
      fence = marker;
      current.push(line);
    } else if (line.trim() === '') {
      flush();
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

export function extractTextDocument(text: string, markdown: boolean, options: Partial<ExtractLimits> = {}): ExtractedDocument {
  const limits = { ...DEFAULT_EXTRACT_LIMITS, ...options };
  const warnings: string[] = [];
  const blocks = textBlocks(text, markdown);
  const elements = blocks.map<ElementDraft>((block, order) => ({
    text: block.text,
    role: block.role,
    order,
    headingPath: block.headingPath,
    centroid: { x: block.depth, y: order },
  }));
  const titleBlock = blocks.find((block) => block.role === 'heading');
  const title = titleBlock?.text.replace(/^#{1,6}\s+/, '') ?? null;
  return { title, elements: capElements(elements, limits, warnings), warnings };
}

export async function extractStaticDocument(bytes: Uint8Array, options: ExtractOptions): Promise<ExtractedDocument> {
  if (options.mimeType === 'application/pdf') throw new DocumentError('unsupported-mime', 'Static extraction requires the host PDF extractor for PDF bytes.');
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (options.mimeType === 'text/html') return extractHtml(text, options.url, options.limits);
  return extractTextDocument(text, options.mimeType === 'text/markdown', options.limits);
}
