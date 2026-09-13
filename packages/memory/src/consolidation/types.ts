/** One transaction seam for both memory and Jaren-backed durable stores. */
import type { ConsolidationArtifact, ConsolidationBuffer, ConsolidationOperation, ConsolidationReceipt,
  ConsolidationResult, ConsolidationSource } from './contracts.ts';
export interface ConsolidationTables {
  sources: ConsolidationSource; artifacts: ConsolidationArtifact;
  buffers: ConsolidationBuffer; operations: ConsolidationOperation;
}
export type ConsolidationTable = keyof ConsolidationTables;
export interface ConsolidationTransaction {
  get<K extends ConsolidationTable>(table: K, id: string): Promise<ConsolidationTables[K] | undefined>;
  list<K extends ConsolidationTable>(table: K, scope: string): Promise<ConsolidationTables[K][]>;
  put<K extends ConsolidationTable>(table: K, row: ConsolidationTables[K]): Promise<void>;
}
export interface ConsolidationPersistence {
  transaction<T>(task: (tx: ConsolidationTransaction) => Promise<T>): Promise<T>;
}
export interface ConsolidationSnapshot {
  buffer: ConsolidationBuffer; sources: ConsolidationSource[];
  artifacts: ConsolidationArtifact[]; operations: ConsolidationOperation[];
}
export interface ConsolidationApply {
  scope: string; key: string; expectedGeneration: number; sourceIds: string[];
  recipeHash: string; artifacts: ConsolidationArtifact[]; completedAt: number;
  /** A prepared operation is finalized in the activation transaction. */
  operation?: { revision: number; requestHash: string };
}
export interface ConsolidationStore {
  snapshot(scope: string): Promise<ConsolidationResult<ConsolidationSnapshot>>;
  enqueue(sources: ConsolidationSource[], options: { maxPending: number }): Promise<ConsolidationResult<{
    admitted: number; replayed: number; writes: number; buffer: ConsolidationBuffer;
  }>>;
  apply(input: ConsolidationApply): Promise<ConsolidationResult<ConsolidationReceipt>>;
  operation(scope: string, key: string): Promise<ConsolidationResult<ConsolidationOperation | null>>;
  reserve(input: { scope: string; key: string; requestHash: string; expectedGeneration: number;
    sourceIds: string[]; recipeHash: string; maxLogicalCalls: number }): Promise<ConsolidationResult<{
      operation: ConsolidationOperation; replayed: boolean;
    }>>;
  update(operation: ConsolidationOperation, expectedRevision: number): Promise<ConsolidationResult<ConsolidationOperation>>;
  stats(): { writes: number; activations: number; transactions: number };
}
export function consolidationRowId<K extends ConsolidationTable>(table: K, row: ConsolidationTables[K]): string {
  return table === 'buffers' ? row.scope : (row as ConsolidationSource | ConsolidationArtifact | ConsolidationOperation).id;
}
