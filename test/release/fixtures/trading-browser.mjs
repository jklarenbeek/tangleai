import { createTradingRecord, createMemoryTradingStore, accountTradingFills, admit, latestBarsAsOf } from '@tangleai/trading';
const value = result => { if (!result.valid) throw Error(JSON.stringify(result.issues)); return result.value; };

export async function tradingConsumerFixture() {
  const manifest = value(await createTradingRecord('manifest', {
    mode: 'fixture', assets: ['TOY'], calendar: 'toy', sessionRange: { first: 'toy-first', last: 'toy-second' }, timezone: 'UTC', currency: 'USD',
    initialCapital: 1000, decisionCutoff: 'session-close', fill: 'next-open', shares: 'whole', shorting: false, leverage: false,
    commissionBps: 5, slippageBps: 5, sessionsPerYear: 252, riskFree: { kind: 'zero-series' },
    providerSnapshots: [{ provider: 'toy', revision: '0'.repeat(64), licence: 'MIT' }], rolesByProfile: { analyst: 'scripted' },
    promptCatalogRevision: '0'.repeat(64), toolManifest: [], rounds: { research: 3, risk: 2 },
    limits: { calls: 10, tokens: 10000, ms: 10000, toolRounds: 2, fanOut: 4, concurrency: 2, iterations: 4, contextChars: 10000, traceBytes: 10000 },
    seed: 1, sourceRevision: '0'.repeat(40), riskPolicy: { grossExposure: 1, netExposure: 1, singleName: 1, cashFloor: 0, maxParticipation: 0.01,
      lossLimit: 0.2, instruments: ['TOY'], orderKinds: ['market'] },
  }));
  const sessions = [];
  for (const [key, day, prev, next] of [['toy-first', '02', null, 'toy-second'], ['toy-second', '03', 'toy-first', null]])
    sessions.push(value(await createTradingRecord('session', { manifestId: manifest.id, calendar: 'toy', key, date: `2025-01-${day}`,
      openAt: `2025-01-${day}T14:30:00Z`, closeAt: `2025-01-${day}T21:00:00Z`, prev, next })));
  const initial = value(await createTradingRecord('portfolio', { manifestId: manifest.id, parentId: null, sequence: 0, cash: 1000,
    positions: [{ asset: 'TOY', quantity: 0, costBasis: 0 }], marks: [{ asset: 'TOY', price: 10 }], equity: 1000, grossExposure: 0, netExposure: 0,
    concentration: [{ asset: 'TOY', fraction: 0 }], realizedPnl: 0, unrealizedPnl: 0, asOfSessionId: null }));
  const bar = value(await createTradingRecord('bar', { manifestId: manifest.id, sourceKey: 'toy:bar', sourceId: 'toy', revisionId: 'toy:r1', contentHash: '0'.repeat(64),
    asset: 'TOY', sessionId: 'toy-first', eventAt: sessions[0].closeAt, availableAt: '2025-01-02T21:15:00Z', open: 10, high: 11, low: 9, close: 10.4, adjustedClose: 10.4, volume: 10000 }));
  const key = { manifestId: manifest.id, asset: 'TOY', sessionId: 'toy-first', stage: 'commit' };
  const decision = value(await createTradingRecord('decision', { manifestId: manifest.id, key, inputRevision: initial.revision, disposition: 'approved', artifactIds: [], reason: 'Toy consumer' }));
  const intent = value(await createTradingRecord('order', { manifestId: manifest.id, decisionId: decision.id, asset: 'TOY', decisionSessionId: 'toy-first',
    fillSessionId: 'toy-second', orderKind: 'market', side: 'buy', quantity: 10, limitPrice: null, stopPrice: null }));
  const price = 10 * 1.0005, notional = 10 * price, commission = notional * 0.0005;
  const fill = value(await createTradingRecord('fill', { manifestId: manifest.id, intentId: intent.id, decisionId: decision.id, asset: 'TOY', sessionId: 'toy-second',
    side: 'buy', quantity: 10, price, notional, commission, slippage: 10 * (price - 10) }));
  const ledgerEntries = [];
  for (const [account, debit, credit] of [['position:TOY', notional, 0], ['cash', 0, notional], ['fees', commission, 0], ['cash', 0, commission]])
    ledgerEntries.push(value(await createTradingRecord('ledger', { manifestId: manifest.id, fillId: fill.id, actionId: null, sessionId: 'toy-second', asset: 'TOY', account, debit, credit })));
  const portfolio = value(await createTradingRecord('portfolio', value(accountTradingFills(manifest, initial, [fill], [{ asset: 'TOY', price: 10.4 }], 'toy-second'))));
  return { manifest, sessions, initial, bar, plan: { key, expectedPortfolioId: initial.id, decision, intent, fills: [fill], ledgerEntries, portfolio } };
}
export async function exerciseTradingConsumer(store, fixture) {
  const { manifest, sessions, initial, bar, plan } = fixture;
  value(await store.put('manifests', manifest));
  for (const session of sessions) value(await store.put('sessions', session));
  value(await store.put('observations', bar)); value(await store.initializePortfolio(initial));
  const first = value(await store.commitDecision(plan)), replay = value(await store.commitDecision(plan));
  return { writes: first.writes, replayWrites: replay.writes, quantity: (await store.latestPortfolio(manifest.id)).positions[0].quantity,
    refused: value(await admit([bar], sessions[0].closeAt)).refused.length,
    missing: value(await latestBarsAsOf([bar], bar.availableAt, ['TOY', 'MISSING'])).missing };
}
export async function qualifyTradingBrowser() { return exerciseTradingConsumer(createMemoryTradingStore(), await tradingConsumerFixture()); }
