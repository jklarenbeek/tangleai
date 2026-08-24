/**
 * Embedding-ranked retrieval over memory units.
 *
 * This is the vector complement to the @jarenjs/ai ledger's deliberate
 * tag-plus-recency recall: the ledger refuses to rank without an
 * instrument, and this function IS the injectable ranker a host hands
 * it. Superseded records never surface — they exist for audit, not for
 * recall. Records without embeddings never surface either, which is a
 * real bias (see novelty.ts for the opposite choice on admission) — an
 * un-embedded record can be ADMITTED honestly but cannot be RANKED
 * honestly, so it waits for an embed pass rather than polluting the
 * ranking with a fake score.
 */

import { similarity, type SimilarityFunction } from '@tangleai/core/similarity';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

export interface RankOptions {
  k?: number;
  minScore?: number;
  similarityFunction?: SimilarityFunction;
}

export interface RankedMemory {
  unit: MemoryUnit;
  score: number;
}

/** Best first, at most `k`. */
export function rankByEmbedding(
  units: MemoryUnit[],
  queryEmbedding: number[],
  options: RankOptions = {},
): RankedMemory[] {
  const k = options.k ?? 5;
  const minScore = options.minScore ?? 0;
  const fn = options.similarityFunction ?? 'cosine';

  return units
    .filter((u): u is MemoryUnit & { embedding: number[] } =>
      !u.supersededBy && u.embedding !== undefined && u.embedding.length > 0)
    .map((unit) => ({ unit, score: similarity(unit.embedding, queryEmbedding, fn) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
