/** Offline seams: the selected lexical hash width and the local numeric-contrast judge. */
import { createHashEmbedder, type Embedder } from '@tangleai/models/embed';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { DEFAULT_MEMORY_POLICY, type ContradictionVerdict } from '@tangleai/memory';

/** Selected by lexical evidence recall, independently of live F1. */
export const OFFLINE_EMBEDDER_DIMS = DEFAULT_MEMORY_POLICY.embedding.dims;

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
