/**
 * The scorer, proven before any table prints.
 *
 * `exact-normalized-v1` is deliberately the smallest evaluator that can
 * be exactly right: one normalization, one string comparison. That
 * matters because the two analytic controls are what license every
 * other row. The oracle answers each held-out task with its registered
 * truth and must score exactly 1.000 — anything less means the corpus,
 * not the model, is wrong. The seeded control answers uniformly from
 * the pool of held-out answers and must land inside an analytic band;
 * a draw outside it means the stream or the pool moved.
 *
 * The band is a Bernoulli mixture, not the hypergeometric one
 * `lib/recall.ts` needs: each task is answered correctly with
 * probability `matches / |pool|`, independently. Four standard errors
 * plus one task of slack is wide with eight tasks, and it is published
 * that way rather than narrowed by changing the denominator.
 */

import { mulberry32, randomInt } from '@jarenjs/core/random';
import { mean } from '@jarenjs/core/stats';
import type { RandomBand } from './trace2skill.types.ts';

/** One registered task's expected answer. */
export interface TruthEntry {
  id: string;
  answer: string;
  normalized: string;
}

/**
 * `exact-normalized-v1`: NFC, lower case, trimmed, inner whitespace
 * collapsed, one trailing full stop removed. Nothing else — a scorer
 * that repaired an answer could no longer say which condition earned it.
 */
export function normalizeAnswer(text: string): string {
  return text.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ').replace(/\.$/, '');
}

/** Whether an answer matches a registered truth under the evaluator. */
export function answerMatches(answer: string, truth: TruthEntry): boolean {
  return normalizeAnswer(answer) === truth.normalized;
}

/**
 * The registered answer pool the seeded control draws from: the
 * distinct normalized answers of the held-out split, ordered so the
 * draw is reproducible on any host.
 */
export function answerPool(truths: readonly TruthEntry[]): string[] {
  return [...new Set(truths.map((truth) => truth.normalized))].sort();
}

/** The analytic ceiling: 1 exactly when every truth answers its own task. */
export function oracleCeiling(truths: readonly TruthEntry[]): number {
  return mean(truths.map((truth) => (answerMatches(truth.answer, truth) ? 1 : 0))) ?? 0;
}

/** The seeded draw: one uniform pick from the pool per task, in id order. */
export function randomDraw(truths: readonly TruthEntry[], seed: number): { picks: string[], correct: number, score: number } {
  const pool = answerPool(truths);
  const random = mulberry32(seed);
  const ordered = [...truths].sort((a, b) => a.id.localeCompare(b.id));
  const picks = ordered.map(() => pool[randomInt(random, 0, pool.length)]);
  const correct = ordered.reduce((total, truth, index) => total + (picks[index] === truth.normalized ? 1 : 0), 0);
  return { picks, correct, score: truths.length === 0 ? 0 : correct / truths.length };
}

/** The band the seeded draw has to land in. */
export function randomBand(truths: readonly TruthEntry[]): RandomBand {
  const pool = answerPool(truths);
  const chances = truths.map((truth) => pool.filter((entry) => entry === truth.normalized).length / pool.length);
  if (chances.length === 0) return { floor: 0, low: 0, high: 0 };
  const floor = mean(chances) ?? 0;
  // Independent Bernoulli trials: the mean's standard error is the root
  // of the summed per-task variances over the task count.
  const sigma = Math.sqrt(chances.reduce((total, chance) => total + chance * (1 - chance), 0)) / chances.length;
  const slack = 4 * sigma + 1 / chances.length;
  return { floor, low: Math.max(0, floor - slack), high: Math.min(1, floor + slack) };
}
