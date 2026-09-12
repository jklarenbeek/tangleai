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
 * given first. For the same reason a candidate is only measured against
 * records embedded by the SAME identity (`embeddedBy`): vectors from two
 * models compare into plausible garbage, and jarenjs's rule is that they
 * are never compared — so a record from another embedder is, to this
 * candidate, unmeasurable.
 *
 * The metric is `cosineSimilarity` from `@jarenjs/core/vector` — the one
 * the suite ranks by, and the one under which the pipeline's normalized
 * vectors agree with dot and Euclidean in rank anyway.
 *
 * Pure: no store, no clock, no log. The caller applies the result.
 */

import { cosineSimilarity } from '@jarenjs/core/vector';
import { sameIdentity } from '@tangleai/context/ledger';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

export const DEFAULT_NOVELTY_THRESHOLD = 0.75;

export interface NoveltyOptions {
  threshold?: number;
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

  const novel: MemoryUnit[] = [];
  const filtered: MemoryUnit[] = [];

  const duplicates = (unit: MemoryUnit, against: MemoryUnit[]): boolean => {
    for (const other of against) {
      if (!sameIdentity(unit.embeddedBy, other.embeddedBy)) continue;
      if (cosineSimilarity(unit.embedding, other.embedding) >= threshold) return true;
    }
    return false;
  };

  for (const unit of candidates) {
    if (unit.embedding === undefined || unit.embeddedBy === undefined) {
      novel.push(unit);
      continue;
    }
    if (duplicates(unit, existing) || duplicates(unit, novel)) {
      filtered.push(unit);
    }
    else {
      novel.push(unit);
    }
  }

  return { novel, filtered };
}
