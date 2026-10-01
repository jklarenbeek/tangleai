import { DocumentError, type DocumentElement } from './contracts.ts';

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

export interface ExtractOptions {
  mimeType: string;
  url: string;
  limits?: Partial<ExtractLimits>;
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
