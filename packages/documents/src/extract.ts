import { parseHTML } from 'linkedom';
import { extractTextItems, getDocumentProxy, getMeta, type StructuredTextItem } from 'unpdf';

import { DocumentError, type BoundingBox, type DocumentElement, type DocumentLink, type ElementRole, type ExtractedDocument } from './contracts.ts';

type ElementDraft = Omit<DocumentElement, 'id' | 'sourceId' | 'versionId'>;

export interface ExtractLimits {
  maxPages: number;
  maxElements: number;
  minUsefulChars: number;
  allowPartial: boolean;
}

export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxPages: 200,
  maxElements: 20_000,
  minUsefulChars: 160,
  allowPartial: false,
};

export interface ExtractOptions {
  mimeType: string;
  url: string;
  limits?: Partial<ExtractLimits>;
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function capElements(elements: ElementDraft[], limits: ExtractLimits, warnings: string[]): ElementDraft[] {
  if (elements.length <= limits.maxElements) return elements;
  if (!limits.allowPartial) {
    throw new DocumentError('element-budget', `Document produced ${elements.length} elements; limit is ${limits.maxElements}`);
  }
  warnings.push(`partial extraction: retained ${limits.maxElements} of ${elements.length} elements`);
  return elements.slice(0, limits.maxElements).map((element, order) => ({ ...element, order }));
}

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
  return { title, canonicalUrl, elements: capElements(elements, limits, warnings), warnings };
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

interface PdfLine {
  text: string;
  bbox: BoundingBox;
  page: number;
  fontSize: number;
  fontFamily: string;
  role?: ElementRole;
}

function mergePdfItems(items: StructuredTextItem[], page: number): PdfLine {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let text = '';
  let prior: StructuredTextItem | undefined;
  for (const item of sorted) {
    const gap = prior === undefined ? 0 : item.x - (prior.x + prior.width);
    const needsSpace = text !== '' && gap > Math.max(0.5, item.fontSize * 0.08)
      && !/^[,.;:!?%)\]}]/.test(item.str) && !/[([{\-\/]$/.test(text);
    text += `${needsSpace ? ' ' : ''}${item.str}`;
    prior = item;
  }
  const minX = Math.min(...sorted.map((item) => item.x));
  const minY = Math.min(...sorted.map((item) => item.y));
  const maxX = Math.max(...sorted.map((item) => item.x + item.width));
  const maxY = Math.max(...sorted.map((item) => item.y + item.height));
  const fonts = new Map<string, number>();
  for (const item of sorted) fonts.set(`${item.fontSize}|${item.fontFamily}`, (fonts.get(`${item.fontSize}|${item.fontFamily}`) ?? 0) + 1);
  const common = [...fonts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.split('|') ?? [String(sorted[0].fontSize), sorted[0].fontFamily];
  return { text: cleanText(text), bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY }, page, fontSize: Number(common[0]), fontFamily: common.slice(1).join('|') };
}

function groupPdfLines(items: StructuredTextItem[], page: number, pageHeight: number): PdfLine[] {
  const usable = items.filter((item) => item.str.trim() !== '' && item.width >= 0 && item.height >= 0);
  const sorted = [...usable].sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);
  const rows: StructuredTextItem[][] = [];
  for (const item of sorted) {
    const row = rows.find((candidate) => Math.abs(candidate[0].y - item.y) <= Math.max(1.5, item.fontSize * 0.18));
    if (row === undefined) rows.push([item]);
    else row.push(item);
  }
  const lines: PdfLine[] = [];
  for (const row of rows) {
    const across = [...row].sort((a, b) => a.x - b.x);
    let segment: StructuredTextItem[] = [];
    for (const item of across) {
      const prior = segment[segment.length - 1];
      const gap = prior === undefined ? 0 : item.x - (prior.x + prior.width);
      const threshold = Math.max(28, Math.max(prior?.fontSize ?? 0, item.fontSize) * 4.5);
      if (prior !== undefined && gap > threshold) {
        lines.push(mergePdfItems(segment, page));
        segment = [];
      }
      segment.push(item);
    }
    if (segment.length > 0) lines.push(mergePdfItems(segment, page));
  }
  for (const line of lines) line.bbox.y = pageHeight - (line.bbox.y + line.bbox.h);
  return lines;
}

function mergePdfTableRows(lines: PdfLine[], pageWidth: number): PdfLine[] {
  const remaining = new Set(lines);
  const merged: PdfLine[] = [];
  for (const line of lines) {
    if (!remaining.has(line)) continue;
    const row = lines.filter((candidate) => remaining.has(candidate) && Math.abs(candidate.bbox.y - line.bbox.y) <= 1.5)
      .sort((a, b) => a.bbox.x - b.bbox.x);
    const gaps = row.slice(1).map((candidate, index) => candidate.bbox.x - (row[index].bbox.x + row[index].bbox.w));
    const looksTabular = row.length >= 2 && gaps.every((gap) => gap >= 8 && gap <= pageWidth * 0.3);
    if (!looksTabular) {
      remaining.delete(line);
      merged.push(line);
      continue;
    }
    for (const cell of row) remaining.delete(cell);
    const minX = row[0].bbox.x;
    const minY = Math.min(...row.map((cell) => cell.bbox.y));
    const maxX = Math.max(...row.map((cell) => cell.bbox.x + cell.bbox.w));
    const maxY = Math.max(...row.map((cell) => cell.bbox.y + cell.bbox.h));
    merged.push({
      ...row[0],
      text: row.map((cell) => cell.text).join(' | '),
      bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
      role: 'table',
    });
  }
  return merged;
}

function sortPdfReadingOrder(lines: PdfLine[], pageWidth: number): PdfLine[] {
  if (lines.length < 6) return [...lines].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const middle = pageWidth / 2;
  const margin = pageWidth * 0.035;
  const left = lines.filter((line) => line.bbox.x + line.bbox.w <= middle + margin);
  const right = lines.filter((line) => line.bbox.x >= middle - margin);
  if (left.length < 3 || right.length < 3) return [...lines].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const spanning = lines.filter((line) => !left.includes(line) && !right.includes(line)).sort((a, b) => a.bbox.y - b.bbox.y);
  const result: PdfLine[] = [];
  let top = -Infinity;
  for (const divider of [...spanning, { bbox: { y: Infinity } } as PdfLine]) {
    const bottom = divider.bbox.y;
    const band = lines.filter((line) => line.bbox.y > top && line.bbox.y < bottom && !spanning.includes(line));
    result.push(...band.filter((line) => left.includes(line)).sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x));
    result.push(...band.filter((line) => right.includes(line)).sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x));
    if (Number.isFinite(bottom)) result.push(divider);
    top = bottom;
  }
  return result;
}

function repeatedMarginText(pages: PdfLine[][], heights: number[]): Set<string> {
  const occurrences = new Map<string, Set<number>>();
  pages.forEach((lines, index) => {
    const height = heights[index];
    for (const line of lines) {
      const normalized = line.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
      if (normalized.length < 3) continue;
      const margin = line.bbox.y <= height * 0.1 || line.bbox.y + line.bbox.h >= height * 0.9;
      if (!margin) continue;
      const set = occurrences.get(normalized) ?? new Set<number>();
      set.add(index);
      occurrences.set(normalized, set);
    }
  });
  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  return new Set([...occurrences].filter(([, seen]) => seen.size >= threshold).map(([text]) => text));
}

export async function extractPdf(bytes: Uint8Array, options: Partial<ExtractLimits> = {}): Promise<ExtractedDocument> {
  const limits = { ...DEFAULT_EXTRACT_LIMITS, ...options };
  const warnings: string[] = [];
  const data = new Uint8Array(bytes);
  const pdf = await getDocumentProxy(data);
  try {
    if (pdf.numPages > limits.maxPages) {
      if (!limits.allowPartial) throw new DocumentError('page-budget', `PDF has ${pdf.numPages} pages; limit is ${limits.maxPages}`);
      warnings.push(`partial extraction: retained ${limits.maxPages} of ${pdf.numPages} pages`);
    }
    const pagesToRead = Math.min(pdf.numPages, limits.maxPages);
    const extracted = await extractTextItems(pdf);
    const pageLines: PdfLine[][] = [];
    const heights: number[] = [];
    const widths: number[] = [];
    for (let pageIndex = 0; pageIndex < pagesToRead; pageIndex++) {
      const page = await pdf.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      heights.push(viewport.height);
      widths.push(viewport.width);
      pageLines.push(mergePdfTableRows(
        groupPdfLines(extracted.items[pageIndex] ?? [], pageIndex + 1, viewport.height),
        viewport.width,
      ));
      page.cleanup();
    }
    const repeated = repeatedMarginText(pageLines, heights);
    const filtered = pageLines.map((lines, pageIndex) => lines.filter((line) => {
      const normalized = line.text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
      if (repeated.has(normalized)) return false;
      const bottom = line.bbox.y + line.bbox.h >= heights[pageIndex] * 0.9;
      return !(bottom && /^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(line.text));
    }));
    const ordered = filtered.flatMap((lines, index) => sortPdfReadingOrder(lines, widths[index]));
    const fontSizes = ordered.map((line) => line.fontSize).filter(Number.isFinite).sort((a, b) => a - b);
    const medianFont = fontSizes[Math.floor(fontSizes.length / 2)] ?? 10;
    const headings: string[] = [];
    let elements = ordered.filter((line) => line.text !== '').map<ElementDraft>((line, order) => {
      const heading = line.fontSize >= medianFont * 1.3 && line.text.length <= 180;
      if (heading) {
        while (headings.length > 0) headings.pop();
        headings.push(line.text);
      }
      const role: ElementRole = line.role ?? (heading ? 'heading'
        : /^(?:figure|fig\.|table)\s+\d+/i.test(line.text) ? 'figure-caption' : 'paragraph');
      return {
        text: line.text,
        role,
        order,
        headingPath: [...headings],
        page: line.page,
        bbox: line.bbox,
        centroid: { x: line.bbox.x + line.bbox.w / 2, y: line.page * 100_000 + line.bbox.y + line.bbox.h / 2 },
      };
    });
    elements = capElements(elements, limits, warnings);
    let title: string | null = elements.find((element) => element.role === 'heading')?.text ?? null;
    try {
      const meta = await getMeta(pdf);
      const candidate = meta.info.Title;
      if (typeof candidate === 'string' && candidate.trim() !== '') title = cleanText(candidate);
    } catch {
      warnings.push('PDF metadata could not be read');
    }
    return { title, elements, pages: pagesToRead, warnings };
  } finally {
    await pdf.destroy();
  }
}

export async function extractDocument(bytes: Uint8Array, options: ExtractOptions): Promise<ExtractedDocument> {
  if (options.mimeType === 'application/pdf') return extractPdf(bytes, options.limits);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (options.mimeType === 'text/html') return extractHtml(text, options.url, options.limits);
  return extractTextDocument(text, options.mimeType === 'text/markdown', options.limits);
}
