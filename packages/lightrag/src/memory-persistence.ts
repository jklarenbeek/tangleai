import { cloneJson } from '@jarenjs/core/object';
import { immutableLightRagJson } from './identity.ts';
import { LIGHTRAG_TABLES, type LightRagTable, type LightRagStored, type LightRagReadView, type LightRagWriteView, type LightRagPersistence } from './persistence.ts';
export interface MemoryLightRagOptions { applyProbe?: (step: string) => void | Promise<void> }
/** A transaction publishes one new map set; readers retain the prior immutable snapshot. */
export function createMemoryLightRagPersistence(options: MemoryLightRagOptions = {}): LightRagPersistence {
    if (options.applyProbe !== undefined && typeof options.applyProbe !== 'function') throw new TypeError('The write probe must be a function.');
    type State = Map<LightRagTable, Map<string, LightRagStored>>;
    let state: State = new Map(LIGHTRAG_TABLES.map(table => [table, new Map()]));
    let pending: Promise<unknown> = Promise.resolve();
    const readView = (snapshot: State): LightRagReadView => ({
        async get<K extends LightRagTable>(table: K, id: string) {
            return cloneJson(snapshot.get(table)!.get(id)) as LightRagStored<K> | undefined;
        },
        async query<K extends LightRagTable>(table: K, query: Parameters<LightRagReadView['query']>[1]) {
            const rows = [...snapshot.get(table)!.values()].filter(row =>
                (['sourceId', 'versionId', 'projectionId', 'status'] as const).every(key => query[key] === undefined || row[key] === query[key])
                && (query.ids === undefined || query.ids.includes(row.id))
                && (query.claimIds === undefined || 'id' in row.payload && query.claimIds.includes(row.payload.id))
                && (query.normalizedNames === undefined || row.normalizedName !== null && query.normalizedNames.includes(row.normalizedName))
                && (query.entityIds === undefined || row.sourceEntityId !== null && query.entityIds.includes(row.sourceEntityId)
                    || row.targetEntityId !== null && query.entityIds.includes(row.targetEntityId)));
            rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
            return cloneJson(rows) as LightRagStored<K>[];
        },
    });
    return {
        read: task => task(readView(state)),
        transaction(task) {
            const result = pending.then(async () => {
                const staged: State = new Map([...state].map(([table, rows]) => [table, new Map(rows)]));
                const view: LightRagWriteView = {
                    ...readView(staged),
                    async put<K extends LightRagTable>(table: K, row: LightRagStored<K>) {
                        staged.get(table)!.set(row.id, immutableLightRagJson(row));
                        await options.applyProbe?.('put:' + table);
                    },
                };
                const value = await task(view); await options.applyProbe?.('commit'); state = staged; return value;
            });
            pending = result.then(() => undefined, () => undefined); return result;
        },
    };
}
