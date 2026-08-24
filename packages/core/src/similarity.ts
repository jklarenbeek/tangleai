/**
 * Vector similarity strategies. Ported from memflow `src/utils/similarity.ts`
 * (which itself consolidated three inline copies).
 *
 * Every strategy returns higher-is-more-similar, and every strategy
 * returns 0 for mismatched or empty inputs rather than throwing: a
 * malformed embedding among ten thousand good ones should lose the
 * comparison, not kill the sweep.
 */

export type SimilarityFunction = 'cosine' | 'euclidean' | 'dotProduct';

export function similarity(a: number[], b: number[], fn: SimilarityFunction = 'cosine'): number {
  switch (fn) {
    case 'dotProduct': return dotProductSimilarity(a, b);
    case 'euclidean': return euclideanSimilarity(a, b);
    case 'cosine':
    default: return cosineSimilarity(a, b);
  }
}

/** Cosine similarity in [-1, 1]; 0 for invalid input. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Raw dot product, unbounded; 0 for invalid input. */
export function dotProductSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** `1 / (1 + distance)`, in (0, 1]; 0 for invalid input. */
export function euclideanSimilarity(a: number[], b: number[]): number {
  const dist = euclideanDistance(a, b);
  return dist === Infinity ? 0 : 1 / (1 + dist);
}

/** Euclidean distance; Infinity for invalid input. */
export function euclideanDistance(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * L2-normalise in place; no-op on (near-)zero vectors. Returns the same
 * array for chaining.
 */
export function l2Normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm < 1e-12) return v;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}
