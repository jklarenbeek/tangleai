import { extractTextItems, getDocumentProxy, getMeta, type StructuredTextItem } from 'unpdf';
import { DocumentError, type BoundingBox, type ElementRole, type ExtractedDocument } from './contracts.ts';
import { cleanText, capElements, DEFAULT_EXTRACT_LIMITS, type ElementDraft, type ExtractLimits, type ExtractOptions } from './extract-common.ts';
import { extractStaticDocument } from './extract-static.ts';
export { DEFAULT_EXTRACT_LIMITS, type ExtractLimits, type ExtractOptions } from './extract-common.ts';
export { extractHtml, extractTextDocument, extractStaticDocument } from './extract-static.ts';

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
  return extractStaticDocument(bytes, options);
}
