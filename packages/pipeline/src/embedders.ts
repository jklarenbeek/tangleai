/**
 * The built-in embedder and judge — the two stand-ins that make the
 * whole pipeline run OFFLINE, promoted out of `examples/skeleton.ts`
 * because the desktop app and the pages demo need them as real seams.
 *
 * `trigramEmbedding` hashes character trigrams into a fixed number of
 * dimensions and L2-normalises — deterministic, dependency-free, real
 * enough that paraphrases land near each other. It is demo-grade on
 * purpose: swap in `createEmbeddingClient` from @tangleai/providers for
 * real vectors; the pipeline only sees `embed(texts) => vectors`.
 *
 * `numericContrastJudge` flags two records that agree in words but
 * disagree in figures — the rule stand-in for an LLM contradiction
 * judge (`createStructuredOutput` over `contradictionMessages`).
 */

import { l2Normalize } from '@tangleai/core/similarity';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import type { ContradictionVerdict } from '@tangleai/memory';

/** One text in, one L2-normalised vector out. Deterministic. */
export function trigramEmbedding(text: string, dims = 64): number[] {
  const v: number[] = new Array(dims).fill(0);
  const s = ` ${text.toLowerCase()} `;
  for (let i = 0; i < s.length - 2; i++) {
    let h = 2166136261;
    for (let j = i; j < i + 3; j++) {
      h ^= s.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    v[(h >>> 0) % dims] += 1;
  }
  return l2Normalize(v);
}

export interface Embedder {
  embed(texts: string[], options?: { signal?: AbortSignal }): Promise<number[][]>;
  readonly model: string;
}

/** The offline embedder, shaped like @tangleai/providers' client. */
export function createTrigramEmbedder(dims = 64): Embedder {
  return {
    model: `trigram-${dims}`,
    async embed(texts) {
      return texts.map((t) => trigramEmbedding(t, dims));
    },
  };
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
