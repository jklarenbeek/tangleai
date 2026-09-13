/** Domain normalization over the public bounded Jaren lexical owner. */
import { compileLexical, SEARCH_LIMITS } from '@jarenjs/core/search';
export function consolidationTerms(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
export function consolidationTermCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of consolidationTerms(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}
export interface LexicalDocument { id: string; text: string }
export function createConsolidationLexicalIndex(documents: readonly LexicalDocument[], options: {
  limits?: Partial<Record<keyof typeof SEARCH_LIMITS, number>>;
} = {}) {
  // The published declarations narrow limit values to defaults and omit search hits.
  // Keep a small checked bridge around the public runtime; no private imports.
  const compiled = compileLexical({ version: 1, fields: ['text'], profile: 'lexical-key/1',
    prefix: false, fuzzy: 0, combineWith: 'OR', normalization: 'tangle-nfkc-words/1', limits: options.limits as Partial<typeof SEARCH_LIMITS> });
  const { limits } = compiled.config;
  if (documents.length > limits.maxDocuments || documents.some(document => document.text.length > limits.maxFieldBytes))
    throw new RangeError('lexical source exceeds host normalization bounds');
  const order = new Map(documents.map((document, i) => [document.id, i]));
  const index = compiled.create();
  const normalized = documents.map(document => ({ id: document.id, text: consolidationTerms(document.text).join(' ') }));
  const built = index.rebuild(normalized);
  if (built.state !== 'complete') throw new Error(`lexical preparation ${built.state}: ${built.reason}`);
  return Object.freeze({
    rank(query: string, limit = Math.min(documents.length, limits.maxResults)): { id: string; score: number }[] {
      if (query.length > limits.maxQueryBytes) throw new RangeError('lexical query exceeds host normalization bound');
      const result = index.search([...new Set(consolidationTerms(query))].join(' '), { limit,
        compare: (a: { id: string; score: number }, b: { id: string; score: number }) => b.score - a.score || order.get(a.id)! - order.get(b.id)! }) as { state: string; reason?: string; hits?: { id: string; score: number }[] };
      if (result.state !== 'complete' || !Array.isArray(result.hits)) throw new Error(`lexical retrieval ${result.state}: ${result.reason}`);
      return result.hits;
    },
  });
}
/** Reciprocal rank is routing only; callers still expand and budget original evidence. */
export function fuseConsolidationRanks(ranks: readonly (readonly string[])[], k = 60): string[] {
  if (!Number.isFinite(k) || k <= 0) throw new TypeError('reciprocal rank constant must be positive');
  const scores = new Map<string, { score: number; order: number }>();
  for (const ranking of ranks) for (const [index, id] of [...new Set(ranking)].entries()) {
    const row = scores.get(id) ?? { score: 0, order: scores.size };
    row.score += 1 / (k + index + 1); scores.set(id, row);
  }
  return [...scores].sort(([, a], [, b]) => b.score - a.score || a.order - b.order).map(([id]) => id);
}
