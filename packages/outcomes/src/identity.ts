/** Immutable addresses include every semantic field, except the address itself. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { checkRecordShape, checkShape } from './schema.ts';
import { reject } from './errors.ts';
import type { Scope, OutcomeRecord, Json } from './outcomes.contracts.gen.ts';
export const outcomeRevision = canonicalSha256;
export async function scopeIdOf(value: unknown): Promise<string> { return canonicalSha256(checkShape<Scope>('scope', value)); }
export async function recordIdOf(value: Omit<OutcomeRecord, 'id'> | OutcomeRecord): Promise<string> { const { id: _, ...data } = value as OutcomeRecord; return canonicalSha256(data); }
export async function validateRecord(value: unknown): Promise<OutcomeRecord> { const r = checkRecordShape(value); if (await recordIdOf(r) !== r.id)
    reject('OUTC1002', 'Immutable record bytes do not match their id.'); if (r.kind === 'decision' && await scopeIdOf(r.scope) !== r.scopeId)
    reject('OUTC1003', 'Decision scope does not match its id.'); return r; }
export async function sealRecord(value: unknown): Promise<OutcomeRecord> { const data = value as Omit<OutcomeRecord, 'id'>; const id = await canonicalSha256(data); return validateRecord({ ...data, id }); }
export const keyId = (scopeId: string, kind: string, value: Json) => canonicalSha256({ scopeId, kind, value });
