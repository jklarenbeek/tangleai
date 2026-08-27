/**
 * Evidence recall — the official LoCoMo `recall_acc`, and the two
 * analytic rows that prove a scorer before it prints.
 *
 * `task_eval/evaluation.py` computes, per question, the fraction of
 * that question's `evidence` ids that appear in the retrieved context,
 * and appends 1 for a question with no evidence at all. Averaged, that
 * is a model-free ceiling on any answer: a fact that never reached the
 * prompt cannot be answered from it. It is FRACTIONAL, which is the one
 * way it differs from jarenjs's recall@k (at least one gold in the top
 * k, so an oracle is 1.000 at every k). Here an oracle is NOT 1.000 at
 * every k, for two reasons this module makes exact:
 *
 *  - nine of the 2,815 evidence ids resolve to no turn (02a), so even
 *    "every gold id first" tops out at 0.996 over categories 1–4; and
 *  - a question may cite up to 19 turns, so at k = 5 the best possible
 *    retrieval of that question scores 5/19. The oracle ceiling is
 *    therefore a function of k — `oracleCeiling(questions, k)` — and the
 *    gate compares the oracle row to it at EVERY k, reaching the census
 *    number only where k covers the longest evidence list.
 *
 * The random row's expectation is exact too: k draws without
 * replacement from a conversation of N turns hit each resolvable gold
 * turn with probability k/N, so a question expects `(r/g)·(k/N)`, and
 * the count of hits is hypergeometric, which gives the band its
 * variance. The slack rule is jarenjs's — four standard errors of the
 * question-level sum plus one question's worth — so a corpus cannot
 * fail on rounding, and a row outside it means the scorer or the draw
 * is broken rather than the seed unlucky.
 */

export interface GoldQuestion {
  category: number;
  /** The scoped addresses the question cites, as released — repaired never. */
  gold: readonly string[];
  /** How many of them exist in the conversation's corpus. */
  resolvable: number;
  /** The conversation's corpus size — what a random draw draws from. */
  universe: number;
}

/**
 * The official per-question value: the fraction of `gold` present in
 * `retrieved`, or 1 when the question cites nothing.
 */
export function evidenceRecall(gold: readonly string[], retrieved: ReadonlySet<string>): number {
  if (gold.length === 0) return 1;
  let hits = 0;
  for (const id of gold) if (retrieved.has(id)) hits++;
  return hits / gold.length;
}

/** The arithmetic mean over a non-empty list; the caller guarantees non-empty. */
export function average(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** The best any top-k retrieval can score on one question. */
export function oracleCeilingOf(question: GoldQuestion, k: number): number {
  if (question.gold.length === 0) return 1;
  return Math.min(k, question.resolvable) / question.gold.length;
}

/** The oracle ceiling at `k`, averaged over the questions. */
export function oracleCeiling(questions: readonly GoldQuestion[], k: number): number {
  return average(questions.map((q) => oracleCeilingOf(q, k)));
}

/** What a uniform top-k draw expects on one question. */
export function randomExpectationOf(question: GoldQuestion, k: number): number {
  if (question.gold.length === 0) return 1;
  const draws = Math.min(k, question.universe);
  return (question.resolvable / question.gold.length) * (draws / question.universe);
}

/** The hypergeometric variance of one question's random recall. */
function randomVarianceOf(question: GoldQuestion, k: number): number {
  const g = question.gold.length;
  const n = question.universe;
  if (g === 0 || n <= 1) return 0;
  const draws = Math.min(k, n);
  const p = question.resolvable / n;
  const hits = draws * p * (1 - p) * ((n - draws) / (n - 1));
  return hits / (g * g);
}

export interface RandomBand {
  /** The analytic expectation. */
  floor: number;
  low: number;
  high: number;
}

/** The band a seeded random row must land in at `k`. */
export function randomBand(questions: readonly GoldQuestion[], k: number): RandomBand {
  const floor = average(questions.map((q) => randomExpectationOf(q, k)));
  let variance = 0;
  for (const question of questions) variance += randomVarianceOf(question, k);
  const sigma = Math.sqrt(variance) / questions.length;
  const slack = 4 * sigma + 1 / questions.length;
  return { floor, low: Math.max(0, floor - slack), high: Math.min(1, floor + slack) };
}
