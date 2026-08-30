/**
 * Report shaping over JarenJS's named quantile semantics.
 *
 * The LoCoMo reports historically publish nearest-rank p50/p95 and render an
 * empty sample as `null`. Core owns the arithmetic; this edge owns those two
 * presentation choices.
 */

import { quantile } from '@jarenjs/core/stats';

export interface Latency {
  count: number;
  medianMs: number | null;
  p95Ms: number | null;
}

export function latency(samples: readonly number[]): Latency {
  return {
    count: samples.length,
    medianMs: quantile(samples, 0.5, { method: 'nearest-rank' }) ?? null,
    p95Ms: quantile(samples, 0.95, { method: 'nearest-rank' }) ?? null,
  };
}
