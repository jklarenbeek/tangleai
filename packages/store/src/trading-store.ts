/** Simulated trading writes use one immediate SQLite transaction. */
import { createTradingStoreAdapter, type TradingPersistence, type TradingTransaction, type TradingStore, type TradingStoreOptions, type TradingTables } from '@tangleai/trading';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';

const names = { manifests: 'trading_manifests', sessions: 'trading_sessions', observations: 'trading_observations', snapshots: 'trading_snapshots',
  artifacts: 'trading_artifacts', decisions: 'trading_decisions', orders: 'trading_orders', fills: 'trading_fills', ledger: 'trading_ledger', portfolios: 'trading_portfolios', results: 'trading_results' } as const;

export function createTradingStore(db: TangleDb, options: TradingStoreOptions = {}): TradingStore {
  const persistence: TradingPersistence = { transaction: <T>(task: (view: TradingTransaction) => Promise<T>) => db.transaction(async tx => {
    const view: TradingTransaction = {
      async get(table, id) { return tx.collection<TradingTables[typeof table]>(names[table]).get(id); },
      async put(table, record) { await tx.collection<TradingTables[typeof table]>(names[table]).put(record); },
      async delete(table, id) { await tx.collection(names[table]).delete(id); },
      async query(table, query) {
        const where: unknown[] = [];
        if (query.manifestId !== undefined) where.push({ $eq: [table === 'manifests' ? '$r.id' : '$r.manifestId', { $const: query.manifestId }] });
        if (query.kind !== undefined) where.push({ $eq: ['$r.kind', { $const: query.kind }] });
        if (query.key !== undefined) where.push({ $eq: ['$r.key', { $const: query.key }] });
        return asRows(await tx.collection<TradingTables[typeof table]>(names[table]).execute<TradingTables[typeof table]>({
          $for: { r: '$[*]' }, ...(where.length ? { $where: { $and: where } } : {}), $orderby: ['$r.id'], $return: '$r',
        }));
      },
    };
    return task(view);
  }, { mode: 'immediate' }) };
  return createTradingStoreAdapter(persistence, options);
}
