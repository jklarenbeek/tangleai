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
/** Keep native indexed predicates below SQLite's expression and parameter limits. */
async function readWithin<K extends LightRagTable>(scope: TransactionStore, table: K, query: LightRagReadQuery): Promise<LightRagStored<K>[]> {
    const { ids, claimIds, normalizedNames, entityIds, ...scalar } = query;
    const groups = ([['ids', ids], ['claimIds', claimIds], ['normalizedNames', normalizedNames], ['entityIds', entityIds]] as const)
        .filter((entry): entry is readonly [typeof entry[0], readonly string[]] => entry[1] !== undefined)
        .map(([key, values]) => ({ key, values: [...new Set(values)] }));
    if (groups.some(group => group.values.length === 0)) return [];
    const maxTerms = 256;
    const execute = async (part: LightRagReadQuery) => asRows(await scope.collection<LightRagStored<K>>('lightrag_' + table)
        .execute<LightRagStored<K>>(lightRagReadDocument(part)));
    if (groups.reduce((sum, group) => sum + group.values.length * (group.key === 'entityIds' ? 2 : 1), 0) <= maxTerms)
        return execute({ ...scalar, ...Object.fromEntries(groups.map(group => [group.key, group.values])) });
    // Union each membership filter's batches, then intersect the filters by
    // physical row identity. The caller's one transaction owns every read.
    // This avoids a Cartesian product when several filters are large.
    let selected: Map<string, LightRagStored<K>> | undefined;
    for (const group of groups.sort((a, b) => a.values.length - b.values.length)) {
        const matches = new Map<string, LightRagStored<K>>(), size = group.key === 'entityIds' ? maxTerms / 2 : maxTerms;
        for (let offset = 0; offset < group.values.length; offset += size)
            for (const row of await execute({ ...scalar, [group.key]: group.values.slice(offset, offset + size) }))
                if (selected === undefined || selected.has(row.id)) matches.set(row.id, row);
        if (!matches.size) return [];
        selected = matches;
    }
    return [...selected!.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function lightRagViewWithin(scope: TransactionStore, options: LightRagDbOptions = {}): LightRagWriteView {
    return {
        async get<K extends LightRagTable>(table: K, id: string) { return scope.collection<LightRagStored<K>>('lightrag_' + table).get(id); },
        async put<K extends LightRagTable>(table: K, row: LightRagStored<K>) {
            await scope.collection<LightRagStored<K>>('lightrag_' + table).put(row); await options.applyProbe?.('put:' + table);
        },
        async query<K extends LightRagTable>(table: K, query: LightRagReadQuery) {
            return readWithin(scope, table, query);
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
