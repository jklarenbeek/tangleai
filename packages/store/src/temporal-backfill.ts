/** Explicit resumable backfill; batches stage immutable data, only final activation changes the head. */
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { legacyTemporalProjection, temporalProjectionRecords, temporalIdentity, temporalRowId, sameTemporalValue, refuse, success,
  type TemporalResult, type TemporalHead, type ProjectionReceipt, type EmbeddedBy, type TemporalOperation } from '@tangleai/memory/temporal';
import { createTemporalDbPersistence, createTemporalDbStore, type TemporalDbOptions } from './temporal-store.ts';
import type { TangleDb } from './db.ts';

export interface TemporalBackfillOptions extends TemporalDbOptions {
  scope: string; subject: string; key: string; embeddedBy: EmbeddedBy; expectedHead: TemporalHead | null;
  batchSize: number; signal?: AbortSignal;
}
export async function backfillTemporalBatch(db: TangleDb, units: readonly MemoryUnit[], options: TemporalBackfillOptions): Promise<TemporalResult<{
  complete: boolean; cursor: number; total: number; stagedWrites: number; receipt: ProjectionReceipt | null;
  legacyRecords: number; unknownValidity: number; unrecoverableHistory: true;
}>> {
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 10000) return refuse('budget-exhausted', 'backfill batchSize must be 1..10000');
  const legacy = await legacyTemporalProjection(units, options); if (legacy.status !== 'success') return legacy;
  const projected = await temporalProjectionRecords(legacy.value.bundle); if (projected.status !== 'success') return projected;
  const { bundle, records } = projected.value, total = records.length;
  const requestIdentity = await temporalIdentity({ migration: 'legacy-observed-only-v1', bundle, expectedHead: options.expectedHead, batchSize: options.batchSize });
  const persistence = createTemporalDbPersistence(db, options), store = createTemporalDbStore(db, options);
  const reservation = await store.reserveOperation({ scope: options.scope, key: options.key, requestIdentity, maxPhysicalRequests: 0 });
  if (reservation.status !== 'success') return reservation;
  let operation = reservation.value.operation;
  const base = { legacyRecords: legacy.value.legacyRecords, unknownValidity: legacy.value.unknownValidity, unrecoverableHistory: true as const };
  if (operation.phase === 'completed') {
    const replay = await store.apply(bundle, { key: options.key, expectedHead: options.expectedHead, operation: { requestIdentity, revision: operation.revision } });
    return replay.status === 'success' ? success({ ...base, complete: true, cursor: total, total, stagedWrites: 0, receipt: replay.value }) : replay;
  }
  if (operation.phase !== 'reserved' && operation.phase !== 'in-flight') return refuse('provider-refusal', 'backfill operation is terminal');
  const cursorValue = operation.receipt && typeof operation.receipt === 'object' && !Array.isArray(operation.receipt) ? operation.receipt.cursor : 0;
  if (typeof cursorValue !== 'number' || !Number.isSafeInteger(cursorValue) || cursorValue < 0 || cursorValue > total) return refuse('identity-mismatch', 'backfill cursor is invalid');
  const end = Math.min(total, cursorValue + options.batchSize);
  try {
    let stagedWrites = 0;
    const staged = await persistence.transaction(async tx => {
      options.signal?.throwIfAborted();
      const fresh = await tx.get('operations', operation.id);
      if (!fresh || fresh.revision !== operation.revision) return refuse('stale-projection', 'backfill cursor changed concurrently');
      const head = await tx.get('heads', options.scope) ?? null;
      if (!sameTemporalValue(head, options.expectedHead)) return refuse('stale-projection', 'active head changed during backfill');
      const missing = [];
      for (const record of records.slice(cursorValue, end)) {
        const existing = await tx.get(record.table, temporalRowId(record.table, record.value));
        if (existing && !sameTemporalValue(existing, record.value)) return refuse('identity-mismatch', 'staged immutable backfill record differs');
        if (!existing) missing.push(record);
      }
      for (const record of missing) { await tx.put(record.table, record.value); stagedWrites++; }
      options.signal?.throwIfAborted();
      const next: TemporalOperation = { ...fresh, phase: 'in-flight', revision: fresh.revision + 1,
        receipt: { cursor: end, total, migration: 'legacy-observed-only-v1' } };
      await tx.put('operations', next); stagedWrites++;
      return success(next);
    });
    if (staged.status !== 'success') return staged;
    operation = staged.value;
    if (end < total) return success({ ...base, complete: false, cursor: end, total, stagedWrites, receipt: null });
    const activated = await store.apply(bundle, { key: options.key, expectedHead: options.expectedHead, operation: { requestIdentity, revision: operation.revision }, signal: options.signal });
    return activated.status === 'success' ? success({ ...base, complete: true, cursor: end, total, stagedWrites, receipt: activated.value }) : activated;
  } catch (cause) { return refuse('storage-failure', cause instanceof Error ? cause.message : String(cause)); }
}
