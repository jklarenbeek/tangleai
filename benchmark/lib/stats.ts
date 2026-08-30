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

/**
 * The inverse standard normal CDF — Acklam's rational approximation,
 * with a relative error below 1.15e-9 across the whole range, which is
 * six orders of magnitude finer than the four decimals a published
 * bound is read at.
 *
 * Built here, and recorded as built here: `@jarenjs/core/stats`
 * publishes mean, median, quantile, stddev and variance, and no
 * distribution quantiles beside them. A report that must say what
 * effect it could have DETECTED needs `z` at its registered level, so
 * the alternative to twenty lines is a report that publishes a null
 * without a bound — the one thing the objective forbids.
 */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`normalQuantile needs 0 < p < 1, got ${p}`);
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - low) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
      / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
    / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}
