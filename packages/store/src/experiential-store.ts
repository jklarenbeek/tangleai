/** The same experiential policies execute over native immediate SQLite transactions. */
import { cloneJson } from '@jarenjs/core/object';
import { EXPERIENTIAL_TABLES, createExperientialStoreAdapter, type ExperientialTable, type ExperientialTables,
  type ExperientialPersistence, type ExperientialTransaction, type ExperientialStore, type ExperientialStoreOptions } from '@tangleai/experiential';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';

interface PhysicalRow { id: string; scope: string; payload: ExperientialTables[ExperientialTable] }
export interface ExperientialDbOptions { applyProbe?: (step: string) => void }

export function createExperientialDbPersistence(db: Pick<TangleDb, 'transaction'>, options: ExperientialDbOptions = {}): ExperientialPersistence {
  return { transaction: <T>(task: (view: ExperientialTransaction) => Promise<T>) => db.transaction(async tx => {
    let active = true;
    const pending = new Set<Promise<unknown>>();
    const guard = (table: ExperientialTable) => {
      if (!active) throw new TypeError('The experiential transaction has ended.');
      if (!EXPERIENTIAL_TABLES.includes(table)) throw new TypeError('Unknown experiential table.');
    };
    function track<V>(work: () => Promise<V>): Promise<V> {
      const result = work(); pending.add(result);
      void result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    }
    function payload<K extends ExperientialTable>(row: PhysicalRow, table: K): ExperientialTables[K] {
      if (row.id !== row.payload?.id || row.scope !== row.payload?.scope) throw new TypeError('An experiential physical row differs from its payload address.');
      return cloneJson(row.payload) as ExperientialTables[K];
    }
    const view: ExperientialTransaction = {
      get<K extends ExperientialTable>(table: K, id: string) { return track(async () => {
        guard(table); const row = await tx.collection<PhysicalRow>('experiential_' + table).get(id); guard(table);
        if (row && row.id !== id) throw new TypeError('An experiential row differs from its requested address.');
        return row ? payload(row, table) : undefined;
      }); },
      list<K extends ExperientialTable>(table: K, scope: string | null) { return track(async () => {
        guard(table);
        const rows = asRows(await tx.collection<PhysicalRow>('experiential_' + table).execute<PhysicalRow>({
          $for: { r: '$[*]' }, ...(scope === null ? {} : { $where: { $eq: ['$r.scope', { $const: scope }] } }), $orderby: ['$r.id'], $return: '$r',
        }));
        guard(table); return rows.map(row => payload(row, table));
      }); },
      put<K extends ExperientialTable>(table: K, input: ExperientialTables[K]) { return track(async () => {
        guard(table); const value = cloneJson(input);
        await tx.collection<PhysicalRow>('experiential_' + table).put({ id: value.id, scope: value.scope, payload: value });
        guard(table); options.applyProbe?.('put:experiential_' + table);
      }); },
    };
    try {
      const result = await task(view);
      if (pending.size) {
        await Promise.allSettled([...pending]);
        throw new TypeError('Every experiential operation must settle before the transaction task returns.');
      }
      options.applyProbe?.('commit'); return result;
    } finally { active = false; }
  }, { mode: 'immediate' }) };
}

export function createExperientialDbStore(db: Pick<TangleDb, 'transaction'>, options: ExperientialStoreOptions & ExperientialDbOptions): ExperientialStore {
  return createExperientialStoreAdapter(createExperientialDbPersistence(db, options), options);
}
