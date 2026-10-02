/** Immutable trading contracts; time, providers, persistence and execution are injected. */
export type * from './contracts.gen.ts';
export type * from './errors.ts';
export type * from './records.ts';
export { tradingSchema, tradingSchemaOf, validateTradingShape } from './schema.ts';
export { createTradingRecord, validateTradingRecord } from './records.ts';
export { tradingRevisionOf, tradingIdentityOf } from './identity.ts';
export { sessionIndex, sessionAt, nextSession, cutoffFor, admit, latestBarsAsOf } from './time.ts';
export type { TradingSessionIndex, TradingAdmission } from './time.ts';
export { createTradingStoreAdapter, createMemoryTradingStore, planTradingCommit, TRADING_TABLES } from './store.ts';
export type * from './store.ts';
export { accountTradingFills, validateTradingLedger, validateInitialTradingPortfolio } from './accounting.ts';
export type { PortfolioState } from './accounting.ts';
