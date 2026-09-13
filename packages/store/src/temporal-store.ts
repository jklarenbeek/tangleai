/** Temporal semantics over Jaren's transaction owner, collections and declared numeric indexes. */
import { getEpochOfDateTimeRFC3339 } from '@jarenjs/core/dates';
import { createTemporalStoreAdapter, temporalRowId, selectTemporalAt, refuse, success,
  type TemporalPersistence, type TemporalTables, type TemporalTable, type TemporalTransaction, type TemporalReadQuery,
  type TemporalStore, type TemporalResult, type SourceOccurrence, type TemporalClaimRow, type TemporalHead, type TemporalProjection } from '@tangleai/memory/temporal';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';

const names: Record<TemporalTable, string> = { occurrences: 'temporal_occurrences', claims: 'temporal_claims',
  projections: 'temporal_claims', heads: 'temporal_heads', operations: 'temporal_operations' };
interface PhysicalTemporalRow {
  id: string; scope: string; recordType: TemporalTable; payload: TemporalTables[TemporalTable];
  versionId?: string; subject?: string; series?: string; observedAtEpochMs?: number; knownAtEpochMs?: number;
  validFromEpochMs?: number; validUntilEpochMs?: number;
}
export interface TemporalDbOptions { applyProbe?: (step: string) => void }
function physicalRow<K extends TemporalTable>(table: K, value: TemporalTables[K]): PhysicalTemporalRow {
  const row: PhysicalTemporalRow = { id: `${table}:${temporalRowId(table, value)}`, scope: value.scope, recordType: table, payload: value };
  if (table === 'occurrences') {
    const source = value as SourceOccurrence;
    row.observedAtEpochMs = getEpochOfDateTimeRFC3339(source.observedAt.at)!; row.knownAtEpochMs = getEpochOfDateTimeRFC3339(source.knownAt)!;
  } else if (table === 'claims') {
    const claim = value as TemporalClaimRow;
    row.versionId = claim.versionId; row.subject = claim.subject; row.series = claim.series; row.knownAtEpochMs = claim.knownAtEpochMs;
    if (claim.validFromEpochMs !== null) row.validFromEpochMs = claim.validFromEpochMs;
    if (claim.validUntilEpochMs !== null) row.validUntilEpochMs = claim.validUntilEpochMs;
  } else if (table === 'projections' || table === 'heads') row.versionId = (value as TemporalProjection | TemporalHead).versionId;
  return row;
}
export function temporalReadDocument(table: TemporalTable, q: TemporalReadQuery): object {
  const where: object[] = [{ $eq: ['$r.scope', { $const: q.scope }] }, { $eq: ['$r.recordType', { $const: table }] }];
  for (const field of ['versionId', 'subject', 'series'] as const) if (q[field] !== undefined) where.push({ $eq: [`$r.${field}`, { $const: q[field] }] });
  if (q.observedFrom !== undefined) where.push({ $ge: ['$r.observedAtEpochMs', q.observedFrom] });
  if (q.observedUntil !== undefined) where.push({ $lt: ['$r.observedAtEpochMs', q.observedUntil] });
  if (q.knownBefore !== undefined) where.push({ $le: ['$r.knownAtEpochMs', q.knownBefore] });
  if (q.validFromBefore !== undefined) where.push({ $le: ['$r.validFromEpochMs', q.validFromBefore] });
  if (q.afterId !== undefined) where.push({ $gt: ['$r.id', { $const: `${table}:${q.afterId}` }] });
  const query = { $for: { r: '$[*]' }, $where: { $and: where }, $orderby: ['$r.id'], $return: '$r.payload' };
  return q.limit === undefined ? query : { $subsequence: [query, 0, q.limit] };
}
export function createTemporalDbPersistence(db: TangleDb, options: TemporalDbOptions = {}): TemporalPersistence {
  return { transaction: <T>(task: (view: TemporalTransaction) => Promise<T>) => db.transaction(async tx => {
    const view: TemporalTransaction = {
      async get<K extends TemporalTable>(table: K, id: string) {
        const row = await tx.collection<PhysicalTemporalRow>(names[table]).get(`${table}:${id}`);
        if (row && row.recordType !== table) throw new Error('temporal persisted row kind differs');
        return row?.payload as TemporalTables[K] | undefined;
      },
      async put<K extends TemporalTable>(table: K, value: TemporalTables[K]) {
        await tx.collection<PhysicalTemporalRow>(names[table]).put(physicalRow(table, value)); options.applyProbe?.(`put:${table}`);
      },
      async query<K extends TemporalTable>(table: K, q: TemporalReadQuery) {
        return asRows(await tx.collection<PhysicalTemporalRow>(names[table]).execute<TemporalTables[K]>(temporalReadDocument(table, q)));
      },
    };
    const result = await task(view); options.applyProbe?.('commit'); return result;
  }, { mode: 'immediate' }) };
}
export function createTemporalDbStore(db: TangleDb, options: TemporalDbOptions = {}): TemporalStore {
  return createTemporalStoreAdapter(createTemporalDbPersistence(db, options));
}
export type TemporalSeek = { kind: 'observed-range'; scope: string; from: number; until: number; limit: number } |
  { kind: 'claim-asof'; scope: string; versionId: string; subject: string; series: string; at: number; limit: number; knownBefore?: number };
/** Candidate seeks are diagnostics/optimizations; membership and conflicts still precede a final answer limit. */
export function temporalSeekDocument(seek: TemporalSeek): object {
  const table: TemporalTable = seek.kind === 'observed-range' ? 'occurrences' : 'claims';
  const where: object[] = [{ $eq: ['$r.scope', { $const: seek.scope }] }, { $eq: ['$r.recordType', { $const: table }] }];
  if (seek.kind === 'observed-range') where.push({ $ge: ['$r.observedAtEpochMs', seek.from] }, { $lt: ['$r.observedAtEpochMs', seek.until] });
  else {
    for (const key of ['versionId', 'subject', 'series'] as const) where.push({ $eq: [`$r.${key}`, { $const: seek[key] }] });
    where.push({ $le: ['$r.validFromEpochMs', seek.at] });
    if (seek.knownBefore !== undefined) where.push({ $le: ['$r.knownAtEpochMs', seek.knownBefore] });
  }
  return { $subsequence: [{ $for: { r: '$[*]' }, $where: { $and: where },
    $orderby: [{ $key: seek.kind === 'observed-range' ? '$r.observedAtEpochMs' : '$r.validFromEpochMs', $dir: seek.kind === 'observed-range' ? 'asc' : 'desc' }], $return: '$r.payload' }, 0, seek.limit] };
}
export async function inspectTemporalSeek(db: TangleDb, seek: TemporalSeek): Promise<TemporalResult<{
  rows: (SourceOccurrence | TemporalClaimRow)[]; explain: unknown; stats: unknown; possiblyTruncated: boolean;
}>> {
  const epochs = seek.kind === 'observed-range' ? [seek.from, seek.until] : [seek.at, ...(seek.knownBefore === undefined ? [] : [seek.knownBefore])];
  if (!seek.scope || !Number.isSafeInteger(seek.limit) || seek.limit < 1 || !epochs.every(Number.isSafeInteger) || seek.kind === 'observed-range' && seek.from >= seek.until) return refuse('invalid-time', 'invalid scoped seek limits or epochs');
  try {
    const collection = db.collection(seek.kind === 'observed-range' ? names.occurrences : names.claims), query = temporalSeekDocument(seek);
    const rows = asRows(await collection.execute<SourceOccurrence | TemporalClaimRow>(query));
    return success({ rows, explain: await collection.explain(query), stats: collection.stats(), possiblyTruncated: rows.length === seek.limit });
  } catch (cause) { return refuse('storage-failure', cause instanceof Error ? cause.message : String(cause)); }
}

/** Bounded native candidates, followed by shared eligibility and conflict rules. */
export async function selectTemporalDbAsOf(db: TangleDb, seek: Extract<TemporalSeek, { kind: 'claim-asof' }>) {
  if (!Number.isSafeInteger(seek.limit) || seek.limit < 1 || seek.limit > 10000) return refuse('incomplete-index', 'candidate limit must be 1..10000');
  const candidates = await inspectTemporalSeek(db, { ...seek, limit: seek.limit + 1 });
  if (candidates.status !== 'success') return candidates;
  if (candidates.value.rows.length > seek.limit) return refuse('incomplete-index', 'as-of candidate bound is incomplete');
  const rows = candidates.value.rows as TemporalClaimRow[];
  const selected = selectTemporalAt(rows.map(r => r.claim), seek.at);
  return selected.status === 'success' ? success({ claims: selected.value, candidates: rows.length,
    refined: rows.length - selected.value.length, explain: candidates.value.explain, stats: candidates.value.stats }) : selected;
}
