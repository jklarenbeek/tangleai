/** Frozen pre-integration BM25 experiment, retained only for measurement attribution. */
import { consolidationTermCounts, consolidationTerms, type LexicalDocument } from '@tangleai/memory/consolidation';
export function createFrozenBm25Reference(documents: readonly LexicalDocument[], options: { k1?: number; b?: number } = {}) {
  const k1 = options.k1 ?? 1.2, b = options.b ?? 0.75;
  if (!Number.isFinite(k1) || k1 <= 0 || !Number.isFinite(b) || b < 0 || b > 1
    || new Set(documents.map(document => document.id)).size !== documents.length) throw new TypeError('invalid lexical index configuration or duplicate id');
  const frequency = new Map<string, number>();
  const rows = documents.map((document, sequence) => {
    const terms = consolidationTermCounts(document.text);
    for (const term of terms.keys()) frequency.set(term, (frequency.get(term) ?? 0) + 1);
    return { id: document.id, sequence, terms, length: [...terms.values()].reduce((sum, count) => sum + count, 0) };
  });
  const average = rows.reduce((sum, row) => sum + row.length, 0) / (rows.length || 1);
  return Object.freeze({
    rank(query: string, limit = rows.length): { id: string; score: number }[] {
      if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('lexical limit must be a nonnegative integer');
      const terms = [...new Set(consolidationTerms(query))];
      return rows.map(row => {
        let score = 0;
        for (const term of terms) {
          const tf = row.terms.get(term) ?? 0; if (!tf) continue;
          const df = frequency.get(term)!;
          score += Math.log(1 + (rows.length - df + 0.5) / (df + 0.5)) * tf * (k1 + 1)
            / (tf + k1 * (1 - b + b * row.length / average));
        }
        return { id: row.id, score, sequence: row.sequence };
      }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.sequence - b.sequence)
        .slice(0, limit).map(({ id, score }) => ({ id, score }));
    },
  });
}
