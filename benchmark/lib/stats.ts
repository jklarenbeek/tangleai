/**
 * The descriptive statistics the suite does not have.
 *
 * Checked before writing them (BOUNDARY §"What the suite already has"):
 * `@jarenjs/core/math` is the graphics/numeric kernel — int32/float64
 * helpers, vectors, `mat4`, root finders, `geoMean` — and there is no
 * median and no percentile anywhere in a published package. jarenjs keeps
 * its own p50/p95 inside `benchmark/lib/measure.js`, which is not
 * published either. So this file exists, it is deliberately tiny, and it
 * is the ONLY place in this repo that computes a quantile.
 *
 * The quantile rule is nearest-rank on the sorted sample (the same one
 * jarenjs's harness uses), stated rather than assumed because the seven
 * competing definitions differ on small samples — and a benchmark row
 * with eleven readings is a small sample.
 */

/** Ascending copy; the input is never reordered under a caller. */
function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/**
 * The `p`-quantile by nearest rank, `p` in [0, 1]. An empty sample has
 * no quantile and answers `null` rather than `NaN` — `null` is the value
 * every report row already renders as "—", and `NaN` formats as a number
 * that is not one.
 */
export function quantile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  if (!(p >= 0 && p <= 1)) throw new RangeError(`quantile p must be in [0, 1], got ${String(p)}`);
  const ordered = sorted(values);
  const rank = Math.ceil(p * ordered.length);
  return ordered[Math.max(0, rank - 1)];
}

/** The 50th percentile. */
export function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

/** The arithmetic mean, or `null` for an empty sample. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** What a latency column reports: the count, the median and the p95. */
export interface Latency {
  count: number;
  medianMs: number | null;
  p95Ms: number | null;
}

/** Summarize a sample of millisecond readings. */
export function latency(samples: readonly number[]): Latency {
  return { count: samples.length, medianMs: median(samples), p95Ms: quantile(samples, 0.95) };
}
