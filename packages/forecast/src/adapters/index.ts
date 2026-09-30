/** One answer parser and scorer family, independent of the benchmark oracle. */
import { refuse, type ForecastCommandResult } from '../errors.ts';
import type { ForecastAdapter } from '../contracts.gen.ts';
import { normalizeChoice, scoreChoice } from './choice.ts';
import { normalizeNumeric, scoreNumeric } from './numeric.ts';
export { normalizeChoice, scoreChoice, normalizeNumeric, scoreNumeric };
export function parseForecastAnswer(adapter: ForecastAdapter, raw: string): ForecastCommandResult<string | number> {
  const answer = [...raw.matchAll(/\\boxed\{([^{}]*)\}/g)].at(-1)?.[1].trim();
  if (!answer) return refuse('TFCT1009', 'The final message lacks a nonempty boxed answer.');
  return adapter.id === 'choice/v1' ? normalizeChoice(adapter, answer) : normalizeNumeric(adapter, answer);
}
export interface ForecastScore { category: 'success' | 'partial' | 'failure'; utility: 0 | .5 | 1; diagnostics: { distance: number } | { unknownLabel: boolean }; }
export function scoreForecastAnswer(adapter: ForecastAdapter, prediction: string | number, outcome: string | number): ForecastCommandResult<ForecastScore> {
  return adapter.id === 'choice/v1' ? { ok: true as const, value: scoreChoice(adapter, prediction, outcome), writes: 0 } : scoreNumeric(adapter, prediction, outcome);
}
