/** Consolidation transactions use the shared Jaren store and native driver owner. */
import { createConsolidationStoreAdapter, consolidationRowId, type ConsolidationPersistence,
  type ConsolidationTransaction, type ConsolidationTable, type ConsolidationTables, type ConsolidationStore } from '@tangleai/memory/consolidation';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';
const names: Record<ConsolidationTable, string> = {
  sources: 'consolidation_sources', artifacts: 'consolidation_artifacts',
  buffers: 'consolidation_buffers', operations: 'consolidation_operations',
};
interface PhysicalRow { id: string; scope: string; payload: ConsolidationTables[ConsolidationTable] }
export interface ConsolidationDbOptions { applyProbe?: (step: string) => void }
export function createConsolidationDbPersistence(db: TangleDb, options: ConsolidationDbOptions = {}): ConsolidationPersistence {
  return { transaction: <T>(task: (view: ConsolidationTransaction) => Promise<T>) => db.transaction(async tx => {
    const view: ConsolidationTransaction = {
      async get<K extends ConsolidationTable>(table: K, id: string) {
        const row = await tx.collection<PhysicalRow>(names[table]).get(id);
        return row?.payload as ConsolidationTables[K] | undefined;
      },
      async list<K extends ConsolidationTable>(table: K, scope: string) {
        return asRows(await tx.collection<PhysicalRow>(names[table]).execute<ConsolidationTables[K]>({
          $for: { r: '$[*]' }, $where: { $eq: ['$r.scope', { $const: scope }] }, $orderby: ['$r.id'], $return: '$r.payload',
        }));
      },
      async put<K extends ConsolidationTable>(table: K, payload: ConsolidationTables[K]) {
        await tx.collection<PhysicalRow>(names[table]).put({ id: consolidationRowId(table, payload), scope: payload.scope, payload });
        options.applyProbe?.(`put:${table}`);
      },
    };
    const result = await task(view); options.applyProbe?.('commit'); return result;
  }, { mode: 'immediate' }) };
}
export function createConsolidationDbStore(db: TangleDb, options: ConsolidationDbOptions = {}): ConsolidationStore {
  return createConsolidationStoreAdapter(createConsolidationDbPersistence(db, options));
}
