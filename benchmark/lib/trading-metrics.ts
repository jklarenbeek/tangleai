/** The sole metric convention layer; the suite owns every finance kernel. */
import { returnsOf, holdingPeriodReturn, cagr, sharpe, maxDrawdown, volatility } from '@jarenjs/core/finance/returns';
import type { FixtureManifest, MetricConventions, Metrics, UndefinedMetric } from './trading.types.ts';

type ConventionInput = Pick<FixtureManifest, 'sessionsPerYear' | 'riskFree'>;
export function tradingConventions(manifest: ConventionInput): MetricConventions {
  if (!Number.isSafeInteger(manifest.sessionsPerYear) || manifest.sessionsPerYear <= 0 || manifest.riskFree.kind !== 'zero-series')
    throw new TypeError('Trading metrics require a declared positive session year and zero risk-free series');
  return {
    periodicity: 'session-close-to-close', sessionsPerYear: manifest.sessionsPerYear,
    riskFree: { kind: 'zero-series', perSession: 0 }, annualization: Math.sqrt(manifest.sessionsPerYear),
    annualizationText: 'sqrt(sessionsPerYear)', formulas: {
      cr: 'holdingPeriodReturn(begin, end)', ar: 'cagr(begin, end, sessions / sessionsPerYear)',
      sharpe: 'sharpe(returnsOf(equity), riskFreePerSession) * sqrt(sessionsPerYear); sample standard deviation',
      mdd: 'maxDrawdown(equity); positive peak-to-trough fraction',
    },
  };
}

export function measureTradingEquity(equity: readonly number[], manifest: ConventionInput): { metrics: Metrics; undefined: UndefinedMetric[] } {
  const conventions = tradingConventions(manifest);
  if (equity.some(n => !Number.isFinite(n))) throw new TypeError('Equity must contain finite numbers');
  const returns = returnsOf(equity), sessions = Math.max(0, equity.length - 1), begin = equity[0], end = equity.at(-1);
  const reasons: UndefinedMetric[] = [];
  const measured = (metric: UndefinedMetric['metric'], value: number, reason: string): number | null => {
    if (Number.isFinite(value)) return value;
    reasons.push({ metric, reason }); return null;
  };
  const positiveBegin = begin > 0, validReturns = returns.every(Number.isFinite);
  const metrics: Metrics = {
    cr: measured('cr', positiveBegin && end !== undefined ? holdingPeriodReturn(begin, end) : NaN, 'non-positive or missing initial equity'),
    ar: measured('ar', positiveBegin && end !== undefined ? cagr(begin, end, sessions / conventions.sessionsPerYear) : NaN,
      !positiveBegin ? 'non-positive or missing initial equity' : 'no elapsed sessions or undefined compound return'),
    sharpe: measured('sharpe', returns.length >= 2 && validReturns ? sharpe(returns, conventions.riskFree.perSession) * conventions.annualization : NaN,
      returns.length < 2 ? 'fewer than two returns' : !validReturns ? 'undefined session return' : volatility(returns) === 0 ? 'zero volatility' : 'undefined ratio'),
    mdd: measured('mdd', positiveBegin ? maxDrawdown(equity) : NaN, 'non-positive or missing initial equity'), sessions, returns: returns.length,
  };
  return { metrics, undefined: reasons };
}
