/**
 * The two offline stand-ins — an embedder and a contradiction judge —
 * that let the whole pipeline run with zero network, promoted out of
 * `examples/skeleton.ts` because the desktop app and the pages demo
 * need them as real seams.
 *
 * `createOfflineEmbedder` is @jarenjs/ai's `createHashEmbedder` — the
 * suite's own deterministic hashed-trigram reference, behind the same
 * `{ embed, model, dims }` seam a wire client fills — at the width the
 * pipeline's thresholds were measured against. Measured over the
 * skeleton corpus (2026-08-26, `hash-trigram-<dims>`, cosine), against
 * the defaults novelty 0.97 / crystallize 0.9 / contradiction 0.8:
 *
 *   dims  repeat  paraphrase  contradiction  max-unrelated
 *    64   0.989   0.931       0.964          0.606   ← every pair on its side of every threshold
 *   128   0.985   0.902       0.954          0.424   ← paraphrase a hair over the 0.9 merge line
 *   256   0.984   0.888       0.941          0.323   ← paraphrase under the merge line: never crystallized
 *   512   0.983   0.884       0.936          0.225
 *
 * 64 — the suite's own default — is the width with margin on all four:
 * wider buckets spread the shared trigrams thinner, so the paraphrase
 * loses its merge long before an unrelated pair threatens the 0.8
 * judge line. It stays demo-grade and lexical — a real model behind
 * the same seam is the upgrade.
 *
 * `numericContrastJudge` flags two records that agree in words but
 * disagree in figures — the rule stand-in for an LLM contradiction
 * judge (`createStructuredOutput` over `contradictionMessages`).
 */

import { createHashEmbedder, type Embedder } from '@jarenjs/ai/embed';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import type { ContradictionVerdict } from '@tangleai/memory';

/** The measured width (see the header). */
export const OFFLINE_EMBEDDER_DIMS = 64;

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
