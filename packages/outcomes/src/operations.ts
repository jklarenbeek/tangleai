/** Request identity, capacity reservations and terminal replay belong to one owner. */
import type { OutcomeStore, OutcomeTransaction } from './store.ts';
import { persistenceFor } from './store.ts';
import type { Json, Operation, Result, Policy } from './outcomes.contracts.gen.ts';
import { keyId, outcomeRevision, sealRecord } from './identity.ts';
import { replay, complete, putRecord, unique } from './persistence.ts';
import { assertCapacity } from './transitions.ts';
import { checkTime } from './schema.ts';
import { reject, OutcomeRefusal, refuse } from './errors.ts';
export interface OperationCommand {
    scopeId: string;
    artifactKey: string;
    requestKey: string;
    at: string;
    input: unknown;
}
export async function beginOperation(store: OutcomeStore, name: string, command: OperationCommand, policy?: Policy): Promise<{
    operation: Operation;
    replay?: Result;
}> {
    checkTime(command.at);
    const id = await keyId(command.scopeId, 'request', command.requestKey), inputDigest = await outcomeRevision({ name, command });
    let created: Operation | undefined;
    try {
        return await persistenceFor(store).transaction(async (tx) => {
            const old = await tx.get('operations', id);
            if (old) {
                const result = await replay(tx, old, inputDigest);
                if (result)
                    return { operation: old, replay: result };
                if (old.state === 'reserved')
                    reject('OUTC1019', 'The operation is already in progress.');
                if (old.state === 'ready')
                    return { operation: old };
            }
            if (policy && !(old?.capacityReserved)) {
                const versions = await tx.query('records', { scopeId: command.scopeId, artifactKey: command.artifactKey, kind: 'artifactVersion', limit: policy.maxVersions + 1 });
                const reservations = await tx.query('operations', { scopeId: command.scopeId, artifactKey: command.artifactKey, reservedOnly: true, limit: policy.maxVersions + 1 });
                assertCapacity(versions.length, reservations.length, policy.maxVersions);
            }
            const operation: Operation = { id, scopeId: command.scopeId, artifactKey: command.artifactKey, requestKey: command.requestKey, operation: name, inputDigest, state: old?.output !== null && old?.output !== undefined ? 'ready' : 'reserved', receiptId: null, output: old?.output ?? null, capacityReserved: policy !== undefined, attempt: (old?.attempt ?? 0) + 1, preparationWrites: (old?.preparationWrites ?? 0) + 4 };
            created = operation;
            const reservationId = await recordAttempt(tx, operation, 'reserved', command.at, { operation: name, requestKey: command.requestKey });
            await unique(tx, command.scopeId, 'reservationReceipt', [operation.id, operation.attempt], reservationId);
            await tx.put('operations', operation);
            return { operation };
        });
    }
    catch (error) {
        if (error instanceof OutcomeRefusal)
            throw error;
        if (created)
            return { operation: created, replay: await recoverOperation(store, created, command.at, true) };
        throw error;
    }
}
export async function recordAttempt(tx: OutcomeTransaction, op: Operation, stage: 'reserved' | 'dispatched' | 'ready' | 'retryable' | 'uncertain' | 'refused' | 'completed' | 'reconciled', at: string, details: Json): Promise<string> {
    const record = await sealRecord({ schemaVersion: 1, kind: 'attemptEvent', scopeId: op.scopeId, artifactKey: op.artifactKey, recordedAt: at, requestId: op.id, stage, inputDigest: op.inputDigest, details: { attempt: op.attempt, value: details } });
    await putRecord(tx, record);
    return record.id;
}
async function recoverOperation(store: OutcomeStore, op: Operation, at: string, allowAbsent = false): Promise<Result> {
    try {
        return await persistenceFor(store).transaction(async (tx) => {
            const current = await tx.get('operations', op.id);
            if (!current)
                return allowAbsent ? refuse('OUTC1015', 'The reservation rolled back; retry the same request.', '', true) : refuse('OUTC1002', 'Operation reservation disappeared.');
            if (current.state === 'completed')
                return (await replay(tx, current, op.inputDigest))!;
            if (current.attempt !== op.attempt)
                return refuse('OUTC1019', 'A different attempt owns this operation.');
            const state = current.state === 'dispatched' || current.state === 'uncertain' ? 'uncertain' : 'retryable';
            await recordAttempt(tx, current, state, at, { code: state === 'uncertain' ? 'OUTC1017' : 'OUTC1015' });
            await tx.put('operations', { ...current, state, preparationWrites: current.preparationWrites + 3 });
            return state === 'uncertain' ? refuse('OUTC1017', 'External completion is uncertain; reconcile before retry.') : refuse('OUTC1015', 'The transaction rolled back; retry the same request.', '', true);
        });
    }
    catch {
        return refuse('OUTC1017', 'Commit acknowledgement and recovery are unavailable.');
    }
}
export async function finishOperation(store: OutcomeStore, op: Operation, at: string, apply: (tx: OutcomeTransaction) => Promise<Json>): Promise<Result> {
    try {
        return await persistenceFor(store).transaction(async (raw) => {
            const current = await raw.get('operations', op.id);
            if (!current)
                reject('OUTC1002', 'Operation reservation disappeared.');
            const old = await replay(raw, current, op.inputDigest);
            if (old)
                return old;
            if (current.attempt !== op.attempt)
                reject('OUTC1019', 'A different attempt owns this operation.');
            let writes = 0;
            const tx: OutcomeTransaction = { ...raw, async put(table, value) { await raw.put(table, value); writes++; }, async delete(table, id) { await raw.delete(table, id); writes++; } };
            const value = await apply(tx);
            const result: Result = { ok: true, value, replayed: false, writes: writes + current.preparationWrites + 3 };
            await complete(tx, current, result, at);
            return result;
        });
    }
    catch (error) {
        if (error instanceof OutcomeRefusal && !error.issues.some(i => i.retryable || i.code === 'OUTC1017')) {
            const result: Result = { ok: false, issues: error.issues };
            try {
                return await persistenceFor(store).transaction(async (tx) => {
                    const current = await tx.get('operations', op.id);
                    if (!current || current.attempt !== op.attempt)
                        return refuse('OUTC1019', 'A different attempt owns this operation.');
                    if (current.state === 'completed')
                        return (await replay(tx, current, op.inputDigest))!;
                    await complete(tx, current, result, at);
                    return result;
                });
            }
            catch {
                return recoverOperation(store, op, at);
            }
        }
        return recoverOperation(store, op, at);
    }
}
