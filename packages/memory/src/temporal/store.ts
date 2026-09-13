/** One transactional temporal protocol for injected persistence and in-memory use. */
import { cloneJson } from '@jarenjs/core/object';
import { getEpochOfDateTimeRFC3339 } from '@jarenjs/core/dates';
import { checkTemporal, refuse, success, sameTemporalValue, temporalIdentity, type TemporalResult,
  type SourceOccurrence, type TemporalClaim, type TemporalProjection, type TemporalHead, type TemporalOperation,
  type ProjectionReceipt, type Json, type TemporalClaimRow, type TemporalSnapshot, type TemporalStoreStats } from './contracts.ts';
import { validateTemporalBundle, type TemporalBundle } from './evidence.ts';

export interface TemporalTables {
  occurrences: SourceOccurrence; claims: TemporalClaimRow; projections: TemporalProjection;
  heads: TemporalHead; operations: TemporalOperation;
}
export type TemporalTable = keyof TemporalTables;
export interface TemporalReadQuery {
  scope: string; versionId?: string; subject?: string; series?: string;
  observedFrom?: number; observedUntil?: number; knownBefore?: number; validFromBefore?: number;
  afterId?: string; limit?: number;
}
export interface TemporalTransaction {
  get<K extends TemporalTable>(table: K, id: string): Promise<TemporalTables[K] | undefined>;
  put<K extends TemporalTable>(table: K, value: TemporalTables[K]): Promise<void>;
  query<K extends TemporalTable>(table: K, query: TemporalReadQuery): Promise<TemporalTables[K][]>;
}
export interface TemporalPersistence { transaction<T>(task: (tx: TemporalTransaction) => Promise<T>): Promise<T> }
export interface TemporalApplyOptions {
  key: string; expectedHead: TemporalHead | null;
  /** Complete an existing provider operation in the SAME activation transaction. */
  operation?: { requestIdentity: string; revision: number };
  signal?: AbortSignal;
}
export interface TemporalStore {
  head(scope: string): Promise<TemporalResult<TemporalHead | null>>;
  snapshot(scope: string, expectedHead?: TemporalHead): Promise<TemporalResult<TemporalSnapshot>>;
  occurrence(scope: string, id: string): Promise<TemporalResult<SourceOccurrence | null>>;
  apply(bundle: TemporalBundle, options: TemporalApplyOptions): Promise<TemporalResult<ProjectionReceipt>>;
  reserveOperation(input: { scope: string; key: string; requestIdentity: string; maxPhysicalRequests: number }): Promise<TemporalResult<{ operation: TemporalOperation; replayed: boolean }>>;
  operation(scope: string, key: string): Promise<TemporalResult<TemporalOperation | null>>;
  updateOperation(operation: TemporalOperation, expectedRevision: number): Promise<TemporalResult<TemporalOperation>>;
  queryOccurrences(query: TemporalReadQuery): Promise<TemporalResult<SourceOccurrence[]>>;
  queryClaims(query: TemporalReadQuery & { versionId: string }): Promise<TemporalResult<TemporalClaimRow[]>>;
  stats(): TemporalStoreStats;
}
export function temporalRowId<K extends TemporalTable>(table: K, value: TemporalTables[K]): string {
  if (table === 'heads') return (value as TemporalHead).scope;
  if (table === 'projections') return (value as TemporalProjection).versionId;
  return (value as SourceOccurrence | TemporalOperation | TemporalClaimRow).id;
}
const operationId = (scope: string, key: string) => temporalIdentity(['operation', scope, key]);
function storageFailure(cause: unknown) { return refuse('storage-failure', cause instanceof Error ? cause.message : String(cause)); }
function isSameHead(a: TemporalHead | null, b: TemporalHead | null): boolean { return sameTemporalValue(a, b); }
export type TemporalStagedRecord = { table: 'occurrences'; value: SourceOccurrence } |
  { table: 'claims'; value: TemporalClaimRow } | { table: 'projections'; value: TemporalProjection };
/** One validated physical-membership derivation for activation and explicit bounded backfill. */
export async function temporalProjectionRecords(input: TemporalBundle): Promise<TemporalResult<{ bundle: TemporalBundle; records: TemporalStagedRecord[] }>> {
  const checked = await validateTemporalBundle(input); if (checked.status !== 'success') return checked;
  const bundle = checked.value, p = bundle.projection;
  const records: TemporalStagedRecord[] = bundle.sources.map(value => ({ table: 'occurrences', value }));
  const sources = new Map(bundle.sources.map(s => [s.id, s]));
  for (const claim of bundle.claims) {
    const t = claim.time;
    const knownAtEpochMs = Math.max(...claim.citations.map(c => getEpochOfDateTimeRFC3339(sources.get(c.sourceId)!.knownAt)!));
    const validFromEpochMs = t.kind === 'unknown' ? null : getEpochOfDateTimeRFC3339(t.kind === 'point' ? t.at : t.from)!;
    const validUntilEpochMs = t.kind === 'period' ? getEpochOfDateTimeRFC3339(t.until)! : t.kind === 'state' && t.until.kind === 'at' ? getEpochOfDateTimeRFC3339(t.until.at)! : null;
    records.push({ table: 'claims', value: { id: await temporalIdentity(['membership', p.scope, p.versionId, claim.id]), scope: p.scope, versionId: p.versionId,
      subject: claim.series.subject, series: claim.series.key, knownAtEpochMs, validFromEpochMs, validUntilEpochMs, claim } });
  }
  records.push({ table: 'projections', value: p });
  return success({ bundle, records });
}
function validRead(query: TemporalReadQuery): boolean {
  return typeof query.scope === 'string' && query.scope.length > 0 &&
    (query.limit === undefined || Number.isSafeInteger(query.limit) && query.limit > 0) &&
    [query.observedFrom, query.observedUntil, query.knownBefore, query.validFromBefore].every(n => n === undefined || Number.isSafeInteger(n));
}

export function createTemporalStoreAdapter(persistence: TemporalPersistence): TemporalStore {
  const stats: TemporalStoreStats = { writes: 0, activations: 0, transactions: 0 };
  async function transaction<T>(task: (tx: TemporalTransaction) => Promise<TemporalResult<T>>): Promise<TemporalResult<T>> {
    try {
      let writes = 0, activations = 0;
      const result = await persistence.transaction(tx => task({
        get: (table, id) => tx.get(table, id), query: (table, query) => tx.query(table, query),
        async put(table, value) { await tx.put(table, value); writes++; if (table === 'heads') activations++; },
      }));
      stats.transactions++; stats.writes += writes; stats.activations += activations;
      return result;
    } catch (cause) { return storageFailure(cause); }
  }
  const store: TemporalStore = {
    stats: () => ({ ...stats }),
    head(scope) { return transaction(async tx => success(await tx.get('heads', scope) ?? null)); },
    occurrence(scope, id) { return transaction(async tx => {
      const source = await tx.get('occurrences', id);
      return source && source.scope !== scope ? refuse('identity-mismatch', 'source belongs to another scope') : success(source ?? null);
    }); },
    snapshot(scope, expectedHead) { return transaction(async tx => {
      const head = await tx.get('heads', scope);
      if (!head) return refuse('incomplete-index', 'scope has no active projection');
      if (expectedHead && !isSameHead(head, expectedHead)) return refuse('stale-projection', 'captured head revision changed');
      const projection = await tx.get('projections', head.versionId);
      if (!projection || !projection.complete) return refuse('incomplete-index', 'active projection is missing or incomplete');
      const sources: SourceOccurrence[] = [];
      for (const id of projection.occurrenceIds) {
        const source = await tx.get('occurrences', id);
        if (!source || source.scope !== scope) return refuse('incomplete-index', 'active projection source is missing');
        sources.push(source);
      }
      const rows = await tx.query('claims', { scope, versionId: projection.versionId });
      const checked = await validateTemporalBundle({ projection, sources, claims: rows.map(r => r.claim) });
      return checked.status === 'success' ? success({ ...checked.value, head }) : checked;
    }); },
    async apply(input, options) {
      const checked = await temporalProjectionRecords(input); if (checked.status !== 'success') return checked;
      const { bundle, records } = checked.value, p = bundle.projection;
      if (!p.complete) return refuse('incomplete-index', 'only complete projections may activate');
      if (!options.key || options.expectedHead?.scope !== undefined && options.expectedHead.scope !== p.scope) return refuse('identity-mismatch', 'apply key or head scope is invalid');
      const id = await operationId(p.scope, options.key);
      const requestIdentity = options.operation?.requestIdentity ?? await temporalIdentity({ bundle, expectedHead: options.expectedHead });
      return transaction(async tx => {
        if (options.signal?.aborted) return refuse('provider-refusal', 'activation cancelled before writes');
        const prior = await tx.get('operations', id);
        if (prior) {
          if (prior.requestIdentity !== requestIdentity) return refuse('identity-mismatch', 'idempotency key has different content');
          if (prior.phase === 'completed') {
            const receipt = checkTemporal<ProjectionReceipt>('projectionReceipt', prior.receipt);
            return receipt.status === 'success' ? success({ ...receipt.value, replayed: true, writes: 0, activations: 0 }) : receipt;
          }
          if (!options.operation || prior.revision !== options.operation.revision || prior.phase !== 'in-flight') return refuse('provider-refusal', 'operation cannot activate from this phase or revision');
          if (prior.attempts.some(a => a.phase !== 'completed')) return refuse('provider-refusal', 'activation requires a completed receipt for every physical attempt');
        } else if (options.operation) return refuse('identity-mismatch', 'provider activation has no reserved operation');
        const current = await tx.get('heads', p.scope) ?? null;
        if (!isSameHead(current, options.expectedHead)) return refuse('stale-projection', 'expected head revision differs');
        const staged: { table: 'occurrences' | 'claims' | 'projections'; value: SourceOccurrence | TemporalClaimRow | TemporalProjection }[] = [];
        async function stage<K extends 'occurrences' | 'claims' | 'projections'>(table: K, value: TemporalTables[K]): Promise<boolean> {
          const old = await tx.get(table, temporalRowId(table, value));
          if (old) return sameTemporalValue(old, value);
          staged.push({ table, value }); return true;
        }
        for (const row of records) if (!await stage(row.table, row.value)) return refuse('identity-mismatch', 'immutable projection record differs');
        const head: TemporalHead = { scope: p.scope, versionId: p.versionId, revision: (current?.revision ?? 0) + 1 };
        const receipt: ProjectionReceipt = { head, replayed: false, writes: staged.length + 2, activations: 1 };
        for (const entry of staged) await tx.put(entry.table, entry.value);
        // Cancellation after any staging write aborts the transaction, preserving the previous head.
        options.signal?.throwIfAborted();
        await tx.put('heads', head);
        await tx.put('operations', { id, scope: p.scope, key: options.key, requestIdentity, revision: (prior?.revision ?? 0) + 1,
          phase: 'completed', maxPhysicalRequests: prior?.maxPhysicalRequests ?? 0, attempts: prior?.attempts ?? [], receipt: receipt as unknown as Json });
        options.signal?.throwIfAborted();
        return success(receipt);
      });
    },
    async operation(scope, key) { return transaction(async tx => success(await tx.get('operations', await operationId(scope, key)) ?? null)); },
    async reserveOperation(input) {
      const operation: TemporalOperation = { ...input, id: await operationId(input.scope, input.key), revision: 0, phase: 'reserved', attempts: [], receipt: null };
      const checked = checkTemporal<TemporalOperation>('temporalOperation', operation); if (checked.status !== 'success') return checked;
      return transaction<{ operation: TemporalOperation; replayed: boolean }>(async tx => {
        const prior = await tx.get('operations', operation.id);
        if (prior) return prior.requestIdentity !== operation.requestIdentity || prior.maxPhysicalRequests !== operation.maxPhysicalRequests ?
          refuse('identity-mismatch', 'operation key already reserves different inputs or limits') : success({ operation: prior, replayed: true });
        await tx.put('operations', operation); return success({ operation, replayed: false });
      });
    },
    updateOperation(input, expectedRevision) {
      const checked = checkTemporal<TemporalOperation>('temporalOperation', input); if (checked.status !== 'success') return Promise.resolve(checked);
      const next = checked.value;
      return transaction(async tx => {
        const prior = await tx.get('operations', next.id);
        if (!prior || prior.scope !== next.scope || prior.key !== next.key || prior.requestIdentity !== next.requestIdentity || prior.maxPhysicalRequests !== next.maxPhysicalRequests) return refuse('identity-mismatch', 'operation identity differs');
        if (sameTemporalValue(prior, next)) return success(prior);
        if (prior.revision !== expectedRevision || next.revision !== expectedRevision + 1) return refuse('stale-projection', 'operation revision differs');
        if (['completed', 'failed', 'unknown'].includes(prior.phase)) return refuse('provider-refusal', 'terminal operations are immutable');
        if (next.phase === 'reserved' || next.attempts.length < prior.attempts.length || next.attempts.length > next.maxPhysicalRequests) return refuse('budget-exhausted', 'invalid operation phase or physical request count');
        if (next.phase === 'completed' && (next.receipt === null || next.attempts.some(a => a.phase !== 'completed'))) return refuse('provider-refusal', 'completed operations require a receipt and completed physical attempts');
        if (next.attempts.some(a => a.phase === 'in-flight' && (a.reply !== null || a.outputTokens !== null))) return refuse('provider-refusal', 'in-flight attempts cannot contain response receipts');
        if (next.phase === 'failed' && next.attempts.some(a => a.phase === 'in-flight' || a.phase === 'unknown') || next.phase === 'unknown' && next.attempts.some(a => a.phase === 'in-flight')) return refuse('provider-refusal', 'terminal operations must preserve uncertain physical outcomes explicitly');
        if (next.attempts.length > prior.attempts.length + 1 || next.attempts.slice(prior.attempts.length).some(a => a.phase !== 'in-flight') || next.attempts.filter(a => a.phase === 'in-flight').length > 1) return refuse('provider-refusal', 'physical attempts must be reserved one at a time before transport');
        for (let i = 0; i < prior.attempts.length; i++) {
          const before = prior.attempts[i], after = next.attempts[i];
          if (before.role !== after.role || before.requestHash !== after.requestHash || before.inputTokens !== after.inputTokens ||
            before.phase !== 'in-flight' && !sameTemporalValue(before, after)) return refuse('identity-mismatch', 'recorded physical attempts are immutable');
        }
        await tx.put('operations', next); return success(next);
      });
    },
    queryOccurrences(query) { return validRead(query) ? transaction(async tx => success(await tx.query('occurrences', query))) : Promise.resolve(refuse('identity-mismatch', 'invalid scoped read limits')); },
    queryClaims(query) { return validRead(query) && !!query.versionId ? transaction(async tx => success(await tx.query('claims', query))) : Promise.resolve(refuse('identity-mismatch', 'claim reads need a scope and projection version')); },
  };
  return store;
}

type MemoryTables = { [K in TemporalTable]: Map<string, TemporalTables[K]> };
export interface TemporalMemoryState { occurrences: SourceOccurrence[]; claims: TemporalClaimRow[]; projections: TemporalProjection[]; heads: TemporalHead[]; operations: TemporalOperation[] }
export interface TemporalMemoryOptions { applyProbe?: (step: string) => void; state?: TemporalMemoryState }
export function createTemporalMemoryPersistence(options: TemporalMemoryOptions = {}): TemporalPersistence & { exportState(): TemporalMemoryState } {
  const names: TemporalTable[] = ['occurrences', 'claims', 'projections', 'heads', 'operations'];
  let tables = Object.fromEntries(names.map(name => [name, new Map((options.state?.[name] ?? []).map(row => [temporalRowId(name, row), cloneJson(row)]))])) as MemoryTables;
  let pending = Promise.resolve();
  return {
    exportState: () => Object.fromEntries(names.map(name => [name, [...tables[name].values()].map(v => cloneJson(v))])) as unknown as TemporalMemoryState,
    async transaction<T>(task: (tx: TemporalTransaction) => Promise<T>): Promise<T> {
      const before = pending;
      let release!: () => void; pending = new Promise<void>(resolve => { release = resolve; });
      await before;
      const next: MemoryTables = { occurrences: new Map(tables.occurrences), claims: new Map(tables.claims),
        projections: new Map(tables.projections), heads: new Map(tables.heads), operations: new Map(tables.operations) };
      try {
        const result = await task({
          async get<K extends TemporalTable>(table: K, id: string) { const row = next[table].get(id); return row === undefined ? undefined : cloneJson(row); },
          async put<K extends TemporalTable>(table: K, value: TemporalTables[K]) { (next[table] as Map<string, TemporalTables[K]>).set(temporalRowId(table, value), cloneJson(value)); options.applyProbe?.(`put:${table}`); },
          async query<K extends TemporalTable>(table: K, q: TemporalReadQuery) {
            const rows = [...next[table].values()].filter(row => {
              if (row.scope !== q.scope) return false;
              const value = row as unknown as Record<string, unknown>;
              if (q.versionId !== undefined && value.versionId !== q.versionId || q.subject !== undefined && value.subject !== q.subject || q.series !== undefined && value.series !== q.series) return false;
              const observed = table === 'occurrences' ? getEpochOfDateTimeRFC3339((row as SourceOccurrence).observedAt.at)! : null;
              const known = table === 'occurrences' ? getEpochOfDateTimeRFC3339((row as SourceOccurrence).knownAt)! : value.knownAtEpochMs as number | undefined;
              if (q.observedFrom !== undefined && (observed === null || observed < q.observedFrom) || q.observedUntil !== undefined && (observed === null || observed >= q.observedUntil)) return false;
              if (q.knownBefore !== undefined && (known === undefined || known > q.knownBefore)) return false;
              if (q.validFromBefore !== undefined && (typeof value.validFromEpochMs !== 'number' || value.validFromEpochMs > q.validFromBefore)) return false;
              return q.afterId === undefined || temporalRowId(table, row) > q.afterId;
            }).sort((a, b) => temporalRowId(table, a).localeCompare(temporalRowId(table, b)));
            return rows.slice(0, q.limit).map(v => cloneJson(v));
          },
        });
        options.applyProbe?.('commit'); tables = next; return result;
      } finally { release(); }
    },
  };
}
export function createTemporalMemoryStore(options: TemporalMemoryOptions = {}): TemporalStore {
  return createTemporalStoreAdapter(createTemporalMemoryPersistence(options));
}
