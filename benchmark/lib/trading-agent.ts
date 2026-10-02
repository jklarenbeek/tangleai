/** The registered scripted strategy executes every session through the public backtest and native queue. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { createGmplCatalog } from '@tangleai/gmpl';
import { openTangleDb, createTradingStore } from '@tangleai/store';
import { createFixtureProviders, runBacktest, tradingArtifacts, type TradingStrategyData, type TradingDecisionResult } from '@tangleai/trading';
import { createScriptedTradingAgent } from './trading-agent-runner.ts';
import { checked } from './trading-research-runner.ts';
import { measureTradingEquity } from './trading-metrics.ts';
import type { TradingFixture } from './trading.ts';
import type { Row, ExecutionDiagnostic } from './trading.types.ts';
import { tradingExecutionDiagnostic } from './trading-diagnostics.ts';

export async function measureScriptedTradingAgent(fixture: TradingFixture, data: TradingStrategyData, diagnostic?: (value: ExecutionDiagnostic) => void): Promise<Row> {
  const catalog = checked(await createGmplCatalog(tradingArtifacts));
  const captured = checked(await createFixtureProviders({ manifestId: data.manifest.id, sessions: data.sessions,
    observations: [...data.bars, ...data.actions, ...data.observations], eventAt: '2024-12-31T00:00:00Z', availableAt: '2024-12-31T12:00:00Z' }));
  const db = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } });
  try {
    const store = createTradingStore(db), agent = createScriptedTradingAgent(db, catalog);
    const input = { ...data, store, providers: captured.providers, decide: agent.decide }, run = checked(await runBacktest(input));
    const calls = agent.census.physical, replay = checked(await runBacktest(input));
    if (!equalsJson(replay, { ...run, writes: 0 }) || agent.census.physical !== calls) throw Error('Scripted strategy replay changed financial bytes or repeated a physical request');
    const receipts = (await store.list('results', { kind: 'decision-result', manifestId: data.manifest.id })) as TradingDecisionResult[];
    const failures = new Map<string, number>(), issues = new Map<string, number>();
    for (const receipt of receipts) if (receipt.status === 'failed') for (const issue of receipt.errors) failures.set(issue.code, (failures.get(issue.code) ?? 0) + 1);
    for (const issue of run.result.errors) issues.set(issue.code, (issues.get(issue.code) ?? 0) + 1);
    const jobs = await db.jobs!.counts();
    if (receipts.length !== data.sessions.length * data.manifest.assets.length || run.result.spend.calls !== calls || jobs.done !== receipts.length
      || jobs.pending || jobs.leased || jobs.failed || jobs.dead) throw Error('Scripted strategy decisions, native jobs and spend do not reconcile');
    for (const receipt of receipts) {
      const trace = receipt.runId ? await agent.store.readTrace(receipt.runId) : undefined;
      if (!trace || trace.interactions.length || trace.run.status !== receipt.status) throw Error('Scripted decision lost its terminal native trace');
    }
    const completed = receipts.filter(r => r.status === 'completed').length;
    diagnostic?.(tradingExecutionDiagnostic('tradingagents-scripted', data, run));
    return { id: 'tradingagents-scripted', kind: 'agent', parityTier: 'mechanism', status: 'measured', reason: null,
      ...measureTradingEquity(run.portfolios.map(p => p.equity), fixture.manifest), transactions: run.fills.length, rejectedOrders: run.rejectedOrders,
      refusedObservations: run.refusedObservations, costs: run.costs, perAsset: fixture.manifest.assets.map((asset, i) => {
        const curve = run.portfolios.map(p => data.manifest.initialCapital / data.manifest.assets.length + p.positions[i].cashFlow + p.positions[i].quantity * p.marks[i].price);
        const measured = measureTradingEquity(curve, fixture.manifest);
        return { asset, cr: measured.metrics.cr, mdd: measured.metrics.mdd, fills: run.fills.filter(f => f.asset === asset).length };
      }), eligibility: { eligible: run.result.status === 'completed', reasons: run.result.status === 'completed' ? [] : ['Counted incomplete model decisions'] }, controlSha256: null,
      execution: { manifestId: data.manifest.id, resultId: run.result.id, equitySha256: await canonicalSha256(run.portfolios), ledgerSha256: await canonicalSha256(await store.list('ledger')),
        replayWrites: 0, staleMarks: run.staleMarks, decisionCount: (await store.list('decisions', { kind: 'decision' })).length },
      agent: { decisionCount: receipts.length, completed, failed: receipts.length - completed, physicalCalls: calls,
        completions: agent.census.completion, normalizations: agent.census.normalization, repairs: agent.census.repair, replays: agent.census.replays, restores: agent.census.restores,
        replayPhysicalCalls: agent.census.physical - calls, spend: run.result.spend, failuresByCode: [...failures].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })),
        issuesByCode: [...issues].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })),
        receiptsSha256: await canonicalSha256(receipts), resultSha256: await canonicalSha256(run.result) } };
  } finally { await db.close(); }
}
