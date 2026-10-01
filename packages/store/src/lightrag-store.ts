/** The graph owner supplies guarded writes; Jaren owns their atomic SQL scope. */
import type { TransactionStore } from '@jarenjs/db';
import { createLightRagStoreAdapter, applyLightRagWritePlanWithin, type LightRagStore, type ProjectionWritePlan, type LightRagApplyReceipt } from '@tangleai/lightrag';
import type { LightRagPersistence, LightRagStored, LightRagTable, LightRagReadQuery, LightRagWriteView } from '@tangleai/lightrag';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';
export interface LightRagDbOptions { applyProbe?: (step: string) => void | Promise<void> }
export function lightRagReadDocument(query: LightRagReadQuery): object {
    const where: object[] = [];
    for (const key of ['sourceId', 'versionId', 'projectionId', 'status'] as const)
        if (query[key] !== undefined) where.push({ $eq: ['$r.' + key, { $const: query[key] }] });
    for (const [key, field] of [['ids', 'id'], ['claimIds', 'payload.id'], ['normalizedNames', 'normalizedName']] as const) {
        const values = query[key];
        if (values !== undefined) where.push(values.length ? { $or: values.map(value => ({ $eq: ['$r.' + field, { $const: value }] })) } : { $const: false });
    }
    if (query.entityIds !== undefined) where.push(query.entityIds.length ? { $or: query.entityIds.flatMap(value =>
        ['sourceEntityId', 'targetEntityId'].map(field => ({ $eq: ['$r.' + field, { $const: value }] }))) } : { $const: false });
    return { $for: { r: '$[*]' }, ...(where.length ? { $where: { $and: where } } : {}), $orderby: '$r.id', $return: '$r' };
}
export function lightRagViewWithin(scope: TransactionStore, options: LightRagDbOptions = {}): LightRagWriteView {
    return {
        async get<K extends LightRagTable>(table: K, id: string) { return scope.collection<LightRagStored<K>>('lightrag_' + table).get(id); },
        async put<K extends LightRagTable>(table: K, row: LightRagStored<K>) {
            await scope.collection<LightRagStored<K>>('lightrag_' + table).put(row); await options.applyProbe?.('put:' + table);
        },
        async query<K extends LightRagTable>(table: K, query: LightRagReadQuery) {
            return asRows(await scope.collection<LightRagStored<K>>('lightrag_' + table).execute<LightRagStored<K>>(lightRagReadDocument(query)));
        },
    };
}
export function createLightRagDbPersistence(db: TangleDb, options: LightRagDbOptions = {}): LightRagPersistence {
    if (options.applyProbe !== undefined && typeof options.applyProbe !== 'function') throw new TypeError('The write probe must be a function.');
    return {
        read: task => db.transaction(scope => task(lightRagViewWithin(scope)), { mode: 'deferred' }),
        transaction: task => db.transaction(async scope => {
            const value = await task(lightRagViewWithin(scope, options)); await options.applyProbe?.('commit'); return value;
        }, { mode: 'immediate' }),
    };
}

export function createLightRagStore(db: TangleDb, options: LightRagDbOptions = {}): LightRagStore {
    return createLightRagStoreAdapter(createLightRagDbPersistence(db, options));
}
/** A caller-owned joint transaction must let a refusal unwind the entire scope. */
export function applyLightRagPlanWithin(scope: TransactionStore, plan: ProjectionWritePlan, options: LightRagDbOptions = {}): Promise<LightRagApplyReceipt> {
    return applyLightRagWritePlanWithin(lightRagViewWithin(scope, options), plan);
}
