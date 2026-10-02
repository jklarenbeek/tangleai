/** Explicit denominators over the financial owner's retained results. */
import type { TradingStrategyData, TradingStrategyResult } from '@tangleai/trading';
import type { ExecutionDiagnostic } from './trading.types.ts';
export function tradingExecutionDiagnostic(id: string, data: TradingStrategyData, run: TradingStrategyResult): ExecutionDiagnostic {
  const retained = new Set(run.days.map(d => d.sessionId)), closes = run.portfolios.slice(1);
  return { id, manifestId: data.manifest.id, expectedSessions: data.sessions.length, retainedSessions: retained.size,
    missingSessions: data.sessions.filter(s => !retained.has(s.key)).length,
    failedAssetSessions: run.days.filter(d => d.status === 'failed').length, refusedAssetSessions: run.days.filter(d => d.status === 'refused').length,
    staleMarks: run.staleMarks, turnover: run.fills.reduce((n, f) => n + f.notional, 0) / data.manifest.initialCapital,
    meanGrossExposure: closes.length ? closes.reduce((n, p) => n + p.grossExposure, 0) / closes.length : 0,
    peakGrossExposure: closes.reduce((n, p) => Math.max(n, p.grossExposure), 0) };
}
