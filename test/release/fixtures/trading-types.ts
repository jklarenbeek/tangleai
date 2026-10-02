import { createMemoryTradingStore, createTradingRecord, admit, latestBarsAsOf, sessionIndex, planTradingCommit,
  createFixtureProviders, createReplayProviders, buildSnapshot, TRADING_SIGNAL_DEFAULTS, buyAndHold, macdCross, kdjRsi, zeroMeanReversion, smaCross, adx, cci, vwap, volumeRatio, kdj } from '@tangleai/trading';
import type { TradingRunManifest, TradingCommit, MarketSession, Observation, PortfolioSnapshot, BarObservation } from '@tangleai/trading/contracts';
import schema from '@tangleai/trading/schemas/trading' with { type: 'json' };
declare const manifest: TradingRunManifest, plan: TradingCommit, previous: PortfolioSnapshot, session: MarketSession, observations: Observation[], bars: BarObservation[];
const store = createMemoryTradingStore();
await store.put('manifests', manifest); await store.commitDecision(plan); await store.readDecision(plan.key);
await admit(observations, session.closeAt); await latestBarsAsOf(bars, session.closeAt, manifest.assets); await sessionIndex([session]);
planTradingCommit(plan, manifest, previous, session);
const captured = await createFixtureProviders({ manifestId: manifest.id, eventAt: '2025-01-01T00:00:00Z', availableAt: '2025-01-01T00:00:00Z', sessions: [session], observations });
if (captured.valid) {
  const replay = await createReplayProviders({ manifestId: manifest.id, snapshots: captured.value.snapshots, bindings: captured.value.bindings });
  if (replay.valid) await buildSnapshot({ manifest, asset: manifest.assets[0], session, portfolio: previous, providers: replay.value });
}
for (const policy of [buyAndHold, macdCross, kdjRsi, zeroMeanReversion, smaCross]) policy(bars, TRADING_SIGNAL_DEFAULTS);
const prices = Float64Array.from([10, 11, 12]);
adx(prices, prices, prices); cci(prices, prices, prices); vwap(prices, prices, prices, prices); volumeRatio(prices); kdj(prices, prices, prices);
// @ts-expect-error Strategy parameters must be explicit.
buyAndHold(bars);
// @ts-expect-error Financial writes must use the atomic decision boundary.
await store.put('fills', plan.fills[0]);
// @ts-expect-error Shorting is not a supported manifest option.
const shorting: TradingRunManifest['shorting'] = true;
void [createTradingRecord, schema, shorting];
