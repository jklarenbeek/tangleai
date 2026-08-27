/**
 * The LoCoMo scorer, at parity with the published one — order 15.
 *
 * `benchmark/locomo/task_eval/evaluation.py` is the code every LoCoMo
 * number in the literature came through, and this module is that code
 * ported to the letter, INCLUDING the parts that look wrong, because a
 * scorer that fixes them no longer measures what the papers measured:
 *
 *  - `normalize_answer` runs in this order: strip every comma from the
 *    raw string, lower-case, remove punctuation, remove the articles
 *    `a|an|the|and`, collapse whitespace. Punctuation goes BEFORE
 *    articles, so `the-cat` becomes `thecat` and the article survives.
 *    Punctuation is Python's `string.punctuation` — the 32 ASCII marks —
 *    not a Unicode category; `and` is an "article" because the official
 *    regex says so.
 *  - `f1_score` stems every token of both sides with NLTK's Porter
 *    (`porter.ts` — the `NLTK_EXTENSIONS` variant, not the paper's),
 *    takes the multiset intersection and answers 2PR/(P+R), or 0 when
 *    nothing overlaps (which also covers an empty prediction).
 *  - `f1` (multi-hop) splits both RAW strings on `,` first, strips each
 *    part, takes for every ground-truth part the best prediction part,
 *    and averages with `np.mean` — reproduced here down to NumPy's
 *    pairwise summation order, so a nineteen-part answer agrees to the
 *    last bit.
 *  - Routing: categories 2, 3 and 4 use `f1_score`; 1 uses `f1`;
 *    category 3 truncates its ground truth at the first `;`; the answer
 *    is coerced with `String()` because six of them are integers (02a
 *    pins the count). Category 5 is EXCLUDED from parity: the official
 *    rule is a keyword search that marks the factually correct answer
 *    wrong, and it is published here (`adversarialKeywordScore`) as the
 *    documented reason, never as a number in the parity table.
 *
 * Three Python primitives had to be matched exactly rather than
 * approximated, and each was measured over every code point before it
 * was written down (2026-08-27, Python 3.14.7, `regex` 2026.7.19):
 * `\b` in the `regex` module is a simple boundary over `\w`, which is
 * exactly `[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}‌‍]` — a JavaScript
 * `\b` is ASCII-only even under the `u` flag, so the boundary is
 * spelled as lookarounds over that class; `str.split()` and `str.strip()`
 * use `str.isspace()`, 29 characters that JavaScript's `\s` disagrees
 * with on both sides (Python has `\x1C`–`\x1F` and `\x85`, JavaScript has
 * `﻿`), so the set is written out; and `str.lower()` agrees with
 * `toLowerCase()` on every code point but 28 — U+A7CE, U+A7D2, U+A7D4
 * and the Beria Erfe block U+16EA0–U+16EB8, letters newer than one of
 * the two Unicode tables — none of which occur in the release; the
 * fixtures record the same list in their header.
 */

import { porterStem } from './porter.ts';

/** Python's `string.punctuation`, exactly. */
export const PUNCTUATION: ReadonlySet<string> = new Set([...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~']);

/** Python `regex`'s `\w` for a str pattern — measured, not assumed. */
const WORD = '[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200C\\u200D]';
/** `regex.sub(r'\b(a|an|the|and)\b', ' ', text)`, with `\b` spelled as the boundary it is. */
const ARTICLES = new RegExp(`(?<!${WORD})(a|an|the|and)(?!${WORD})`, 'gu');

/** Every character Python's `str.isspace()` accepts, so `split()`/`strip()` agree. */
const SPACE_CLASS = '[\\t\\n\\v\\f\\r\\x1C-\\x1F \\x85\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]';
const SPACE_RUN = new RegExp(`${SPACE_CLASS}+`, 'gu');
const SPACE_EDGES = new RegExp(`^${SPACE_CLASS}+|${SPACE_CLASS}+$`, 'gu');

/** Python `str.split()` with no separator. */
export function pySplit(text: string): string[] {
  return text.split(SPACE_RUN).filter((part) => part !== '');
}

/** Python `str.strip()` with no argument. */
export function pyStrip(text: string): string {
  return text.replace(SPACE_EDGES, '');
}

/** `normalize_answer`, in the official order. */
export function normalizeAnswer(s: string): string {
  const withoutCommas = s.replaceAll(',', '');
  const lower = withoutCommas.toLowerCase();
  const withoutPunctuation = [...lower].filter((ch) => !PUNCTUATION.has(ch)).join('');
  const withoutArticles = withoutPunctuation.replace(ARTICLES, ' ');
  return pySplit(withoutArticles).join(' ');
}

/** The stemmed token multiset of one side. */
function stemmedTokens(text: string): string[] {
  return pySplit(normalizeAnswer(text)).map(porterStem);
}

/**
 * `np.mean` over a float64 vector, bit for bit: NumPy sums pairwise —
 * a plain loop under eight elements, eight interleaved accumulators
 * combined as ((r0+r1)+(r2+r3))+((r4+r5)+(r6+r7)) above that (and
 * recursive halving past 128, which no answer reaches) — then divides.
 */
export function numpyMean(values: readonly number[]): number {
  return pairwiseSum(values, 0, values.length) / values.length;
}

function pairwiseSum(a: readonly number[], start: number, n: number): number {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res += a[start + i];
    return res;
  }
  if (n <= 128) {
    const r = [a[start], a[start + 1], a[start + 2], a[start + 3], a[start + 4], a[start + 5], a[start + 6], a[start + 7]];
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      for (let j = 0; j < 8; j++) r[j] += a[start + i + j];
    }
    let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; i++) res += a[start + i];
    return res;
  }
  const half = n / 2 - (n / 2) % 8;
  return pairwiseSum(a, start, half) + pairwiseSum(a, start + half, n - half);
}

/** `f1_score(prediction, ground_truth)`. */
export function f1Score(prediction: string, groundTruth: string): number {
  const predicted = stemmedTokens(prediction);
  const truth = stemmedTokens(groundTruth);
  const remaining = new Map<string, number>();
  for (const token of truth) remaining.set(token, (remaining.get(token) ?? 0) + 1);
  let same = 0;
  for (const token of predicted) {
    const left = remaining.get(token) ?? 0;
    if (left > 0) { same++; remaining.set(token, left - 1); }
  }
  if (same === 0) return 0;
  const precision = 1.0 * same / predicted.length;
  const recall = 1.0 * same / truth.length;
  return (2 * precision * recall) / (precision + recall);
}

/** `f1(prediction, ground_truth)` — the multi-hop variant. */
export function multiHopF1(prediction: string, groundTruth: string): number {
  const predictions = prediction.split(',').map(pyStrip);
  const truths = groundTruth.split(',').map(pyStrip);
  return numpyMean(truths.map((gt) => Math.max(...predictions.map((p) => f1Score(p, gt)))));
}

/**
 * The official category-5 rule, `eval_question_answering`'s own words:
 * 1 when the output says "no information available" or "not mentioned",
 * else 0. Published so the exclusion is a documented reason; never a
 * parity number.
 */
export function adversarialKeywordScore(output: string): 0 | 1 {
  const lower = output.toLowerCase();
  return lower.includes('no information available') || lower.includes('not mentioned') ? 1 : 0;
}

export type LocomoCategory = 1 | 2 | 3 | 4 | 5;

export interface ParityInput {
  category: LocomoCategory;
  prediction: string;
  /** As released: a string, or one of the six integers. */
  answer: string | number;
}

export type ParityScore =
  | { scored: true, category: 1 | 2 | 3 | 4, f1: number, groundTruth: string }
  | { scored: false, category: 5, reason: string };

/** Why category 5 never enters the parity number. */
export const CATEGORY_5_REASON = 'excluded from parity: the official evaluator scores adversarial questions by keyword ("no information available" / "not mentioned"), which marks the factually correct answer wrong; see adversarialKeywordScore';

/** `eval_question_answering`, for one question. */
export function officialScore(input: ParityInput): ParityScore {
  if (input.category === 5) return { scored: false, category: 5, reason: CATEGORY_5_REASON };
  let groundTruth = String(input.answer);
  if (input.category === 3) groundTruth = pyStrip(groundTruth.split(';')[0]);
  const f1 = input.category === 1 ? multiHopF1(input.prediction, groundTruth) : f1Score(input.prediction, groundTruth);
  return { scored: true, category: input.category, f1, groundTruth };
}
