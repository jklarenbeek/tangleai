import { it } from 'node:test';
import assert from 'node:assert/strict';
import { openTangleDb, createTradingStore } from '@tangleai/store';
import { createTradingRecord, runBacktest, equityCurve, type TradingStore, type TradingCommit } from '@tangleai/trading';
import { createScriptedTradingAgent } from '../../benchmark/lib/trading-agent-runner.ts';
import { checked } from '../../benchmark/lib/trading-research-runner.ts';
import { backtestFixture } from './backtest-fixture.ts';
import { reidentify, value } from './fixtures.ts';

it('terminal commits reject orders, money changes and nonfinal sessions without financial writes', async () => {
  const f = await backtestFixture(2), db = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } }), store = createTradingStore(db);
  let terminal: TradingCommit | undefined;
  try {
    const agent = createScriptedTradingAgent(db, f.catalog, { limits: { calls: 0 } });
    const capture: TradingStore = { ...store, commitDecision: async plan => {
      if (plan.mode === 'terminal') { terminal = plan; throw Error('capture-final-commit'); }
      return store.commitDecision(plan);
    } };
    await assert.rejects(runBacktest({ ...f.data, providers: f.providers, store: capture, decide: agent.decide }), /capture-final-commit/);
    assert.ok(terminal);
    const contents = async () => ({ decisions: await store.list('decisions'), orders: await store.list('orders'), fills: await store.list('fills'), ledger: await store.list('ledger'), portfolios: await store.list('portfolios') });
    const before = await contents();
    const intent = value(await createTradingRecord('order', { manifestId: f.data.manifest.id, decisionId: terminal.decision.id, asset: terminal.key.asset,
      decisionSessionId: terminal.key.sessionId, fillSessionId: f.data.sessions[0].key, orderKind: 'market', side: 'buy', quantity: 1, limitPrice: null, stopPrice: null }));
    const earlierKey = { ...terminal.key, sessionId: f.data.sessions[0].key };
    const malformed: TradingCommit[] = [
      { ...terminal, intent },
      { ...terminal, decision: await reidentify(terminal.decision, { disposition: 'approved' }) },
      { ...terminal, portfolio: await reidentify(terminal.portfolio, { cash: terminal.portfolio.cash + 1, equity: terminal.portfolio.equity + 1 }) },
      { ...terminal, key: earlierKey, decision: await reidentify(terminal.decision, { key: earlierKey }) },
    ];
    for (const plan of malformed) { assert.equal((await store.commitDecision(plan)).valid, false); assert.deepEqual(await contents(), before); }
    checked(await store.commitDecision(terminal)); assert.equal(checked(await store.commitDecision(terminal)).writes, 0);
    assert.equal((await equityCurve(store, f.data.manifest.id)).length, 3);
    assert.equal(agent.census.physical, 0);
  } finally { await db.close(); }
});
