/** Outcomes use the database's transaction owner, including memory projection. */
import { createOutcomeStoreAdapter, type OutcomePersistence, type OutcomeTransaction, type Tables, type Query, type OutcomeStore } from '@tangleai/outcomes';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';
const names = { records: 'outcome_records', keys: 'outcome_keys', heads: 'outcome_heads', operations: 'outcome_operations', memories: 'memories' } as const;
export interface OutcomeStoreOptions {
    applyProbe?: (step: string) => void;
}
export function createOutcomeStore(db: TangleDb, options: OutcomeStoreOptions = {}): OutcomeStore {
    const persistence: OutcomePersistence = { transaction: <T>(task: (view: OutcomeTransaction) => Promise<T>) => db.transaction(async (tx) => {
            const view: OutcomeTransaction = {
                async get(table, id) { return tx.collection<Tables[typeof table]>(names[table]).get(id); },
                async put(table, value) { await tx.collection<Tables[typeof table]>(names[table]).put(value); options.applyProbe?.(`put:${table}`); },
                async delete(table, id) { await tx.collection(names[table]).delete(id); options.applyProbe?.(`delete:${table}`); },
                async query(table, q) {
                    const where: unknown[] = [];
                    for (const field of ['scopeId', 'artifactKey', 'kind'] as const)
                        if (q[field] !== undefined)
                            where.push({ $eq: [`$r.${field}`, { $const: q[field] }] });
                    if (q.reservedOnly)
                        where.push({ $eq: ['$r.capacityReserved', true] });
                    if (q.after !== undefined)
                        where.push({ $gt: ['$r.seq', q.after] });
                    if (q.upper !== undefined)
                        where.push({ $le: ['$r.seq', q.upper] });
                    const query = { $for: { r: '$[*]' }, ...(where.length ? { $where: { $and: where } } : {}), $orderby: table === 'records' ? ['$r.seq', '$r.id'] : ['$r.id'], $return: '$r' };
                    const bounded = q.limit === undefined ? query : { $subsequence: [query, 0, q.limit] };
                    return asRows(await tx.collection<Tables[typeof table]>(names[table]).execute<Tables[typeof table]>(bounded));
                },
            };
            const result = await task(view);
            options.applyProbe?.('commit');
            return result;
        }, { mode: 'immediate' }) };
    return createOutcomeStoreAdapter(persistence);
}
