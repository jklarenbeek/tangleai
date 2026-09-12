/** Internal record/index publication shared by every supported store. */
import { equalsJson } from '@jarenjs/core/object';
import type { OutcomeTransaction } from './store.ts';
import type { OutcomeRecord, KeyRow, Head, Operation, Result, Json } from './outcomes.contracts.gen.ts';
import { validateRecord, keyId, sealRecord } from './identity.ts';
import { checkShape } from './schema.ts';
import { reject } from './errors.ts';
import { EMPTY_HEAD } from './transitions.ts';
export async function readRecord(tx: OutcomeTransaction, id: string, scopeId: string, artifactKey?: string): Promise<OutcomeRecord> {
    const raw = await tx.get('records', id);
    if (!raw)
        reject('OUTC1004', 'Referenced outcome record is missing.', '/id');
    checkShape('storedRecord', raw);
    const r = await validateRecord(raw.record);
    if (raw.id !== r.id || raw.scopeId !== r.scopeId || raw.artifactKey !== r.artifactKey || raw.kind !== r.kind)
        reject('OUTC1002', 'Stored envelope identity differs.');
    if (r.scopeId !== scopeId || (artifactKey !== undefined && r.artifactKey !== artifactKey))
        reject('OUTC1003', 'Referenced outcome belongs to another scope or lineage.');
    return r;
}
async function indexRow(tx: OutcomeTransaction, scopeId: string, kind: string, key: Json): Promise<KeyRow | undefined> {
    const id = await keyId(scopeId, kind, key), row = await tx.get('keys', id);
    if (row) {
        checkShape('keyRow', row);
        if (row.id !== id || row.scopeId !== scopeId)
            reject('OUTC1002', 'Index scope or identity is corrupted.');
    }
    return row;
}
export async function sequence(tx: OutcomeTransaction, scopeId: string): Promise<number> {
    const id = await keyId(scopeId, 'sequence', null), old = await indexRow(tx, scopeId, 'sequence', null), previous = old?.value ?? 0;
    if (!Number.isSafeInteger(previous) || Number(previous) < 0 || Number(previous) >= Number.MAX_SAFE_INTEGER)
        reject('OUTC1002', 'Sequence row is corrupted or exhausted.');
    const next = Number(previous) + 1;
    await tx.put('keys', { id, scopeId, value: next });
    return next;
}
export async function putRecord(tx: OutcomeTransaction, value: OutcomeRecord): Promise<number> {
    const r = await validateRecord(value), existing = await tx.get('records', r.id);
    if (existing) {
        if (!equalsJson(existing.record, r))
            reject('OUTC1007', 'Immutable outcome record conflict.');
        return 0;
    }
    await tx.put('records', { id: r.id, scopeId: r.scopeId, artifactKey: r.artifactKey, kind: r.kind, seq: await sequence(tx, r.scopeId), record: r });
    return 1;
}
export async function semantic(tx: OutcomeTransaction, scopeId: string, kind: string, key: Json): Promise<string | undefined> { const row = await indexRow(tx, scopeId, kind, key); if (row && typeof row.value !== 'string')
    reject('OUTC1002', 'Semantic index is corrupted.'); return row?.value as string | undefined; }
export async function unique(tx: OutcomeTransaction, scopeId: string, kind: string, key: Json, value: string): Promise<void> {
    const id = await keyId(scopeId, kind, key), previous = await indexRow(tx, scopeId, kind, key);
    if (previous && previous.value !== value)
        reject('OUTC1007', `The unique ${kind} stage already exists: ${previous.value}.`);
    if (!previous)
        await tx.put('keys', { id, scopeId, value });
}
export async function headFor(tx: OutcomeTransaction, scopeId: string, artifactKey: string): Promise<Head> { const row = await tx.get('heads', await keyId(scopeId, 'head', artifactKey)); if (!row)
    return { ...EMPTY_HEAD }; checkShape('headRow', row); if (row.scopeId !== scopeId || row.artifactKey !== artifactKey)
    reject('OUTC1003', 'Head scope differs.'); return row.head; }
export async function replay(tx: OutcomeTransaction, op: Operation, inputDigest: string): Promise<Result | undefined> {
    checkShape('operation', op);
    if (op.inputDigest !== inputDigest)
        reject('OUTC1007', 'The request key already binds different input.');
    if (op.state === 'completed') {
        if (!op.receiptId)
            reject('OUTC1002', 'Completed operation has no receipt.');
        const r = await readRecord(tx, op.receiptId, op.scopeId, op.artifactKey);
        if (r.kind !== 'operationReceipt' || r.requestId !== op.id || r.inputDigest !== inputDigest)
            reject('OUTC1002', 'Operation receipt binding differs.');
        return r.result.ok ? { ...r.result, replayed: true, writes: 0 } : r.result;
    }
    if (op.state === 'uncertain' || op.state === 'dispatched')
        reject('OUTC1017', 'External completion is uncertain; reconcile before retry.');
    return undefined;
}
export async function complete(tx: OutcomeTransaction, op: Operation, result: Result, at: string): Promise<void> {
    const record = await sealRecord({ schemaVersion: 1, kind: 'operationReceipt', scopeId: op.scopeId, artifactKey: op.artifactKey, recordedAt: at, requestKey: op.requestKey, inputDigest: op.inputDigest, operation: op.operation, result, requestId: op.id });
    await putRecord(tx, record);
    await tx.put('operations', { ...op, state: 'completed', receiptId: record.id, output: null, capacityReserved: false });
}
