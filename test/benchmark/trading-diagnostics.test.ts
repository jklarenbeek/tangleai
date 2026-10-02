import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryTradingStore, runStrategy } from '@tangleai/trading';
import { strategyFixture } from '../trading/strategy-fixture.ts';
import { tradingExecutionDiagnostic } from '../../benchmark/lib/trading-diagnostics.ts';

it('execution diagnostics preserve calendar coverage, refused sessions and initial-capital turnover', async () => {
  const data = await strategyFixture('signals', { sessions: 4 });
  const outcome = await runStrategy({ ...data, store: createMemoryTradingStore(), signals: context => ({ valid: true,
    value: context.bars.length ? { target: 'long', availableAt: context.bars.at(-1)!.availableAt, observationIds: [context.bars.at(-1)!.id] } : null }) }); assert.ok(outcome.valid);
  const run = outcome.value, measured = tradingExecutionDiagnostic('fixture', data, run);
  assert.equal(measured.retainedSessions, 4); assert.equal(measured.missingSessions, 0);
  assert.equal(measured.turnover, run.fills.reduce((n, f) => n + f.notional, 0) / data.manifest.initialCapital);
  assert.ok(measured.turnover > 0); assert.ok(measured.meanGrossExposure > 0);
  assert.equal(measured.peakGrossExposure, Math.max(...run.portfolios.slice(1).map(p => p.grossExposure)));
  const broken = structuredClone(run); broken.days = broken.days.filter(d => d.sessionId !== data.sessions[1].key);
  broken.days[0].status = 'failed'; broken.days[1].status = 'refused'; broken.staleMarks = 2;
  const coverage = tradingExecutionDiagnostic('fixture', data, broken);
  assert.equal(coverage.retainedSessions, 3); assert.equal(coverage.missingSessions, 1);
  assert.equal(coverage.failedAssetSessions, 1); assert.equal(coverage.refusedAssetSessions, 1); assert.equal(coverage.staleMarks, 2);
});
