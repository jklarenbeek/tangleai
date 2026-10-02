import { createTradingRecord, accountTradingFills } from '@tangleai/trading';
import type { TradingOutcome, TradingRunManifest, MarketSession, Observation, PortfolioSnapshot, TradingCommit, TradingStore, TradingRecord } from '@tangleai/trading';
import fixture from '../../benchmark/fixtures/trading/manifest.json' with { type: 'json' };
import sessions from '../../benchmark/fixtures/trading/sessions.json' with { type: 'json' };
import bars from '../../benchmark/fixtures/trading/bars.json' with { type: 'json' };
import poison from '../../benchmark/fixtures/trading/poison.json' with { type: 'json' };
import golden from '../../benchmark/fixtures/trading/golden/oracle.json' with { type: 'json' };

export function value<T>(outcome: TradingOutcome<T>): T { if (!outcome.valid) throw new Error(JSON.stringify(outcome.issues)); return outcome.value; }
export async function tradingFixture(overrides: Partial<TradingRunManifest> = {}): Promise<{ manifest: TradingRunManifest; sessions: MarketSession[]; observations: Observation[]; poison: Observation[]; initial: PortfolioSnapshot }> {
  const manifest = value(await createTradingRecord('manifest', {
    mode: 'fixture', assets: fixture.assets, calendar: fixture.calendar, sessionRange: { first: sessions[0].id, last: sessions.at(-1)!.id }, timezone: 'UTC', currency: fixture.currency,
    initialCapital: fixture.initialCapital, decisionCutoff: 'session-close', fill: 'next-open', shares: 'whole', shorting: false, leverage: false,
    commissionBps: fixture.commissionBps, slippageBps: fixture.slippageBps, sessionsPerYear: fixture.sessionsPerYear, riskFree: { kind: 'zero-series' },
    providerSnapshots: [{ provider: 'synthetic-market', revision: fixture.generatorSha256, licence: 'MIT' }], rolesByProfile: { analyst: 'scripted' }, promptCatalogRevision: '0'.repeat(64), toolManifest: [],
    rounds: { research: 3, risk: 2 }, limits: { calls: 128, tokens: 262144, ms: 600000, toolRounds: 4, fanOut: 8, concurrency: 4, iterations: 10, contextChars: 65536, traceBytes: 2097152 },
    seed: fixture.seed, sourceRevision: '1'.repeat(40), riskPolicy: { grossExposure: 1, netExposure: 1, singleName: 0.6, cashFloor: 0, maxParticipation: 0.01, lossLimit: 0.2, instruments: fixture.assets, orderKinds: ['market'] },
    ...overrides,
  }));
  const calendar: MarketSession[] = [];
  for (const session of sessions) {
    const { id: key, ...body } = session;
    calendar.push(value(await createTradingRecord('session', { ...body, manifestId: manifest.id, calendar: manifest.calendar, key })));
  }
  const observations: Observation[] = [], poisons: Observation[] = [];
  for (const source of [...bars, ...poison]) {
    const { id: sourceKey, kind, ...body } = source;
    const payload = { ...body, sourceKey, manifestId: manifest.id };
    const observation = kind === 'bar' ? value(await createTradingRecord('bar', payload as Parameters<typeof createTradingRecord<'bar'>>[1]))
      : value(await createTradingRecord(kind as 'fundamental' | 'news', payload as Parameters<typeof createTradingRecord<'news'>>[1]));
    (sourceKey.startsWith('poison-') ? poisons : observations).push(observation);
  }
  const initial = value(await createTradingRecord('portfolio', { manifestId: manifest.id, parentId: null, sequence: 0, cash: manifest.initialCapital,
    positions: manifest.assets.map(asset => ({ asset, quantity: 0, costBasis: 0, cashFlow: 0, realizedPnl: 0 })), marks: manifest.assets.map(asset => ({ asset, price: bars.find(b => b.asset === asset)!.open })),
    equity: manifest.initialCapital, grossExposure: 0, netExposure: 0, concentration: manifest.assets.map(asset => ({ asset, fraction: 0 })), realizedPnl: 0, unrealizedPnl: 0, asOfSessionId: null }));
  return { manifest, sessions: calendar, observations, poison: poisons, initial };
}

export async function decisionFixture(fixture: Awaited<ReturnType<typeof tradingFixture>>): Promise<TradingCommit> {
  const { manifest, initial } = fixture, { id: _id, decisionSessionId, ...gold } = golden.fills[0];
  const key = { manifestId: manifest.id, asset: gold.asset, sessionId: decisionSessionId, stage: 'broker' };
  const decision = value(await createTradingRecord('decision', { manifestId: manifest.id, key, inputRevision: initial.revision, disposition: 'approved', artifactIds: [], reason: 'Privileged fixture accounting control' }));
  const intent = value(await createTradingRecord('order', { manifestId: manifest.id, decisionId: decision.id, asset: gold.asset,
    decisionSessionId, fillSessionId: gold.sessionId, orderKind: 'market', side: gold.side as 'buy', quantity: gold.quantity, limitPrice: null, stopPrice: null }));
  const sourceBar = fixture.observations.find(o => o.kind === 'bar' && o.asset === gold.asset && o.sessionId === gold.sessionId)!;
  const fill = value(await createTradingRecord('fill', { ...gold, sourceBarId: sourceBar.id, side: gold.side as 'buy', manifestId: manifest.id, intentId: intent.id, decisionId: decision.id }));
  const entries = [
    { account: `position:${fill.asset}`, debit: fill.notional, credit: 0 }, { account: 'cash', debit: 0, credit: fill.notional },
    { account: 'fees', debit: fill.commission, credit: 0 }, { account: 'cash', debit: 0, credit: fill.commission },
  ];
  const ledgerEntries = [];
  for (const entry of entries) ledgerEntries.push(value(await createTradingRecord('ledger', { ...entry, manifestId: manifest.id,
    fillId: fill.id, actionId: null, sessionId: fill.sessionId, asset: fill.asset })));
  const marks = initial.marks.map(mark => mark.asset === fill.asset ? { ...mark, price: bars.find(b => b.asset === fill.asset && b.sessionId === fill.sessionId)!.open } : mark);
  const portfolio = value(await createTradingRecord('portfolio', value(accountTradingFills(manifest, initial, [fill], marks, fill.sessionId))));
  return { mode: 'trade', markBarIds: [fill.sourceBarId], actionIds: [], key, expectedPortfolioId: initial.id, decision, intent, fills: [fill], ledgerEntries, portfolio };
}

export async function loadFixture(store: TradingStore, fixture: Awaited<ReturnType<typeof tradingFixture>>): Promise<number> {
  let writes = value(await store.put('manifests', fixture.manifest)).writes;
  for (const session of fixture.sessions) writes += value(await store.put('sessions', session)).writes;
  for (const observation of [...fixture.observations, ...fixture.poison]) writes += value(await store.put('observations', observation)).writes;
  writes += value(await store.initializePortfolio(fixture.initial)).writes;
  return writes;
}

export async function reidentify<T extends TradingRecord>(record: T, delta: Partial<T>): Promise<T> {
  const { id: _id, revision: _revision, kind, ...body } = { ...record, ...delta };
  return value(await createTradingRecord(kind, body as never)) as T;
}
