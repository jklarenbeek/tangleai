/** Numeric answers permit only a finite scalar and an explicitly declared optional unit. */
import { refuse, type ForecastCommandResult } from '../errors.ts';
import type { ForecastAdapter } from '../contracts.gen.ts';
export type NumericForecastAdapter = Extract<ForecastAdapter, { id: 'numeric/v1' }> & { unit?: string };
export function normalizeNumeric(adapter: NumericForecastAdapter, input: string): ForecastCommandResult<number> {
  let text = input.trim();
  if (adapter.unit && text.endsWith(' ' + adapter.unit)) text = text.slice(0, -(adapter.unit.length + 1)).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) || !Number.isFinite(Number(text)))
    return refuse('TFCT1009', 'The boxed answer is not a finite number with its declared optional unit.');
  return { ok: true, value: Number(text), writes: 0 };
}
export function scoreNumeric(adapter: NumericForecastAdapter, prediction: string | number, outcome: string | number): ForecastCommandResult<{ category: 'success' | 'partial' | 'failure'; utility: 0 | .5 | 1; diagnostics: { distance: number } }> {
  if (typeof prediction !== 'number' || typeof outcome !== 'number' || !Number.isFinite(prediction) || !Number.isFinite(outcome)) return refuse('TFCT1001', 'Numeric scoring requires finite prediction and outcome values.');
  const distance = Math.abs(prediction - outcome), utility = distance <= adapter.tolerance ? 1 : distance <= 3 * adapter.tolerance ? .5 : 0;
  return { ok: true, value: { category: utility === 1 ? 'success' : utility === .5 ? 'partial' : 'failure', utility, diagnostics: { distance } }, writes: 0 };
}
