import { createMemoryTradingStore, createTradingRecord, admit, latestBarsAsOf, sessionIndex, planTradingCommit,
  createFixtureProviders, createReplayProviders, buildSnapshot, TRADING_SIGNAL_DEFAULTS, buyAndHold, macdCross, kdjRsi, zeroMeanReversion, smaCross, adx, cci, vwap, volumeRatio, kdj,
  planFill, markPortfolio, applyCorporateActions, checkRiskPolicy, sizeToPolicy, runStrategy, equityCurve,
  tradingArtifacts, buildAnalystRegion, createTradingHostBindings, prepareTradingAnalystContext } from '@tangleai/trading';
import artifacts from '@tangleai/trading/artifacts' with { type: 'json' };
import { createGmplCatalog, gmplSchemaDefinition } from '@tangleai/gmpl';
import type { TradingRunManifest, TradingCommit, MarketSession, Observation, PortfolioSnapshot, BarObservation } from '@tangleai/trading/contracts';
import schema from '@tangleai/trading/schemas/trading' with { type: 'json' };
declare const manifest: TradingRunManifest, plan: TradingCommit, previous: PortfolioSnapshot, session: MarketSession, observations: Observation[], bars: BarObservation[];
const store = createMemoryTradingStore();
await store.put('manifests', manifest); await store.commitDecision(plan); await store.readDecision(plan.key);
await admit(observations, session.closeAt); await latestBarsAsOf(bars, session.closeAt, manifest.assets); await sessionIndex([session]);
planTradingCommit(plan, manifest, previous, session, { execution: session, bars, actions: [] });
const captured = await createFixtureProviders({ manifestId: manifest.id, eventAt: '2025-01-01T00:00:00Z', availableAt: '2025-01-01T00:00:00Z', sessions: [session], observations });
if (captured.valid) {
  const replay = await createReplayProviders({ manifestId: manifest.id, snapshots: captured.value.snapshots, bindings: captured.value.bindings });
  if (replay.valid) {
    const snapshot = await buildSnapshot({ manifest, asset: manifest.assets[0], session, portfolio: previous, providers: replay.value });
    const catalog = await createGmplCatalog(artifacts);
    if (snapshot.valid && catalog.valid) {
      await buildAnalystRegion({ catalog: catalog.value, profile: 'scripted', limits: manifest.limits });
      await prepareTradingAnalystContext({ manifest, snapshot: snapshot.value, portfolio: previous });
      await createTradingHostBindings({ manifest, snapshot: snapshot.value, portfolio: previous, providers: replay.value, catalog: catalog.value,
        provenance: () => ({ valid: true, value: { model: { profile: 'scripted', identityId: '0'.repeat(64) }, spend: { calls: 0, toolCalls: 0, tokens: 0, usd: 0, retries: 0, repairs: 0, ms: 0 } } }) });
    }
  }
}
for (const policy of [buyAndHold, macdCross, kdjRsi, zeroMeanReversion, smaCross]) policy(bars, TRADING_SIGNAL_DEFAULTS);
const prices = Float64Array.from([10, 11, 12]);
if (plan.intent) {
  const input = { manifest, portfolio: previous, intent: plan.intent, session, bar: bars[0] };
  await planFill(input); await sizeToPolicy(input);
  checkRiskPolicy({ manifest, portfolioAfter: plan.portfolio, intent: plan.intent, sessionBar: bars[0] });
}
await markPortfolio({ manifest, portfolio: previous, session, bars });
await applyCorporateActions({ manifest, portfolio: previous, session, actions: [] });
await runStrategy({ manifest, sessions: [session], bars, actions: [], observations, store, signals: () => ({ valid: true, value: null }) });
await equityCurve(store, manifest.id);
adx(prices, prices, prices); cci(prices, prices, prices); vwap(prices, prices, prices, prices); volumeRatio(prices); kdj(prices, prices, prices);
// @ts-expect-error Strategy parameters must be explicit.
buyAndHold(bars);
// @ts-expect-error Financial writes must use the atomic decision boundary.
await store.put('fills', plan.fills[0]);
// @ts-expect-error Shorting is not a supported manifest option.
const shorting: TradingRunManifest['shorting'] = true;
void [createTradingRecord, schema, shorting];
void [tradingArtifacts, gmplSchemaDefinition];
