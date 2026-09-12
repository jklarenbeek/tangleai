/** Opaque atomic store handles. The trusted adapter is injected at construction. */
import { cloneJson } from '@jarenjs/core/object';
import { JarenValidator } from '@jarenjs/validate';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { MEMORY_UNIT_SCHEMA, MEMORY_RELATION_SCHEMA } from '@tangleai/core/schemas/memory';
import { reject } from './errors.ts';
import type { MemoryStore } from '@tangleai/memory/store';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import type { StoredRecord, HeadRow, KeyRow, Operation } from './outcomes.contracts.gen.ts';
export interface Tables {
    records: StoredRecord;
    keys: KeyRow;
    heads: HeadRow;
    operations: Operation;
    memories: MemoryUnit;
}
export interface Query {
    scopeId?: string;
    artifactKey?: string;
    kind?: string;
    after?: number;
    upper?: number;
    limit?: number;
    reservedOnly?: boolean;
}
export interface OutcomeTransaction {
    get<K extends keyof Tables>(table: K, id: string): Promise<Tables[K] | undefined>;
    put<K extends keyof Tables>(table: K, value: Tables[K]): Promise<void>;
    delete<K extends keyof Tables>(table: K, id: string): Promise<void>;
    query<K extends keyof Tables>(table: K, query: Query): Promise<Tables[K][]>;
}
/** Trusted persistence extension; never a wire operation. All changes must roll back on throw. */
export interface OutcomePersistence {
    transaction<T>(task: (view: OutcomeTransaction) => Promise<T>): Promise<T>;
}
export interface OutcomeStore {
    readonly memories: MemoryStore;
    readonly atomic: true;
}
const backends = new WeakMap<OutcomeStore, OutcomePersistence>();
const memoryValidator = new JarenValidator({ collectErrors: true, unknownFormats: 'ignore' });
memoryValidator.addSchema(MEMORY_RELATION_SCHEMA);
const validateMemory = memoryValidator.compile(MEMORY_UNIT_SCHEMA);
export function checkedMemory(value: unknown): MemoryUnit {
    try {
        canonicalizeJson(value);
    }
    catch {
        reject('OUTC1001', 'Memory must be finite JSON.');
    }
    if (!validateMemory(value).valid)
        reject('OUTC1001', 'Memory schema rejected the value.');
    return cloneJson(value) as MemoryUnit;
}
/** Package-internal access; not exported as a public subpath. */
export function persistenceFor(store: OutcomeStore): OutcomePersistence { const p = backends.get(store); if (!p)
    throw new TypeError('Use an atomic outcome store factory.'); return p; }
export function createOutcomeStoreAdapter(persistence: OutcomePersistence): OutcomeStore {
    if (typeof persistence?.transaction !== 'function')
        throw new TypeError('An atomic transaction adapter is required.');
    const store: OutcomeStore = Object.freeze({ atomic: true as const, memories: {
            get: (id: string) => persistence.transaction(tx => tx.get('memories', id)),
            put: async (unit: MemoryUnit) => { const valid = checkedMemory(unit); await persistence.transaction(tx => tx.put('memories', valid)); },
            delete: (id: string) => persistence.transaction(tx => tx.delete('memories', id)),
            list: () => persistence.transaction(tx => tx.query('memories', {})),
        } });
    backends.set(store, persistence);
    return store;
}
export interface MemoryOutcomeStoreOptions {
    memories?: readonly MemoryUnit[];
    applyProbe?: (step: string) => void;
}
export function createMemoryOutcomeStore(options: MemoryOutcomeStoreOptions = {}): OutcomeStore {
    let state: {
        [K in keyof Tables]: Map<string, Tables[K]>;
    } = { records: new Map(), keys: new Map(), heads: new Map(), operations: new Map(), memories: new Map() };
    for (const m of options.memories ?? [])
        state.memories.set(m.id, checkedMemory(m));
    let pending: Promise<unknown> = Promise.resolve();
    const persistence: OutcomePersistence = { transaction<T>(task: (v: OutcomeTransaction) => Promise<T>): Promise<T> {
            const result = pending.then(async () => {
                const staged = Object.fromEntries(Object.entries(state).map(([k, v]) => [k, new Map([...v].map(([id, value]) => [id, cloneJson(value)]))])) as typeof state;
                const view: OutcomeTransaction = {
                    async get(table, id) { return cloneJson(staged[table].get(id)) as never; },
                    async put(table, value) { (staged[table] as Map<string, Tables[typeof table]>).set(value.id, cloneJson(value)); options.applyProbe?.(`put:${table}`); },
                    async delete(table, id) { staged[table].delete(id); options.applyProbe?.(`delete:${table}`); },
                    async query(table, q) { let rows = [...staged[table].values()].filter(v => { const r = v as unknown as Record<string, unknown>; return (!q.reservedOnly || r.capacityReserved === true) && (q.scopeId === undefined || r.scopeId === q.scopeId) && (q.artifactKey === undefined || r.artifactKey === q.artifactKey) && (q.kind === undefined || r.kind === q.kind) && (q.after === undefined || Number(r.seq) > q.after) && (q.upper === undefined || Number(r.seq) <= q.upper); }); rows.sort((a, b) => { const x = a as unknown as Record<string, unknown>, y = b as unknown as Record<string, unknown>; return Number(x.seq ?? 0) - Number(y.seq ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }); if (q.limit !== undefined)
                        rows = rows.slice(0, q.limit); return cloneJson(rows) as never; },
                };
                const value = await task(view);
                options.applyProbe?.('commit');
                state = staged;
                return value;
            });
            pending = result.then(() => undefined, () => undefined);
            return result;
        } };
    return createOutcomeStoreAdapter(persistence);
}
