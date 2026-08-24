/**
 * Novelty gate — LightMem's Tier-1 sensory filter (arXiv 2510.18866),
 * ported from memflow `NoveltyGateModule` as a pure function.
 *
 * A candidate passes if it is sufficiently DIFFERENT from every existing
 * memory and from every candidate already admitted in this batch (the
 * batch self-check is what stops ten copies of the same observation from
 * all being "novel against the store"). A candidate without an embedding
 * passes — novelty cannot be measured, and silently dropping what we
 * cannot measure would bias the store toward whatever the embedder was
 * given first.
 *
 * Pure: no store, no clock, no log. The caller applies the result.
 */

import { similarity, type SimilarityFunction } from '@tangleai/core/similarity';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

export const DEFAULT_NOVELTY_THRESHOLD = 0.75;

export interface NoveltyOptions {
  threshold?: number;
  similarityFunction?: SimilarityFunction;
}

export interface NoveltyOutcome {
  novel: MemoryUnit[];
  filtered: MemoryUnit[];
}

export function noveltyGate(
  candidates: MemoryUnit[],
  existing: MemoryUnit[],
  options: NoveltyOptions = {},
): NoveltyOutcome {
  const threshold = options.threshold ?? DEFAULT_NOVELTY_THRESHOLD;
  const fn = options.similarityFunction ?? 'cosine';

  const novel: MemoryUnit[] = [];
  const filtered: MemoryUnit[] = [];

  const duplicates = (embedding: number[], against: MemoryUnit[]): boolean => {
    for (const other of against) {
      if (!other.embedding || other.embedding.length === 0) continue;
      if (similarity(embedding, other.embedding, fn) >= threshold) return true;
    }
    return false;
  };

  for (const unit of candidates) {
    if (!unit.embedding || unit.embedding.length === 0) {
      novel.push(unit);
      continue;
    }
    if (duplicates(unit.embedding, existing) || duplicates(unit.embedding, novel)) {
      filtered.push(unit);
    }
    else {
      novel.push(unit);
    }
  }

  return { novel, filtered };
}
