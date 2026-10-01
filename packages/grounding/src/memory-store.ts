import { cloneJson } from '@jarenjs/core/object';
import { createGroundingStoreAdapter, GROUNDING_TABLES, type GroundingStore, type GroundingPersistence, type GroundingStored, type GroundingTable, type GroundingPersistenceView } from './store.ts';
export interface MemoryGroundingStoreOptions { applyProbe?: (step: string) => void; }
export function createMemoryGroundingStore(options: MemoryGroundingStoreOptions = {}): GroundingStore {
    if (options.applyProbe !== undefined && typeof options.applyProbe !== 'function') throw new TypeError('A grounding write probe must be a function.');
    type State = Map<GroundingTable, Map<string, GroundingStored>>;
    let state: State = new Map(GROUNDING_TABLES.map(table => [table, new Map()])), pending: Promise<unknown> = Promise.resolve();
    const persistence: GroundingPersistence = {
        transaction(task) {
            const result = pending.then(async () => {
                const staged: State = new Map([...state].map(([table, rows]) => [table, new Map([...rows].map(([id, row]) => [id, cloneJson(row)]))]));
                const view: GroundingPersistenceView = {
                    async get(table, id) { return cloneJson(staged.get(table)!.get(id)) as GroundingStored<typeof table> | undefined; },
                    async put(table, row) { staged.get(table)!.set(row.id, cloneJson(row)); options.applyProbe?.('put:grounding_' + table); },
                    async query(table, query) {
                        const rows = [...staged.get(table)!.values()].filter(row => (Object.keys(query) as Array<keyof typeof query>).every(key => row[key] === query[key]));
                        rows.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
                        return cloneJson(rows) as GroundingStored<typeof table>[];
                    },
                };
                const value = await task(view); options.applyProbe?.('commit'); state = staged; return value;
            });
            pending = result.then(() => undefined, () => undefined); return result;
        },
    };
    return createGroundingStoreAdapter(persistence);
}
