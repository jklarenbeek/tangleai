import { it } from 'node:test';
import assert from 'node:assert/strict';
import { openTangleDb, createTradingStore } from '@tangleai/store';
import { runBacktest } from '@tangleai/trading';
import { createScriptedTradingAgent } from '../../benchmark/lib/trading-agent-runner.ts';
import { tradingAblationOptions } from '../../benchmark/lib/trading-ablation-workflow.ts';
import { singleAgentTradingOptions } from '../../benchmark/lib/trading-single-agent.ts';
import { checked } from '../../benchmark/lib/trading-research-runner.ts';
import { backtestFixture } from '../trading/backtest-fixture.ts';

for (const kind of ['no-research-debate', 'no-risk-team', 'single-agent'] as const) it(`the ${kind} ablation executes its reduced native topology through the shared financial engine`, async () => {
  const fixture = await backtestFixture(3), db = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } });
  try {
    const options = kind === 'single-agent' ? singleAgentTradingOptions() : tradingAblationOptions(kind), agent = createScriptedTradingAgent(db, fixture.catalog, options), store = createTradingStore(db);
    const input = { ...fixture.data, providers: fixture.providers, store, decide: agent.decide };
    const run = checked(await runBacktest(input));
    assert.equal(run.result.status, 'completed', JSON.stringify(run.result.errors)); assert.equal(run.fills.length, 2);
    assert.equal(run.result.spend.calls, (kind === 'no-research-debate' ? 20 : kind === 'no-risk-team' ? 24 : 2) * 6);
    assert.equal(agent.census.physical, run.result.spend.calls);
    assert.equal(agent.events.filter(e => e.path.startsWith(kind === 'no-research-debate' ? 'research/' : 'risk/')).length, 0);
    const artifacts = await store.list('artifacts');
    const bridges = artifacts.filter(a => a.model.profile === `analytic:${kind}`);
    assert.equal(bridges.length, kind === 'single-agent' ? 12 : 6); assert.ok(bridges.every(a => a.spend.calls === 0));
    if (kind === 'single-agent') {
      assert.equal(agent.events.filter(e => e.event === 'completed' && e.path.startsWith('analyst-')).length, 0);
      assert.equal(artifacts.reduce((n, a) => n + a.spend.calls, 0), agent.census.physical, 'charge the one combined result only once');
    }
    const calls = agent.census.physical; assert.deepEqual(checked(await runBacktest(input)), { ...run, writes: 0 }); assert.equal(agent.census.physical, calls);
  } finally { await db.close(); }
});
