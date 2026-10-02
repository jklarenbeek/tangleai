import { createMemoryTradingStore, createTradingRecord, admit, latestBarsAsOf, sessionIndex, planTradingCommit } from '@tangleai/trading';
import type { TradingRunManifest, TradingCommit, MarketSession, Observation, PortfolioSnapshot, BarObservation } from '@tangleai/trading/contracts';
import schema from '@tangleai/trading/schemas/trading' with { type: 'json' };
declare const manifest: TradingRunManifest, plan: TradingCommit, previous: PortfolioSnapshot, session: MarketSession, observations: Observation[], bars: BarObservation[];
const store = createMemoryTradingStore();
await store.put('manifests', manifest); await store.commitDecision(plan); await store.readDecision(plan.key);
await admit(observations, session.closeAt); await latestBarsAsOf(bars, session.closeAt, manifest.assets); await sessionIndex([session]);
planTradingCommit(plan, manifest, previous, session);
// @ts-expect-error Financial writes must use the atomic decision boundary.
await store.put('fills', plan.fills[0]);
// @ts-expect-error Shorting is not a supported manifest option.
const shorting: TradingRunManifest['shorting'] = true;
void [createTradingRecord, schema, shorting];
