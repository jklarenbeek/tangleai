/** Closed choice normalization and independent exact-label utility. */
import { refuse, type ForecastCommandResult } from '../errors.ts';
import type { ForecastAdapter } from '../contracts.gen.ts';
export type ChoiceForecastAdapter = Extract<ForecastAdapter, { id: 'choice/v1' }>;
export function normalizeChoice(adapter: ChoiceForecastAdapter, input: string): ForecastCommandResult<string> {
  const normalized = adapter.options.find(option => option.toLowerCase() === input.trim().toLowerCase());
  return normalized === undefined ? refuse('TFCT1009', 'The boxed answer is not a registered choice label.') : { ok: true, value: normalized, writes: 0 };
}
export function scoreChoice(adapter: ChoiceForecastAdapter, prediction: string | number, outcome: string | number) {
  const unknownLabel = typeof prediction !== 'string' || !adapter.options.includes(prediction), success = !unknownLabel && prediction === outcome;
  return { category: success ? 'success' as const : 'failure' as const, utility: success ? 1 as const : 0 as const, diagnostics: { unknownLabel } };
}
