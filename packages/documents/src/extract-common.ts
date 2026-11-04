import { DocumentError, type BoundingBox, type DocumentElement } from './contracts.ts';

export type ElementDraft = Omit<DocumentElement, 'id' | 'sourceId' | 'versionId'>;

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

/**
 * A host's OCR, for the PDF pages that carry no text. `version` names it: it
 * enters the extraction identity, so a document read with and without OCR
 * never shares a version. `read` receives the page number, its size in PDF
 * points and the whole PDF — drawing the page is the host's, Tangle renders
 * nothing — and answers the page's text, or its lines with optional boxes.
 */
export interface PdfOcr {
  version: string;
  read: (page: { page: number; width: number; height: number; pdf: Uint8Array }) =>
    Promise<string | Array<{ text: string; bbox?: BoundingBox }>>;
}

export interface ExtractOptions {
  mimeType: string;
  url: string;
  limits?: Partial<ExtractLimits>;
  ocr?: PdfOcr;
}

export function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function capElements(elements: ElementDraft[], limits: ExtractLimits, warnings: string[]): ElementDraft[] {
  if (elements.length <= limits.maxElements) return elements;
  if (!limits.allowPartial) {
    throw new DocumentError('element-budget', `Document produced ${elements.length} elements; limit is ${limits.maxElements}`);
  }
  warnings.push(`partial extraction: retained ${limits.maxElements} of ${elements.length} elements`);
  return elements.slice(0, limits.maxElements).map((element, order) => ({ ...element, order }));
}
