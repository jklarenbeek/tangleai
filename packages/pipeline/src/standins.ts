/**
 * The two offline stand-ins — an embedder and a contradiction judge —
 * that let the whole pipeline run with zero network, promoted out of
 * `examples/skeleton.ts` because the desktop app and the pages demo
 * need them as real seams.
 *
 * `createOfflineEmbedder` is @jarenjs/ai's `createHashEmbedder` — the
 * suite's own deterministic hashed-trigram reference, behind the same
 * `{ embed, model, dims }` seam a wire client fills — at the width the
 * pipeline's thresholds were measured against. The suite's default is
 * 64 buckets, and at 64 the hash collides enough to inflate UNRELATED
 * sentences to 0.85 cosine, past the 0.8 contradiction threshold, so
 * the judge is asked about pairs that share nothing. Measured over the
 * skeleton corpus (2026-08-26, `hash-trigram-<dims>`):
 *
 *   dims  repeat  paraphrase  contradiction  max-unrelated
 *    64   0.996   0.970       0.980          0.856   ← contradiction gated, unrelated judged
 *   128   0.993   0.959       0.966          0.754
 *   256   0.991   0.944       0.958          0.605   ← every pair on its side of every threshold
 *   512   0.989   0.901       0.950          0.497   ← paraphrase a hair over the 0.9 merge line
 *
 * 256 is the width with margin on all four; it stays demo-grade and
 * lexical — a real model behind the same seam is the upgrade.
 *
 * `numericContrastJudge` flags two records that agree in words but
 * disagree in figures — the rule stand-in for an LLM contradiction
 * judge (`createStructuredOutput` over `contradictionMessages`).
 */

import { createHashEmbedder, type Embedder } from '@jarenjs/ai/embed';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import type { ContradictionVerdict } from '@tangleai/memory';

/** The measured width (see the header). */
export const OFFLINE_EMBEDDER_DIMS = 256;

/** The offline embedder: the suite's hash reference at the measured width. */
export function createOfflineEmbedder(): Embedder & { dims: number } {
  return createHashEmbedder({ dims: OFFLINE_EMBEDDER_DIMS });
}

export type Judge = (a: MemoryUnit, b: MemoryUnit) => Promise<ContradictionVerdict>;

/** Same subject, different figures → contradiction; newer text wins. */
export function numericContrastJudge(): Judge {
  const numbers = (t: string): string => t.match(/\d+(?:\.\d+)?/g)?.join(',') ?? '';
  return async (a, b) => {
    if (numbers(a.text) !== numbers(b.text)) {
      const newer = a.at <= b.at ? b : a;
      return { contradiction: true, reason: 'same subject, different figures', resolution: newer.text };
    }
    return { contradiction: false };
  };
}
