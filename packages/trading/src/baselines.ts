/** Deterministic target policies over published bars; the suite owns every numeric kernel. */
import { macd, rsi, sma, kdj } from '@jarenjs/core/finance/indicators';
import { rollingSeries, toEpoch } from '@jarenjs/core/series';
import { stddev } from '@jarenjs/core/stats';
import { immutableTradingJson } from './identity.ts';
import { validateTradingShape, validateTradingRecordSemantics } from './schema.ts';
import { tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { BarObservation, TradingSignalParameters, TradingTargetSignal } from './contracts.gen.ts';

export const TRADING_SIGNAL_DEFAULTS: TradingSignalParameters = immutableTradingJson({
  price: 'causal-adjusted-ohlc', macd: { fast: 12, slow: 26, signal: 9 },
  kdjRsi: { k: 9, d: 3, rsi: 14, entryJ: 20, exitJ: 80, entryRsi: 30, exitRsi: 70 },
  meanReversion: { window: 20, deviations: 1, deviation: 'sample' }, sma: { fast: 5, slow: 20 },
});
export type TradingSignalSeries = Array<TradingTargetSignal | null>;
export type TradingSignalPolicy = (bars: readonly BarObservation[], parameters: TradingSignalParameters) => TradingOutcome<TradingSignalSeries>;
type Targets = Array<'long' | 'flat' | null>;
interface Window { bars: BarObservation[]; high: number[]; low: number[]; close: number[]; availableAt: string[]; }

export function validateTradingSignalParameters(input: unknown): TradingOutcome<TradingSignalParameters> {
  return validateTradingShape<TradingSignalParameters>('tradingSignalParameters', input);
}

function signalWindow(input: readonly BarObservation[]): TradingOutcome<Window> {
  const bars: BarObservation[] = [], high: number[] = [], low: number[] = [], close: number[] = [], availableAt: string[] = [];
  let latest = -Infinity, latestAt = '', previous = -Infinity;
  const seen = new Set<string>();
  for (const [i, candidate] of input.entries()) {
    const shape = validateTradingShape<BarObservation>('barObservation', candidate); if (!shape.valid) return shape;
    const semantic = validateTradingRecordSemantics(shape.value); if (!semantic.valid) return semantic;
    const bar = shape.value, at = toEpoch(bar.eventAt);
    if (at <= previous || seen.has(bar.sessionId) || i && (bar.asset !== bars[0].asset || bar.manifestId !== bars[0].manifestId))
      return tradingRefuse('TTRD1001', `/bars/${i}`, 'A signal window needs one asset/run and one chronological revision per session');
    previous = at; seen.add(bar.sessionId);
    const factor = bar.adjustedClose / bar.close;
    // Equal raw prices must remain equal; a divide/multiply round-trip can move one ULP.
    const h = bar.high === bar.close ? bar.adjustedClose : Math.max(bar.adjustedClose, bar.high * factor);
    const l = bar.low === bar.close ? bar.adjustedClose : Math.min(bar.adjustedClose, bar.low * factor);
    if (![factor, h, l].every(Number.isFinite)) return tradingRefuse('TTRD1001', `/bars/${i}`, 'Causal OHLC normalization must stay finite');
    bars.push(bar); high.push(h); low.push(l); close.push(bar.adjustedClose);
    if (toEpoch(bar.availableAt) > latest) { latest = toEpoch(bar.availableAt); latestAt = bar.availableAt; }
    availableAt.push(latestAt);
  }
  return { valid: true, value: { bars, high, low, close, availableAt } };
}

function evaluate(bars: readonly BarObservation[], parameters: TradingSignalParameters,
  targets: (window: Window, parameters: TradingSignalParameters) => Targets): TradingOutcome<TradingSignalSeries> {
  const settings = validateTradingSignalParameters(parameters); if (!settings.valid) return settings;
  try {
    const prepared = signalWindow(bars); if (!prepared.valid) return prepared;
    const window = prepared.value, values = targets(window, settings.value);
    return { valid: true, value: immutableTradingJson(values.map((target, i) => target === null ? null : {
      asset: window.bars[i].asset, sessionId: window.bars[i].sessionId, observationId: window.bars[i].id, availableAt: window.availableAt[i], target,
    })) };
  } catch (cause) { return tradingRefuse('TTRD1001', '/bars', 'Signal kernel refused the supplied window', cause); }
}

const crossedUp = (a: number, b: number, priorA: number, priorB: number) => a > b && priorA <= priorB;
const crossedDown = (a: number, b: number, priorA: number, priorB: number) => a < b && priorA >= priorB;
const defined = (values: Array<number | null>): values is number[] => values.every(value => value !== null && Number.isFinite(value));

export const buyAndHold: TradingSignalPolicy = (bars, parameters) => evaluate(bars, parameters, window => window.bars.map(() => 'long'));

export const macdCross: TradingSignalPolicy = (bars, parameters) => evaluate(bars, parameters, (window, p) => {
  const result = macd(window.close, p.macd.fast, p.macd.slow, p.macd.signal);
  let target: 'long' | 'flat' = 'flat';
  return result.macd.map((line, i) => {
    const now = [line, result.signal[i]]; if (!defined(now)) return null;
    const previous = i ? [result.macd[i - 1], result.signal[i - 1]] : [null, null];
    if (defined(previous)) {
      if (crossedUp(now[0], now[1], previous[0], previous[1])) target = 'long';
      if (crossedDown(now[0], now[1], previous[0], previous[1])) target = 'flat';
    }
    return target;
  });
});

export const kdjRsi: TradingSignalPolicy = (bars, parameters) => evaluate(bars, parameters, (window, p) => {
  const oscillator = kdj(window.high, window.low, window.close, p.kdjRsi.k, p.kdjRsi.d), strength = rsi(window.close, p.kdjRsi.rsi);
  let target: 'long' | 'flat' = 'flat';
  return window.bars.map((_, i) => {
    const now = [oscillator.k[i], oscillator.d[i], oscillator.j[i], strength[i]]; if (!defined(now)) return null;
    const previous = i ? [oscillator.k[i - 1], oscillator.d[i - 1]] : [null, null];
    if (defined(previous)) {
      if (crossedUp(now[0], now[1], previous[0], previous[1]) && now[2] < p.kdjRsi.entryJ && now[3] < p.kdjRsi.entryRsi) target = 'long';
      if (crossedDown(now[0], now[1], previous[0], previous[1]) && now[2] > p.kdjRsi.exitJ && now[3] > p.kdjRsi.exitRsi) target = 'flat';
    }
    return target;
  });
});

export const zeroMeanReversion: TradingSignalPolicy = (bars, parameters) => evaluate(bars, parameters, (window, p) => {
  // One ordinal step per trading session makes the native time-width window a declared session-count window.
  const means = rollingSeries(window.close.map((value, at) => ({ at, value })), { width: p.meanReversion.window, aggregate: 'mean', minPeriods: p.meanReversion.window });
  let target: 'long' | 'flat' = 'flat';
  return means.map((mean, i) => {
    if (mean.value === null) return null;
    const deviation = stddev(window.close.slice(i - p.meanReversion.window + 1, i + 1));
    if (deviation === undefined || !Number.isFinite(deviation)) throw new TypeError('Undefined sample deviation');
    if (window.close[i] < mean.value - p.meanReversion.deviations * deviation) target = 'long';
    if (window.close[i] > mean.value) target = 'flat';
    return target;
  });
});

export const smaCross: TradingSignalPolicy = (bars, parameters) => evaluate(bars, parameters, (window, p) => {
  const fast = sma(window.close, p.sma.fast), slow = sma(window.close, p.sma.slow);
  let target: 'long' | 'flat' = 'flat';
  return window.bars.map((_, i) => {
    const now = [fast[i], slow[i]]; if (!defined(now)) return null;
    const previous = i ? [fast[i - 1], slow[i - 1]] : [null, null];
    if (defined(previous)) {
      if (crossedUp(now[0], now[1], previous[0], previous[1])) target = 'long';
      if (crossedDown(now[0], now[1], previous[0], previous[1])) target = 'flat';
    }
    return target;
  });
});
