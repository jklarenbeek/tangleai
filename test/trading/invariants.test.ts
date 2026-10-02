import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '@jarenjs/core/random';
import { createMemoryTradingStore, runStrategy, checkRiskPolicy, TRADING_TABLES } from '@tangleai/trading';
import type { TradingStrategyData, TradingStrategySignals } from '@tangleai/trading';
import { openExecutionHarness as harness } from './execution-harness.ts';
import { strategyFixture } from './strategy-fixture.ts';
import { reidentify, value } from './fixtures.ts';

const base = await strategyFixture('signals', { sessions: 5 });
async function stream(seed: number): Promise<TradingStrategyData> {
  const random = mulberry32(seed), manifest = await reidentify(base.manifest, { seed, executionPolicy: { ...base.manifest.executionPolicy!, entryQuantity: 1 + Math.floor(random() * 2000) },
    riskPolicy: { ...base.manifest.riskPolicy, singleName: 0.05 + random() * 0.7, cashFloor: random() * 40000, maxParticipation: random() * 0.01 } }), manifestId = manifest.id;
  return { manifest, sessions: await Promise.all(base.sessions.map(s => reidentify(s, { manifestId }))),
    bars: await Promise.all(base.bars.map(b => reidentify(b, { manifestId }))), actions: [], observations: [] };
}
function signalsFor(seed: number): TradingStrategySignals {
  const random = mulberry32(seed), targets = base.sessions.flatMap(s => base.manifest.assets.map(asset => ({ key: `${asset}/${s.key}`, target: random() > 0.35 ? 'long' as const : 'flat' as const })));
  return context => ({ valid: true, value: context.bars.length ? { target: targets.find(t => t.key === `${context.asset}/${context.session.key}`)!.target,
    availableAt: context.bars.at(-1)!.availableAt, observationIds: [context.bars.at(-1)!.id] } : null });
}


for (const mode of ['memory', 'sqlite-memory', 'sqlite-file'] as const) describe(`${mode} execution invariants`, () => {
  for (let group = 0; group < 10; group++) it(`twenty seeded streams ${group * 20 + 1}–${group * 20 + 20} preserve accounting, hard limits and zero-write replay`, async () => {
    for (let n = 0; n < 20; n++) {
      const seed = 1009 + group * 20 + n, data = await stream(seed), signals = signalsFor(seed), h = await harness(mode);
      try {
        const run = value(await runStrategy({ ...data, signals, store: h.store }));
        for (const portfolio of await h.store.listPortfolios(data.manifest.id)) {
          assert.equal(portfolio.equity, portfolio.cash + portfolio.positions.reduce((sum, p, i) => sum + p.quantity * portfolio.marks[i].price, 0));
          assert.ok(portfolio.cash >= 0); assert.ok(portfolio.positions.every(p => Number.isSafeInteger(p.quantity) && p.quantity >= 0));
        }
        const ledger = await h.store.list('ledger'), markers = await h.store.list('decisions', { kind: 'decision-commit' });
        for (const fill of run.fills) {
          const entries = ledger.filter(e => e.fillId === fill.id);
          assert.equal(entries.reduce((sum, e) => sum + e.debit, 0), entries.reduce((sum, e) => sum + e.credit, 0));
          const marker = markers.find(m => m.kind === 'decision-commit' && m.fillIds.includes(fill.id)); assert.ok(marker?.kind === 'decision-commit');
          const portfolioAfter = await h.store.get('portfolios', marker.portfolioId), intent = await h.store.get('orders', fill.intentId), sessionBar = data.bars.find(b => b.id === fill.sourceBarId);
          assert.ok(portfolioAfter && intent && sessionBar); assert.deepEqual(checkRiskPolicy({ manifest: data.manifest, portfolioAfter, intent, sessionBar }), []);
        }
        const counts = await Promise.all(TRADING_TABLES.map(async table => (await h.store.list(table)).length));
        await h.reopen();
        const replay = value(await runStrategy({ ...data, signals, store: h.store }));
        assert.deepEqual(replay, { ...run, writes: 0 });
        assert.deepEqual(await Promise.all(TRADING_TABLES.map(async table => (await h.store.list(table)).length)), counts);
      } finally { await h.close(); }
    }
  });
  for (let step = 1; step <= 13; step++) it(`crash at initial valuation or fill probe ${step} resumes to exactly the uninterrupted records`, async () => {
    const data = await strategyFixture('oracle', { sessions: 3 }); data.observations = [];
    const clean = createMemoryTradingStore(), expected = value(await runStrategy({ ...data, store: clean }));
    let calls = 0, interrupted = false;
    const h = await harness(mode, { applyProbe: () => { if (++calls === step) { interrupted = true; throw Error('injected execution crash'); } } });
    try {
      await assert.rejects(runStrategy({ ...data, store: h.store }), /injected execution crash/); assert.ok(interrupted);
      await h.reopen();
      const resumed = value(await runStrategy({ ...data, store: h.store }));
      assert.deepEqual({ ...resumed, writes: 0 }, { ...expected, writes: 0 });
      for (const table of TRADING_TABLES) assert.deepEqual(await h.store.list(table), await clean.list(table), table);
      assert.equal(value(await runStrategy({ ...data, store: h.store })).writes, 0);
    } finally { await h.close(); }
  });
});
