import { it } from 'node:test';
import assert from 'node:assert/strict';
import { openTangleDb, createTradingStore } from '@tangleai/store';
import { createMemoryTradingStore, runBacktest, equityCurve } from '@tangleai/trading';
import { createScriptedTradingAgent } from '../../benchmark/lib/trading-agent-runner.ts';
import { checked } from '../../benchmark/lib/trading-research-runner.ts';
import { backtestFixture } from './backtest-fixture.ts';

const f = await backtestFixture();
for (const backend of ['memory', 'sqlite'] as const) it(`the ${backend} backtest uses one financial path and replays with zero writes or calls`, async () => {
  const db = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } });
  try {
    const store = backend === 'memory' ? createMemoryTradingStore() : createTradingStore(db), agent = createScriptedTradingAgent(db, f.catalog);
    const input = { ...f.data, providers: f.providers, store, decide: agent.decide };
    const first = checked(await runBacktest(input)); assert.equal(first.result.status, 'completed', JSON.stringify(first.result.errors));
    assert.equal(first.days.length, 8); assert.equal(first.portfolios.length, 5); assert.equal(first.fills.length, 2);
    assert.equal(first.result.spend.calls, agent.census.physical); assert.equal(agent.census.physical, 256);
    const receipts = await store.list('results', { kind: 'decision-result', manifestId: f.data.manifest.id }); assert.equal(receipts.length, 8);
    assert.equal((await equityCurve(store, f.data.manifest.id)).length, 5);
    const latest = (await store.latestPortfolio(f.data.manifest.id))!;
    assert.equal(latest.equity, first.portfolios.at(-1)!.equity); assert.deepEqual(latest.positions, first.portfolios.at(-1)!.positions);
    const second = checked(await runBacktest(input)); assert.deepEqual(second, { ...first, writes: 0 }); assert.equal(agent.census.physical, 256);
    const financial = await store.list('decisions', { kind: 'decision', manifestId: f.data.manifest.id });
    assert.equal(financial.filter(d => d.kind === 'decision' && d.key.stage === 'broker').length, 8);
  } finally { await db.close(); }
});
for (const failure of ['budget', 'abort', 'provider', 'invalid'] as const) it(`${failure} failures retain balanced portfolios and replay their counted decision receipts`, async () => {
  const fixture = await backtestFixture(2), db = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } });
  try {
    const store = createTradingStore(db), abort = new AbortController(); if (failure === 'abort') abort.abort();
    const agent = createScriptedTradingAgent(db, fixture.catalog, { signal: abort.signal, limits: failure === 'budget' ? { calls: 3 } : undefined,
      invalidRole: failure === 'invalid' ? 'trader' : undefined });
    let providerReads = 0;
    const providers = failure === 'provider' ? { ...fixture.providers, news: { items: async () => {
      providerReads++; return { outcome: 'unavailable' as const, reason: 'Registered missing news provider', code: 'TTRD1007' as const };
    } } } : fixture.providers;
    const input = { ...fixture.data, providers, store, decide: agent.decide }, result = checked(await runBacktest(input));
    assert.equal(result.result.status, 'incomplete'); assert.equal(result.result.incompleteDecisions, 4); assert.equal(result.fills.length, 0);
    for (const portfolio of result.portfolios) { assert.equal(portfolio.cash, fixture.data.manifest.initialCapital); assert.equal(portfolio.equity, fixture.data.manifest.initialCapital); assert.ok(portfolio.positions.every(p => p.quantity === 0)); }
    assert.equal(result.result.spend.calls, agent.census.physical); if (failure === 'abort' || failure === 'provider') assert.equal(agent.census.physical, 0);
    const code = failure === 'budget' ? 'TTRD1009' : failure === 'provider' ? 'TTRD1007' : 'TTRD1008';
    assert.ok(result.result.errors.every(e => e.code === code), JSON.stringify(result.result.errors));
    const decisions = await store.list('decisions', { kind: 'decision', manifestId: fixture.data.manifest.id });
    assert.equal(decisions.filter(d => d.kind === 'decision' && d.key.stage === 'broker' && d.status === 'failed').length, 4);
    const before = { calls: agent.census.physical, providerReads };
    assert.deepEqual(checked(await runBacktest(input)), { ...result, writes: 0 }); assert.deepEqual({ calls: agent.census.physical, providerReads }, before);
  } finally { await db.close(); }
});
it('agent refusal counts come from the retained provider snapshots', async () => {
  const fixture = await backtestFixture(2), db = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } });
  try {
    const store = createTradingStore(db), agent = createScriptedTradingAgent(db, fixture.catalog, { limits: { calls: 0 } });
    const providers = { ...fixture.providers, news: { items: async (...args: Parameters<typeof fixture.providers.news.items>) => {
      const response = await fixture.providers.news.items(...args);
      return response.outcome === 'ok' ? { ...response, refused: [...response.refused, { id: `provider-only-${args[0]}`, reason: 'TTRD1003' as const,
        issue: { code: 'TTRD1003' as const, path: '/availableAt', detail: 'A provider-only late observation' } }] } : response;
    } } };
    const result = checked(await runBacktest({ ...fixture.data, providers, store, decide: agent.decide }));
    const snapshots = await store.list('snapshots', { manifestId: fixture.data.manifest.id });
    assert.equal(snapshots.length, 4);
    assert.equal(result.refusedObservations, snapshots.reduce((n, s) => n + s.refused.length, 0));
    assert.equal(agent.census.physical, 0);
  } finally { await db.close(); }
});
