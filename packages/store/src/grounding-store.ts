/** The domain's guarded plans run within one immediate SQLite transaction. */
import { createGroundingStoreAdapter, type GroundingPersistence, type GroundingPersistenceView, type GroundingStored, type GroundingStore } from '@tangleai/grounding';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';
export interface GroundingStoreOptions { applyProbe?: (step: string) => void; }
export function createGroundingStore(db: TangleDb, options: GroundingStoreOptions = {}): GroundingStore {
    if (options.applyProbe !== undefined && typeof options.applyProbe !== 'function') throw new TypeError('A grounding write probe must be a function.');
    const persistence: GroundingPersistence = {
        transaction: <T>(task: (tx: GroundingPersistenceView) => Promise<T>) => db.transaction(async dbTx => {
            const view: GroundingPersistenceView = {
                async get(table, id) { return dbTx.collection<GroundingStored<typeof table>>('grounding_' + table).get(id); },
                async put(table, row) { await dbTx.collection<GroundingStored<typeof table>>('grounding_' + table).put(row); options.applyProbe?.('put:grounding_' + table); },
                async query(table, selectors) {
                    const where = Object.entries(selectors).map(([key, value]) => ({ $eq: ['$r.' + key, { $const: value }] }));
                    const query = { $for: { r: '$[*]' }, ...(where.length ? { $where: { $and: where } } : {}), $orderby: '$r.id', $return: '$r' };
                    return asRows(await dbTx.collection<GroundingStored<typeof table>>('grounding_' + table).execute<GroundingStored<typeof table>>(query));
                },
            };
            const value = await task(view); options.applyProbe?.('commit'); return value;
        }, { mode: 'immediate' }),
    };
    return createGroundingStoreAdapter(persistence);
}
