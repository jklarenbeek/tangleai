/** Registered strategies run through the public simulator; this module only assembles inputs and measures output. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { createTradingRecord, createMemoryTradingStore, runStrategy, buyAndHold, macdCross, kdjRsi, zeroMeanReversion, smaCross, TRADING_SIGNAL_DEFAULTS } from '@tangleai/trading';
import type { TradingOutcome, TradingRecordKind, TradingRecordBody, TradingStrategyData, TradingStrategySignals, TradingSignalPolicy, TradingStrategyResult, Observation } from '@tangleai/trading';
import type { TradingFixture } from './trading.ts';
import type { Row } from './trading.types.ts';
import { measureTradingEquity } from './trading-metrics.ts';

const policies: Record<string, TradingSignalPolicy> = { 'buy-and-hold': buyAndHold, macd: macdCross, 'kdj-rsi': kdjRsi, 'zero-mean-reversion': zeroMeanReversion, sma: smaCross };
function required<T>(outcome: TradingOutcome<T>): T { if (!outcome.valid) throw Error('Registered execution refused: ' + JSON.stringify(outcome.issues)); return outcome.value; }
async function record<K extends TradingRecordKind>(kind: K, body: TradingRecordBody<K>) { return required(await createTradingRecord(kind, body)); }

export async function tradingExecutionInput(fixture: TradingFixture, strategyId: string): Promise<TradingStrategyData> {
  const source = fixture.manifest, kind = strategyId === 'oracle' || strategyId === 'do-nothing' || strategyId === 'leaky' ? strategyId : 'signals';
  const manifest = await record('manifest', { mode: 'fixture', assets: source.assets, calendar: source.calendar,
    sessionRange: { first: fixture.sessions[0].id, last: fixture.sessions.at(-1)!.id }, timezone: 'UTC', currency: source.currency,
    initialCapital: source.initialCapital, decisionCutoff: 'session-close', fill: 'next-open', shares: source.shares, shorting: false, leverage: false,
    commissionBps: source.commissionBps, slippageBps: source.slippageBps, sessionsPerYear: source.sessionsPerYear, riskFree: source.riskFree,
    providerSnapshots: [{ provider: 'synthetic-corpus', revision: fixture.sha256, licence: source.licence }], rolesByProfile: {}, promptCatalogRevision: '0'.repeat(64), toolManifest: [],
    rounds: { research: 3, risk: 2 }, limits: { calls: 0, tokens: 0, ms: 600000, toolRounds: 0, fanOut: 1, concurrency: 1, iterations: 1, contextChars: 65536, traceBytes: 2097152 },
    seed: source.seed, sourceRevision: source.generatorSha256, riskPolicy: { grossExposure: 1, netExposure: 1, singleName: 0.6, cashFloor: 0, maxParticipation: 0.01, lossLimit: 0.2, instruments: source.assets, orderKinds: ['market'] },
    executionPolicy: { strategyId, kind, entryQuantity: 100 }, signalParameters: TRADING_SIGNAL_DEFAULTS });
  const manifestId = manifest.id;
  const sessions = await Promise.all(fixture.sessions.map(({ id: key, ...body }) => record('session', { ...body, manifestId, key, calendar: manifest.calendar })));
  const bars = await Promise.all(fixture.bars.map(({ id: sourceKey, kind: _kind, ...body }) => record('bar', { ...body, sourceKey, manifestId })));
  const actions = await Promise.all(fixture.actions.map(({ id: sourceKey, kind: _kind, ...body }) => record('corporate-action', { ...body, sourceKey, manifestId })));
  const observations = await Promise.all([...fixture.releases, ...fixture.poison].map(({ id: sourceKey, kind, ...body }) => record(kind as Observation['kind'], { ...body, sourceKey, manifestId } as never)));
  return { manifest, sessions, bars, actions, observations };
}

function assertGolden(run: TradingStrategyResult, fixture: TradingFixture, id: string): void {
  const golden = fixture.goldens.find(g => g.id === id)!;
  if (run.portfolios.length !== golden.points.length || run.fills.length !== golden.fills.length) throw Error(`Engine control census differs: ${id}`);
  const same = (a: number, b: number, name: string) => { if (a.toFixed(12) !== b.toFixed(12)) throw Error(`Engine control differs: ${id}/${name}`); };
  for (const [i, portfolio] of run.portfolios.entries()) {
    const point = golden.points[i]; same(portfolio.cash, point.cash, `${i}/cash`); same(portfolio.equity, point.equity, `${i}/equity`);
    for (const [a, position] of portfolio.positions.entries()) {
      for (const field of ['quantity', 'costBasis', 'cashFlow', 'realizedPnl'] as const) same(position[field], point.positions[a][field], `${i}/${a}/${field}`);
      same(portfolio.marks[a].price, point.positions[a].mark, `${i}/${a}/mark`);
    }
  }
  for (const [i, fill] of run.fills.entries()) for (const field of ['quantity', 'price', 'commission', 'slippage', 'notional'] as const) same(fill[field], golden.fills[i][field], `${i}/${field}`);
}

async function executeRows(fixture: TradingFixture): Promise<Row[]> {
  const rows: Row[] = [];
  for (const strategy of fixture.strategies) {
    const live = strategy.id === 'tradingagents-live', missing = strategy.kind === 'agent', excluded = strategy.id === 'leaky';
    const reason = excluded ? 'reads observations after cutoff' : live ? 'no authorized live model plan' : missing ? 'full decision workflow not implemented' : null;
    if (missing) {
      rows.push({ id: strategy.id, kind: strategy.kind, parityTier: strategy.parityTier, status: live ? 'not-run' : 'implementation-missing', reason,
        metrics: null, undefined: [], transactions: 0, rejectedOrders: 0, refusedObservations: 0, costs: { commission: 0, slippage: 0, total: 0 }, perAsset: [],
        eligibility: { eligible: false, reasons: [reason!] }, controlSha256: null, execution: null }); continue;
    }
    const data = await tradingExecutionInput(fixture, strategy.id), store = createMemoryTradingStore();
    const signals: TradingStrategySignals | undefined = policies[strategy.id] ? context => {
      const result = policies[strategy.id](context.bars, data.manifest.signalParameters!); if (!result.valid) return result;
      const signal = result.value.at(-1);
      return { valid: true, value: signal ? { target: signal.target, availableAt: signal.availableAt, observationIds: [signal.observationId] } : null };
    } : excluded ? context => {
      const poisoned = data.observations.find(o => o.kind === 'bar' && o.sourceKey.startsWith('poison-') && o.asset === context.asset);
      return { valid: true, value: poisoned && context.session.key === data.sessions[10].key ? { target: 'long', availableAt: poisoned.availableAt, observationIds: [poisoned.id] } : null };
    } : undefined;
    const run = required(await runStrategy({ ...data, store, ...(signals ? { signals } : {}) }));
    const replay = required(await runStrategy({ ...data, store, ...(signals ? { signals } : {}) }));
    if (!equalsJson(replay, { ...run, writes: 0 })) throw Error(`Engine replay differs: ${strategy.id}`);
    if (strategy.id === 'oracle' || strategy.id === 'do-nothing') assertGolden(run, fixture, strategy.id);
    if (excluded && (run.fills.length || !run.rejectedOrders)) throw Error('Excluded control reached execution or was not refused');
    const golden = fixture.goldens.find(g => g.id === strategy.id);
    rows.push({ id: strategy.id, kind: strategy.kind, parityTier: strategy.parityTier, status: excluded ? 'excluded' : 'measured', reason,
      ...measureTradingEquity(run.portfolios.map(p => p.equity), fixture.manifest), transactions: run.fills.length, rejectedOrders: run.rejectedOrders,
      refusedObservations: run.refusedObservations, costs: run.costs, perAsset: fixture.manifest.assets.map((asset, i) => {
        const curve = run.portfolios.map(p => data.manifest.initialCapital / data.manifest.assets.length + p.positions[i].cashFlow + p.positions[i].quantity * p.marks[i].price);
        const measured = measureTradingEquity(curve, fixture.manifest);
        return { asset, cr: measured.metrics.cr, mdd: measured.metrics.mdd, fills: run.fills.filter(f => f.asset === asset).length };
      }), eligibility: { eligible: !excluded, reasons: reason ? [reason] : [] }, controlSha256: golden ? await canonicalSha256(golden) : null,
      execution: { manifestId: data.manifest.id, resultId: run.result.id, equitySha256: await canonicalSha256(run.portfolios), ledgerSha256: await canonicalSha256(await store.list('ledger')),
        replayWrites: 0, staleMarks: run.staleMarks, decisionCount: (await store.list('decisions', { kind: 'decision' })).length } });
  }
  return rows;
}

// Validation may recheck many altered reports. Cache only one complete input identity;
// each measurement includes an actual second execution and a new process executes afresh.
let cached: { identity: string; rows: Promise<Row[]> } | undefined;
export async function measureTradingExecutions(fixture: TradingFixture): Promise<Row[]> {
  const identity = await canonicalSha256(fixture);
  if (cached?.identity !== identity) cached = { identity, rows: executeRows(cloneJson(fixture)) };
  return cloneJson(await cached.rows);
}
