/** One exact comparison owner; clocks never participate in domain parity. */
import type { LightRagRetrieval } from '@tangleai/lightrag';

import type { VectorParity } from './vector-scale.types.ts';
export type { VectorParity } from './vector-scale.types.ts';
function compareValues(expected: unknown, actual: unknown): VectorParity {
  const paths: string[] = []; let differences = 0;
  const difference = (path: string) => { differences++; if (paths.length < 32) paths.push(path || '/'); };
  function visit(a: unknown, b: unknown, path: string) {
    if (Object.is(a, b)) return;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { difference(path); return; }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) { difference(path); return; }
      for (let i = 0; i < a.length; i++) visit(a[i], b[i], path + '/' + i);
      return;
    }
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) difference(path + '/' + key);
      else visit(left[key], right[key], path + '/' + key);
    }
  }
  visit(expected, actual, ''); return { equal: differences === 0, differences, paths };
}
export function compareRankings(expected: { rows: readonly { id: string; score: number }[]; skipped: Record<string, number> },
  actual: { rows: readonly { id: string; score: number }[]; skipped: Record<string, number> }): VectorParity {
  return compareValues(expected, actual);
}
export function compareGraphRetrieval(expected: LightRagRetrieval, actual: LightRagRetrieval): VectorParity {
  return compareValues(vectorRetrievalEvidence(expected), vectorRetrievalEvidence(actual));
}
/** Spend milliseconds are physical clocks too; calls and tokens remain exact. */
export function vectorRetrievalEvidence(result: LightRagRetrieval) {
  const { timings: _clock, spend: { ms: _spendMs, ...spend }, plan, ...domain } = result;
  const { spend: { ms: _planMs, ...planSpend }, ...planDomain } = plan;
  return { ...domain, spend, plan: { ...planDomain, spend: planSpend } };
}
