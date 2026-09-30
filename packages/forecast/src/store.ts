/** One guarded transaction owner for memory and trusted durable adapters. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { FORECAST_TABLES, FORECAST_RECORD_SCHEMAS, validateForecastRecord, type ForecastTable, type ForecastTables } from './identity.ts';
import { checkShape } from './schema.ts';
import { failure, forecastMust, reject, type ForecastCommandResult } from './errors.ts';
import { planCheckpointTransition, visibleHarness } from './transitions.ts';

export interface ForecastQuery { questionId?: string; scopeKey?: string; checkpointId?: string; status?: string; after?: string; limit?: number; }
export interface ForecastStored<K extends ForecastTable = ForecastTable> {
  id: string; kind: K; questionId: string | null; scopeKey: string; checkpointId: string | null;
  ordinal: number | null; status: string | null; payload: ForecastTables[K];
}
/** Trusted persistence must roll back every write if its callback throws. */
export interface ForecastPersistenceView {
  get<K extends ForecastTable>(table: K, id: string): Promise<ForecastStored<K> | undefined>;
  put<K extends ForecastTable>(table: K, row: ForecastStored<K>): Promise<void>;
  query<K extends ForecastTable>(table: K, query: ForecastQuery): Promise<ForecastStored<K>[]>;
}
export interface ForecastPersistence { transaction<T>(task: (tx: ForecastPersistenceView) => Promise<T>): Promise<T>; }
export interface ForecastStore { readonly atomic: true; }
export interface ForecastTransaction {
  get<K extends ForecastTable>(table: K, id: string): Promise<ForecastTables[K] | undefined>;
  put<K extends ForecastTable>(table: K, value: ForecastTables[K]): Promise<number>;
  query<K extends ForecastTable>(table: K, query: ForecastQuery): Promise<ForecastTables[K][]>;
}
type MutableTable = 'questions' | 'schedules' | 'checkpoints' | 'harnesses';
/** Internal command capability, never exposed by the public transaction wrapper. */
export interface ForecastCommandTransaction extends ForecastTransaction {
  replace<K extends MutableTable>(table: K, before: ForecastTables[K], after: ForecastTables[K]): Promise<number>;
}
const backends = new WeakMap<ForecastStore, ForecastPersistence>();
const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function checkAddress(table: ForecastTable, id?: string) {
  if (!FORECAST_TABLES.includes(table) || id !== undefined && !isHash(id)) reject('TFCT1001', 'Invalid forecast table or record address.');
}
export function checkedForecastQuery(input: ForecastQuery): ForecastQuery {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['questionId','scopeKey','checkpointId','status','after','limit'].includes(k))) reject('TFCT1001', 'Invalid forecast query.');
  for (const key of ['questionId','checkpointId','after'] as const) if (input[key] !== undefined && !isHash(input[key])) reject('TFCT1001', 'Invalid forecast query address.', '/' + key);
  for (const key of ['scopeKey','status'] as const) if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key]!.trim())) reject('TFCT1001', 'Invalid forecast query selector.', '/' + key);
  const limit = input.limit ?? 1000;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10000) reject('TFCT1001', 'Forecast query limit must be an integer from 0 through 10000.', '/limit');
  return { ...input, limit };
}
/** Indexed ownership is derived here once, never independently by an adapter. */
async function storageRow<K extends ForecastTable>(tx: ForecastPersistenceView, table: K, value: ForecastTables[K]): Promise<ForecastStored<K>> {
  const data = value as unknown as Record<string, unknown>;
  let questionId = table === 'questions' ? value.id : typeof data.questionId === 'string' ? data.questionId : null;
  const checkpointId = table === 'checkpoints' ? value.id : typeof data.checkpointId === 'string' ? data.checkpointId : null;
  if (checkpointId && table !== 'checkpoints') {
    const checkpoint = await tx.get('checkpoints', checkpointId);
    if (!checkpoint) reject('TFCT1002', 'The referenced checkpoint is missing.', '/checkpointId');
    if (questionId && questionId !== checkpoint.questionId) reject('TFCT1003', 'The record crosses checkpoint question ownership.');
    questionId = checkpoint.questionId;
  }
  let scopeKey = typeof data.scopeKey === 'string' ? data.scopeKey : null;
  if (questionId && table !== 'questions') {
    const question = await tx.get('questions', questionId);
    if (!question) reject('TFCT1002', 'The referenced question is missing.', '/questionId');
    if (scopeKey && scopeKey !== question.scopeKey) reject('TFCT1003', 'The record crosses question scope ownership.');
    scopeKey = question.scopeKey;
  }
  if (!scopeKey) reject('TFCT1003', 'A forecast record requires a retained scope owner.');
  return { id: value.id, kind: table, questionId, scopeKey, checkpointId, ordinal: typeof data.ordinal === 'number' ? data.ordinal : null, status: typeof data.status === 'string' ? data.status : null, payload: value };
}
function assertInitial<K extends ForecastTable>(table: K, value: ForecastTables[K]) {
  if (table === 'questions') {
    const q = value as ForecastTables['questions'];
    if (q.status !== 'open' || q.latestProvisionalVersionId !== null) reject('TFCT1004', 'Create an open question without a provisional head.');
  }
  if (table === 'schedules' && (value as ForecastTables['schedules']).status !== 'due') reject('TFCT1004', 'Create a due schedule before transitioning it.');
  if (table === 'checkpoints' && (value as ForecastTables['checkpoints']).status !== 'planned') reject('TFCT1004', 'Plan a checkpoint before transitioning it.');
  if (table === 'harnesses' && (value as ForecastTables['harnesses']).status !== 'staged') reject('TFCT1004', 'Stage a harness before transitioning it.');
}
export function createForecastStoreAdapter(persistence: ForecastPersistence): ForecastStore {
  if (typeof persistence?.transaction !== 'function') throw new TypeError('An atomic forecast persistence adapter is required.');
  const store = Object.freeze({ atomic: true as const }); backends.set(store, persistence); return store;
}
async function transact<T>(store: ForecastStore, task: (tx: ForecastCommandTransaction) => Promise<T>): Promise<ForecastCommandResult<T>> {
  const backend = backends.get(store);
  if (!backend || typeof task !== 'function') throw new TypeError('Use a forecast store factory and a transaction function.');
  let writes = 0;
  try {
    const value = await backend.transaction(async raw => {
      let invalid: unknown, invalidated = false;
      const guard = async <R>(fn: () => Promise<R>) => {
        try { return await fn(); } catch (error) { invalidated = true; invalid = error; throw error; }
      };
      const tx: ForecastCommandTransaction = {
        get: (table,id) => guard(async () => { checkAddress(table,id); return cloneJson((await raw.get(table,id))?.payload) as ForecastTables[typeof table] | undefined; }),
        query: (table,q) => guard(async () => { checkAddress(table); return cloneJson((await raw.query(table,checkedForecastQuery(q))).map(row => row.payload)); }),
        put: (table,input) => guard(async () => {
          checkAddress(table);
          const shaped = checkShape<ForecastTables[typeof table]>(FORECAST_RECORD_SCHEMAS[table], input);
          const prior = await raw.get(table,shaped.id);
          if (prior && !equalsJson(prior.payload,shaped)) reject('TFCT1010', 'An immutable forecast address already contains different bytes.', '/id');
          const record = await validateForecastRecord(table,shaped);
          if (prior) return 0;
          assertInitial(table,record);
          const row = await storageRow(raw,table,record);
          if (table === 'checkpoints' || table === 'schedules') {
            const peers = await raw.query(table,{ questionId: row.questionId!,limit: 1000 });
            if (peers.some(peer => peer.ordinal === row.ordinal)) reject('TFCT1004', 'A checkpoint already owns this question and ordinal.');
            const question = (await raw.get('questions',row.questionId!))!.payload;
            const scheduled = record as ForecastTables['schedules'];
            if (question.checkpointPolicy.scheduledAt[scheduled.ordinal - 1] !== scheduled.scheduledAt || scheduled.cutoffAt < question.issuedAt)
              reject('TFCT1004', 'The checkpoint is outside the registered question schedule.');
            if (table === 'checkpoints') {
              const checkpoint = record as ForecastTables['checkpoints'];
              if (question.status !== 'open') reject('TFCT1004', 'Only an open question can plan another checkpoint.');
              forecastMust(planCheckpointTransition(checkpoint,{ type: 'checkpoint.start',at: checkpoint.scheduledAt },{ ordinals: question.checkpointPolicy.ordinals,checkpoints: peers.map(peer => peer.payload as ForecastTables['checkpoints']) }));
              if (checkpoint.inputHarnessVersionId) {
                const harness = await raw.get('harnesses',checkpoint.inputHarnessVersionId);
                if (!harness || harness.payload.digest !== checkpoint.inputHarnessDigest) reject('TFCT1002', 'The checkpoint harness or digest is missing.');
                forecastMust(visibleHarness(question,harness.payload));
              }
            }
          }
          await raw.put(table,row); writes++; return 1;
        }),
        replace: (table,before,after) => guard(async () => {
          checkAddress(table,before.id);
          if (!['questions','schedules','checkpoints','harnesses'].includes(table)) reject('TFCT1004', 'This forecast record has no mutable lifecycle.');
          const current = await raw.get(table,before.id);
          if (!current || !equalsJson(current.payload,before)) reject('TFCT1004', 'The lifecycle record changed after planning.');
          const next = await validateForecastRecord(table,after);
          if (next.id !== before.id) reject('TFCT1002', 'A lifecycle command cannot replace immutable inputs.');
          if (equalsJson(before,next)) return 0;
          await raw.put(table,await storageRow(raw,table,next)); writes++; return 1;
        }),
      };
      const output = await task(tx);
      if (invalidated) throw invalid;
      return output;
    });
    return { ok: true, value, writes };
  } catch (error) { return failure(error); }
}
/** Package-internal command entry; absent from the public barrel and subpaths. */
export const forecastCommandTransaction = transact;
export function forecastTransaction<T>(store: ForecastStore, task: (tx: ForecastTransaction) => Promise<T>): Promise<ForecastCommandResult<T>> {
  if (typeof task !== 'function') throw new TypeError('A forecast transaction function is required.');
  return transact(store,tx => task(Object.freeze({ get: tx.get, put: tx.put, query: tx.query })));
}
export function forecastGet<K extends ForecastTable>(store: ForecastStore, table: K, id: string) { return forecastTransaction(store, async tx => await tx.get(table,id) ?? null); }
export function forecastQuery<K extends ForecastTable>(store: ForecastStore, table: K, query: ForecastQuery = {}) { return forecastTransaction(store,tx => tx.query(table,query)); }
export function forecastPut<K extends ForecastTable>(store: ForecastStore, table: K, value: ForecastTables[K]) {
  return forecastTransaction(store,async tx => { await tx.put(table,value); return (await tx.get(table,value.id))!; });
}
export interface MemoryForecastStoreOptions { applyProbe?: (step: string) => void; }
export function createMemoryForecastStore(options: MemoryForecastStoreOptions = {}): ForecastStore {
  if (options.applyProbe !== undefined && typeof options.applyProbe !== 'function') throw new TypeError('The forecast write probe must be a function.');
  type State = Map<ForecastTable, Map<string, ForecastStored>>;
  let state: State = new Map(FORECAST_TABLES.map(table => [table,new Map()])), pending: Promise<unknown> = Promise.resolve();
  const persistence: ForecastPersistence = {
    transaction<T>(task: (tx: ForecastPersistenceView) => Promise<T>): Promise<T> {
      const result = pending.then(async () => {
        const staged: State = new Map([...state].map(([table,rows]) => [table,new Map([...rows].map(([id,row]) => [id,cloneJson(row)]))]));
        const view: ForecastPersistenceView = {
          async get(table,id) { return cloneJson(staged.get(table)!.get(id)) as ForecastStored<typeof table> | undefined; },
          async put(table,row) { staged.get(table)!.set(row.id,cloneJson(row)); options.applyProbe?.('put:forecast_' + table); },
          async query(table,q) {
            const rows = [...staged.get(table)!.values()].filter(row => (['questionId','scopeKey','checkpointId','status'] as const).every(key => q[key] === undefined || row[key] === q[key]) && (q.after === undefined || row.id > q.after));
            rows.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
            return cloneJson(rows.slice(0,q.limit ?? 1000)) as ForecastStored<typeof table>[];
          },
        };
        const value = await task(view); options.applyProbe?.('commit'); state = staged; return value;
      });
      pending = result.then(() => undefined, () => undefined); return result;
    },
  };
  return createForecastStoreAdapter(persistence);
}
