/** Paired native workflows on a registered calendar subset, all using the public financial owner. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { createGmplCatalog } from '@tangleai/gmpl';
import { openTangleDb, createTradingStore } from '@tangleai/store';
import { createFixtureProviders, runBacktest, tradingArtifacts, TRADING_READ_TOOLS } from '@tangleai/trading';
import registration from '../fixtures/trading/ablations.json' with { type: 'json' };
import { tradingExecutionInput } from './trading-execution.ts';
import { createScriptedTradingAgent } from './trading-agent-runner.ts';
import { tradingAblationOptions } from './trading-ablation-workflow.ts';
import { singleAgentTradingOptions } from './trading-single-agent.ts';
import { scriptedModel } from './trading-analyst-runner.ts';
import { checked } from './trading-research-runner.ts';
import { measureTradingEquity } from './trading-metrics.ts';
import type { TradingFixture } from './trading.ts';
import type { AblationRun, AblationComparison, TradingAblations } from './trading.types.ts';

export function tradingAblationComparisons(runs: AblationRun[]): AblationComparison[] {
  const full = runs.find(r => r.id === 'full'); if (!full) throw Error('Ablation comparison requires the full workflow');
  return runs.filter(r => r.id !== 'full').map(run => {
    const eligible = [full, run].every(r => r.status === 'completed' && r.incompleteDecisions === 0)
      && ['manifestId', 'comparisonId', 'resourcesSha256', 'decisionCount'].every(key => run[key as keyof AblationRun] === full[key as keyof AblationRun]);
    const delta = (key: 'cr' | 'ar' | 'sharpe' | 'mdd') => run.metrics[key] === null || full.metrics[key] === null ? null : run.metrics[key] - full.metrics[key];
    return { id: run.id, baseline: 'full', eligible, reason: eligible ? null : 'Unmatched resources, denominator or completed decision coverage',
      delta: { cr: delta('cr'), ar: delta('ar'), sharpe: delta('sharpe'), mdd: delta('mdd'), calls: run.physicalCalls - full.physicalCalls,
        tokens: run.spend.tokens - full.spend.tokens, modelUsd: run.spend.usd - full.spend.usd, executionCosts: run.costs.total - full.costs.total } };
  });
}

const measurements = new Map<string, Promise<TradingAblations>>();
export async function measureTradingAblations(fixture: TradingFixture): Promise<TradingAblations> {
  const key = await canonicalSha256({ fixture, registration });
  let measured = measurements.get(key);
  if (!measured) { measured = execute(fixture); measurements.set(key, measured); }
  return structuredClone(await measured);
}
async function execute(fixture: TradingFixture): Promise<TradingAblations> {
  if (!equalsJson(registration.assets, fixture.manifest.assets) || !equalsJson(registration.variants.map(v => v.id), ['single-agent', 'no-research-debate', 'no-risk-team'])
    || new Set(registration.sessions).size !== registration.sessions.length) throw Error('Ablation registration differs from its frozen assets or variants');
  const sessions = registration.sessions.map(id => fixture.sessions.find(s => s.id === id));
  if (sessions.some(s => !s) || sessions.some((s, i) => i > 0 && s!.prev !== sessions[i - 1]!.id)) throw Error('Ablation sessions must be an ordered contiguous subset');
  const selected = sessions.map((s, i) => ({ ...s!, prev: sessions[i - 1]?.id ?? null, next: sessions[i + 1]?.id ?? null }));
  const subset = { ...fixture, sessions: selected, bars: fixture.bars.filter(b => registration.sessions.includes(b.sessionId)),
    actions: fixture.actions.filter(a => registration.sessions.includes(a.sessionId)) };
  const data = await tradingExecutionInput(subset, 'tradingagents-scripted'), catalog = checked(await createGmplCatalog(tradingArtifacts));
  const observations = [...data.bars, ...data.actions, ...data.observations];
  const captured = checked(await createFixtureProviders({ manifestId: data.manifest.id, sessions: data.sessions, observations,
    eventAt: '2024-12-31T00:00:00Z', availableAt: '2024-12-31T12:00:00Z' }));
  const resourcesSha256 = await canonicalSha256({ limits: data.manifest.limits, tools: TRADING_READ_TOOLS, model: scriptedModel });
  const comparisonId = await canonicalSha256({ manifestId: data.manifest.id, sessions: data.sessions, observations, resourcesSha256, policy: registration.script });
  const runs: AblationRun[] = [];
  for (const id of ['full', 'single-agent', 'no-research-debate', 'no-risk-team'] as const) {
    const db = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } });
    try {
      const options = id === 'full' ? {} : id === 'single-agent' ? singleAgentTradingOptions() : tradingAblationOptions(id);
      const agent = createScriptedTradingAgent(db, catalog, options), store = createTradingStore(db);
      const input = { ...data, providers: captured.providers, store, decide: agent.decide }, run = checked(await runBacktest(input));
      const calls = agent.census.physical, replay = checked(await runBacktest(input));
      if (!equalsJson(replay, { ...run, writes: 0 }) || agent.census.physical !== calls) throw Error(`Ablation ${id} replay wrote or repeated model requests`);
      const receipts = await store.list('results', { kind: 'decision-result', manifestId: data.manifest.id });
      const expected = selected.length * data.manifest.assets.length * (id === 'full' ? registration.fullCallsPerDecision : registration.variants.find(v => v.id === id)!.callsPerDecision);
      const jobs = await db.jobs!.counts();
      if (calls !== run.result.spend.calls || calls !== expected || receipts.length !== selected.length * data.manifest.assets.length
        || jobs.done !== receipts.length || jobs.pending || jobs.failed || jobs.leased || jobs.dead) throw Error(`Ablation ${id} call/decision/job census differs`);
      const traces = await Promise.all(receipts.map(r => r.kind === 'decision-result' && r.runId ? agent.store.readTrace(r.runId) : undefined));
      if (traces.some(t => !t || t.run.status !== 'completed' || t.interactions.length)) throw Error(`Ablation ${id} lost a completed native trace`);
      const issues = new Map<string, number>(); for (const issue of run.result.errors) issues.set(issue.code, (issues.get(issue.code) ?? 0) + 1);
      runs.push({ id, manifestId: data.manifest.id, workflowVersionId: traces[0]!.run.workflowVersionId, comparisonId, resourcesSha256, status: run.result.status,
        ...measureTradingEquity(run.portfolios.map(p => p.equity), fixture.manifest), costs: run.costs, transactions: run.fills.length,
        perAsset: fixture.manifest.assets.map((asset, i) => {
          const curve = run.portfolios.map(p => data.manifest.initialCapital / data.manifest.assets.length + p.positions[i].cashFlow + p.positions[i].quantity * p.marks[i].price);
          const metrics = measureTradingEquity(curve, fixture.manifest).metrics;
          return { asset, cr: metrics.cr, mdd: metrics.mdd, fills: run.fills.filter(f => f.asset === asset).length };
        }), rejectedOrders: run.rejectedOrders, refusedObservations: run.refusedObservations, spend: run.result.spend, decisionCount: receipts.length,
        incompleteDecisions: run.result.incompleteDecisions, physicalCalls: calls, normalizations: agent.census.normalization, repairs: agent.census.repair,
        replayPhysicalCalls: 0, replayWrites: 0, issuesByCode: [...issues].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })),
        resultSha256: await canonicalSha256(run.result), receiptsSha256: await canonicalSha256(receipts) });
    } finally { await db.close(); }
  }
  return { registrationSha256: await canonicalSha256(registration), sessions: registration.sessions, assets: registration.assets, comparisonId, runs, comparisons: tradingAblationComparisons(runs) };
}
