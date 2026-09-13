import { createConsolidationMemoryStore, createConsolidationSource, type ConsolidationSource,
  type ConsolidationResult } from '@tangleai/memory/consolidation';
import { createConsolidationDbStore } from '@tangleai/store/consolidation-store';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
const snapshot: MemoryUnit = { id: 'fact', text: 'typed fact', evidence: 'typed source', tags: [], at: '2024-01-01T00:00:00Z', kind: 'fact' };
const source: Promise<ConsolidationResult<ConsolidationSource>> = createConsolidationSource({ scope: 'typed', key: 'one', sequence: 0, snapshot });
const store = createConsolidationMemoryStore();
// @ts-expect-error scope is a string at the public boundary
store.snapshot(42);
void source; void createConsolidationDbStore;
