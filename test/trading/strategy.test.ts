import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryTradingStore, createTradingRecord, runStrategy, equityCurve, TRADING_TABLES } from '@tangleai/trading';
import type { TradingStrategySignals, TradingStrategyContext } from '@tangleai/trading';
import { value, reidentify } from './fixtures.ts';
import { strategyFixture } from './strategy-fixture.ts';
import oracle from '../../benchmark/fixtures/trading/golden/oracle.json' with { type: 'json' };
import cash from '../../benchmark/fixtures/trading/golden/do-nothing.json' with { type: 'json' };

const decimal = (a: number, b: number, label: string) => assert.equal(a.toFixed(12), b.toFixed(12), label);
const long: TradingStrategySignals = context => ({ valid: true, value: context.bars.length ? {
  target: 'long', availableAt: context.bars.at(-1)!.availableAt, observationIds: [context.bars.at(-1)!.id],
} : null });

for (const [kind, golden] of [['oracle', oracle], ['do-nothing', cash]] as const) it(`the single ${kind} loop reproduces every golden session and a full replay writes zero rows`, async () => {
  const data = await strategyFixture(kind), store = createMemoryTradingStore(), run = value(await runStrategy({ ...data, store }));
  assert.equal(run.portfolios.length, golden.points.length); assert.equal(run.rejectedOrders, 0); assert.equal(run.staleMarks, 0);
  assert.equal(run.fills.length, golden.fills.length);
  for (const [i, actual] of run.portfolios.entries()) {
    const expected = golden.points[i];
    assert.equal(actual.asOfSessionId, expected.sessionId);
    for (const field of ['cash', 'equity'] as const) decimal(actual[field], expected[field], `${i}/${field}`);
    for (const [a, position] of actual.positions.entries()) {
      for (const field of ['quantity', 'costBasis', 'cashFlow', 'realizedPnl'] as const) decimal(position[field], expected.positions[a][field], `${i}/${a}/${field}`);
      decimal(actual.marks[a].price, expected.positions[a].mark, `${i}/${a}/mark`);
    }
    decimal(actual.realizedPnl, expected.positions.reduce((n, p) => n + p.realizedPnl, 0), `${i}/realized`);
    decimal(actual.unrealizedPnl, expected.positions.reduce((n, p) => n + p.unrealizedPnl, 0), `${i}/unrealized`);
  }
  for (const [i, fill] of run.fills.entries()) for (const field of ['quantity', 'price', 'notional', 'commission', 'slippage'] as const) decimal(fill[field], golden.fills[i][field], `${i}/${field}`);
  assert.deepEqual((await equityCurve(store, data.manifest.id)).map(p => p.equity), golden.equity);
  const census = await Promise.all(TRADING_TABLES.map(async table => (await store.list(table)).length));
  const replay = value(await runStrategy({ ...data, store }));
  assert.deepEqual(replay, { ...run, writes: 0 });
  assert.deepEqual(await Promise.all(TRADING_TABLES.map(async table => (await store.list(table)).length)), census);
});

it('all same-close signal contexts share cash and holdings before next-open fills and expose no future marks', async () => {
  const data = await strategyFixture('signals', { sessions: 6 }), contexts: TradingStrategyContext[] = [];
  const store = createMemoryTradingStore();
  const run = value(await runStrategy({ ...data, store, signals: context => { contexts.push(structuredClone(context)); return long(context); } }));
  assert.equal(run.fills.length, 2);
  for (const session of data.sessions.slice(0, -1)) {
    const pair = contexts.filter(c => c.session.key === session.key); assert.equal(pair.length, 2);
    assert.equal(pair[0].portfolioId, pair[1].portfolioId); assert.equal(pair[0].cash, pair[1].cash); assert.deepEqual(pair[0].positions, pair[1].positions);
    for (const context of pair) {
      assert.equal('marks' in context, false); assert.equal('equity' in context, false);
      assert.ok(context.observations.every(o => Date.parse(o.availableAt) <= Date.parse(session.closeAt)));
      assert.equal(new Set(context.bars.map(b => b.sessionId)).size, context.bars.length);
    }
  }
  assert.equal(run.fills[0].sessionId, data.sessions[2].key, 'first published bar arrives after the first close');
});

it('excluded future citations are counted and cannot produce a fill', async () => {
  const data = await strategyFixture('leaky', { sessions: 4 }), store = createMemoryTradingStore(), future = data.observations.find(o => o.sourceKey.startsWith('poison-'))!;
  const run = value(await runStrategy({ ...data, store, signals: () => ({ valid: true, value: { target: 'long', availableAt: future.availableAt, observationIds: [future.id] } }) }));
  assert.equal(run.fills.length, 0); assert.equal(run.rejectedOrders, 6); assert.ok(run.refusedObservations > 0);
  assert.ok(run.days.filter(d => d.status === 'refused').every(d => d.errors[0].code === 'TTRD1003'));
});

it('missing execution bars and strict risk floors are rejected values while missing close marks remain counted', async () => {
  for (const missing of [true, false]) {
    const data = await strategyFixture('signals', { sessions: 4, ...(missing ? {} : { riskPolicy: { cashFloor: 100000 } }) });
    if (missing) data.bars = data.bars.filter(b => b.sessionId !== data.sessions[2].key);
    const run = value(await runStrategy({ ...data, store: createMemoryTradingStore(), signals: long }));
    assert.ok(run.rejectedOrders > 0); assert.equal(run.staleMarks, missing ? 2 : 0);
    if (!missing) assert.equal(run.fills.length, 0);
    assert.ok(run.days.some(d => d.errors.some(e => e.code === (missing ? 'TTRD1007' : 'TTRD1005'))));
  }
});

it('a newly published restatement replaces its own historical session without reordering the window', async () => {
  const data = await strategyFixture('signals', { sessions: 5 });
  const first = data.bars.find(b => b.asset === 'SYN-A' && b.sessionId === data.sessions[0].key)!;
  const revised = await reidentify(first, { sourceKey: 'restated-first-session', availableAt: data.sessions[3].openAt, close: first.close + 0.1, high: first.high + 1 });
  data.observations.push(revised); let witnessed = false;
  value(await runStrategy({ ...data, store: createMemoryTradingStore(), signals: context => {
    if (context.asset === 'SYN-A' && context.session.key === data.sessions[3].key) {
      witnessed = true; assert.equal(context.bars[0].id, revised.id); assert.equal(context.bars.at(-1)!.sessionId, data.sessions[2].key);
    }
    return { valid: true, value: null };
  } }));
  assert.ok(witnessed);
});

it('malformed signal responses become counted content refusals without throwing or trading', async () => {
  const data = await strategyFixture('signals', { sessions: 2 });
  for (const response of [undefined, { valid: false, issues: null }, { valid: false, issues: [] }, { valid: true, value: { target: 'long', extra: 1 } }]) {
    const signals = (() => response) as unknown as TradingStrategySignals;
    const run = value(await runStrategy({ ...data, signals, store: createMemoryTradingStore() }));
    assert.equal(run.fills.length, 0); assert.equal(run.rejectedOrders, 2);
    assert.ok(run.days.some(d => d.errors.some(e => e.code === 'TTRD1001')));
  }
});

it('execution refuses a late or out-of-calendar corporate action before retaining an inaccurate run', async () => {
  const data = await strategyFixture('oracle', { sessions: 3 }), session = data.sessions[2];
  const body = { manifestId: data.manifest.id, sourceKey: 'late-split', sourceId: 'fixture', revisionId: 'r1', contentHash: '0'.repeat(64), asset: data.manifest.assets[0],
    sessionId: session.key, eventAt: session.openAt, availableAt: session.closeAt, action: 'split' as const, ratio: 2, cashPerShare: null };
  for (const action of [value(await createTradingRecord('corporate-action', body)), value(await createTradingRecord('corporate-action', { ...body, sessionId: 'outside-calendar', availableAt: session.openAt }))]) {
    const store = createMemoryTradingStore(), result = await runStrategy({ ...data, actions: [action], store });
    assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TTRD1003');
    for (const table of TRADING_TABLES) assert.equal((await store.list(table)).length, 0);
  }
});
