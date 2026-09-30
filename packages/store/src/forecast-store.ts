/** Immediate SQLite transactions consume the forecast owner's guarded row projection. */
import { createForecastStoreAdapter, type ForecastStore, type ForecastPersistence, type ForecastPersistenceView, type ForecastStored } from '@tangleai/forecast';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';
export interface ForecastStoreOptions { applyProbe?: (step: string) => void; }
export function createForecastStore(db: TangleDb, options: ForecastStoreOptions = {}): ForecastStore {
  if (options.applyProbe !== undefined && typeof options.applyProbe !== 'function') throw new TypeError('The forecast write probe must be a function.');
  const persistence: ForecastPersistence = {
    transaction: <T>(task: (tx: ForecastPersistenceView) => Promise<T>) => db.transaction(async dbTx => {
      const view: ForecastPersistenceView = {
        async get(table,id) { return dbTx.collection<ForecastStored<typeof table>>('forecast_' + table).get(id); },
        async put(table,row) { await dbTx.collection<ForecastStored<typeof table>>('forecast_' + table).put(row); options.applyProbe?.('put:forecast_' + table); },
        async query(table,q) {
          const where: unknown[] = [];
          for (const key of ['questionId','scopeKey','checkpointId','status'] as const) if (q[key] !== undefined) where.push({ $eq: ['$r.' + key,{ $const: q[key] }] });
          if (q.after !== undefined) where.push({ $gt: ['$r.id',{ $const: q.after }] });
          const query = { $for: { r: '$[*]' },...(where.length ? { $where: { $and: where } } : {}),$orderby: '$r.id',$return: '$r' };
          return asRows(await dbTx.collection<ForecastStored<typeof table>>('forecast_' + table).execute<ForecastStored<typeof table>>({ $subsequence: [query,0,q.limit ?? 1000] }));
        },
      };
      const result = await task(view); options.applyProbe?.('commit'); return result;
    },{ mode: 'immediate' }),
  };
  return createForecastStoreAdapter(persistence);
}
