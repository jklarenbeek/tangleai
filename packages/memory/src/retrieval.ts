/**
 * Embedding-ranked retrieval over memory units.
 *
 * This is Tangle's ranker over its OWN store of full units, beside the
 * @jarenjs/ai ledger's `recall({ near })` (which ranks the mirrored
 * ledger records the same way, through the same kernels). Superseded
 * records never surface — they exist for audit, not for recall. Records
 * without embeddings never surface either, which is a real bias (see
 * novelty.ts for the opposite choice on admission) — an un-embedded
 * record can be ADMITTED honestly but cannot be RANKED honestly, so it
 * waits for an embed pass rather than polluting the ranking with a fake
 * score.
 *
 * The identity rule is the ledger's: a vector never ranks against one
 * from another model. Given the query embedder's `identity`, only
 * records embedded by it are ranked; the rest are reported in
 * `skipped`, never scored and never hidden. Without an identity every
 * embedded record is ranked — the caller has declared that it knows
 * what it is comparing.
 *
 * The metric is `cosineSimilarity` from `@jarenjs/core/vector`: the one
 * the suite ranks by, higher-is-better, 0 for a malformed pair.
 */

import { cosineSimilarity, type Vector } from '@jarenjs/core/vector';
import { sameEmbeddedBy, type EmbeddedBy, type MemoryUnit } from '@tangleai/core/schemas/memory';

export interface RankOptions {
  k?: number;
  minScore?: number;
  /** The query embedder's identity; records embedded by another are skipped. */
  identity?: EmbeddedBy;
}

export interface RankedMemory {
  unit: MemoryUnit;
  score: number;
}

export interface RankedRecall {
  /** Best first, at most `k`. */
  ranked: RankedMemory[];
  /** Live records that carry no vector, or a vector from another identity. */
  skipped: number;
}

/**
 * Rank the live, comparably-embedded units against a query vector and
 * report what could not be ranked. `queryEmbedding` may be the
 * `Float32Array` an embedder answers or the `number[]` a record stores.
 */
export function recallByEmbedding(
  units: MemoryUnit[],
  queryEmbedding: Vector,
  options: RankOptions = {},
): RankedRecall {
  const k = options.k ?? 5;
  const minScore = options.minScore ?? 0;
  const identity = options.identity;

  const scored: RankedMemory[] = [];
  let skipped = 0;
  for (const unit of units) {
    if (unit.supersededBy !== undefined) continue;
    const comparable = unit.embedding !== undefined && unit.embeddedBy !== undefined
      && (identity === undefined || sameEmbeddedBy(unit.embeddedBy, identity));
    if (!comparable) {
      skipped++;
      continue;
    }
    scored.push({ unit, score: cosineSimilarity(unit.embedding, queryEmbedding) });
  }

  const ranked = scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return { ranked, skipped };
}

/** Best first, at most `k` — `recallByEmbedding` without the skip report. */
export function rankByEmbedding(
  units: MemoryUnit[],
  queryEmbedding: Vector,
  options: RankOptions = {},
): RankedMemory[] {
  return recallByEmbedding(units, queryEmbedding, options).ranked;
}
