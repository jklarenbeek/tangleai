/** One inherited answer normalizer; unsuccessful cases remain in every denominator. */
import { normalizeAnswer } from './locomo-parity.ts';
import type { CgtItem, CgtObservation, CgtReport, CgtRow, CgtSampleCount } from './cgt.types.ts';

export function scoreAnswer(prediction: unknown, truth: string): 0 | 1 {
  if (typeof prediction !== 'string') return 0;
  const normalized = normalizeAnswer(prediction);
  return normalized !== '' && normalized === normalizeAnswer(truth) ? 1 : 0;
}
export function cgtChanceBand(n: number, vocabulary: number): CgtReport['registration']['chanceBand'] {
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(vocabulary) || vocabulary < 2) throw Error('cgt band: invalid denominator');
  const p = 1 / vocabulary, width = 4 * Math.sqrt(p * (1 - p) / n);
  return { n, p, low: Math.max(0, p - width), high: Math.min(1, p + width), rule: 'binomial normal band: p +/- 4*sqrt(p*(1-p)/n)' };
}
export interface CgtAnswer { answer: unknown; retrievedIds?: string[]; failure?: CgtObservation['failure'] }
export function observeCgtAnswer(item: CgtItem, result: CgtAnswer, vocabulary: readonly string[]): CgtObservation {
  if (!['exact-pair', 'novel', 'paraphrase', 'retention'].includes(item.partition)) throw Error('cgt scorer: not an evaluation partition');
  const prediction = typeof result.answer === 'string' ? result.answer : null;
  const failure = result.failure ?? (result.answer === null || result.answer === undefined || prediction?.trim() === '' ? 'unanswered'
    : prediction === null || !vocabulary.some(token => normalizeAnswer(token) === normalizeAnswer(prediction)) ? 'malformed' : null);
  return { queryId: item.id, partition: item.partition as CgtObservation['partition'], prediction, truth: item.truth,
    score: failure === null ? scoreAnswer(prediction, item.truth) : 0, failure, retrievedIds: [...result.retrievedIds ?? []] };
}
export function cgtAccuracy(observations: readonly CgtObservation[]): number {
  if (!observations.length) throw Error('cgt scorer: empty partition');
  return observations.reduce((n, value) => n + value.score, 0) / observations.length;
}
export function summarizeCgt(observations: readonly CgtObservation[]): Pick<CgtRow, 'sampleCount' | 'cgc' | 'seenPair' | 'paraphrase' | 'retention' | 'failures'> {
  const group = (partition: CgtObservation['partition']) => observations.filter(value => value.partition === partition);
  const counts: CgtSampleCount = { exactPair: group('exact-pair').length, paraphrase: group('paraphrase').length,
    novel: group('novel').length, retention: group('retention').length };
  return { sampleCount: counts, cgc: cgtAccuracy(group('novel')), seenPair: cgtAccuracy(group('exact-pair')),
    paraphrase: cgtAccuracy(group('paraphrase')), retention: cgtAccuracy(group('retention')),
    failures: { unanswered: observations.filter(value => value.failure === 'unanswered').length,
      malformed: observations.filter(value => value.failure === 'malformed').length,
      rateLimited: observations.filter(value => value.failure === 'rateLimited').length,
      refused: observations.filter(value => value.failure === 'refused').length } };
}
