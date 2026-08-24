/** @tangleai/core barrel. Subpath exports exist for tree-shaking hosts;
 * this re-export exists for convenience. */

export { TangleError, callerError, transportError, payloadError } from './errors.ts';
export type { TangleErrorCode, TangleErrorOptions } from './errors.ts';
export {
  similarity,
  cosineSimilarity,
  dotProductSimilarity,
  euclideanSimilarity,
  euclideanDistance,
  l2Normalize,
} from './similarity.ts';
export type { SimilarityFunction } from './similarity.ts';
export { kMeans } from './clustering.ts';
export type { KMeansResult, KMeansOptions } from './clustering.ts';
export { CHARS_PER_TOKEN, estimateTokens, truncateToTokens } from './tokens.ts';
export {
  MEMORY_KINDS,
  MEMORY_UNIT_SCHEMA,
  MEMORY_RELATION_SCHEMA,
  OUTCOME_REPORT_SCHEMA,
  MEMORY_SCHEMAS,
  toLedgerMemory,
} from './schemas/memory.ts';
export type {
  JsonSchema,
  MemoryKind,
  MemoryRelation,
  MemoryUnit,
  OutcomeReport,
  LedgerMemory,
} from './schemas/memory.ts';
