/** @tangleai/memory barrel. */

export { createMemoryUnitStore } from './store.ts';
export type { MemoryStore, MemoryUnitStoreOptions } from './store.ts';
export { createMemoryUnit, memoryId } from './ingest.ts';
export type { MemoryUnitInput } from './ingest.ts';
export { noveltyGate, DEFAULT_NOVELTY_THRESHOLD } from './novelty.ts';
export type { NoveltyOptions, NoveltyOutcome } from './novelty.ts';
export {
  planCrystallization,
  applyCrystallization,
  DEFAULT_CRYSTALLIZE_THRESHOLD,
  CONFIDENCE_BOOST,
  CONFIDENCE_FLOOR,
} from './crystallize.ts';
export type { CrystallizeMerge, CrystallizePlan, CrystallizeOptions, CrystallizeOutcome } from './crystallize.ts';
export {
  planContradictionPairs,
  resolveContradictions,
  contradictionMessages,
  CONTRADICTION_VERDICT_SCHEMA,
  DEFAULT_CONTRADICTION_THRESHOLD,
  DEFAULT_MAX_PAIRS,
} from './contradiction.ts';
export type {
  ContradictionVerdict,
  ContradictionPair,
  ChatMessage,
  ResolveOptions,
  ResolveOutcome,
} from './contradiction.ts';
export { applyOutcome, outcomeAdjustment, DEFAULT_OUTCOME_OPTIONS } from './outcome.ts';
export type { OutcomeOptions, ApplyOutcomeResult } from './outcome.ts';
export { rankByEmbedding, recallByEmbedding } from './retrieval.ts';
export type { RankOptions, RankedMemory, RankedRecall } from './retrieval.ts';
