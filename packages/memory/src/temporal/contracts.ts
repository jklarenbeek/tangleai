/** Content failures are typed values; structural contracts are generated in core. */
import { canonicalizeJson, canonicalSha256 } from '@jarenjs/json/canonical';
import { cloneJson } from '@jarenjs/core/object';
import { temporalSchema, validateTemporalShape, type TemporalSchemaName, type Refusal, type Reason } from '@tangleai/core/schemas/temporal';
export type * from '@tangleai/core/schemas/temporal';
export type TemporalResult<T> = { status: 'success'; value: T } | Refusal;
export function success<T>(value: T): TemporalResult<T> { return { status: 'success', value }; }
export function refuse(reason: Reason, detail: string): Refusal { return { status: 'refused', reason, detail }; }
export function checkTemporal<T>(name: TemporalSchemaName, value: unknown): TemporalResult<T> {
  try {
    canonicalizeJson(value);
    const result = validateTemporalShape(name, value);
    if (!result.valid) return refuse('identity-mismatch', `invalid ${name}: ${JSON.stringify(result.errors?.[0] ?? null)}`);
    return success(cloneJson(value) as T);
  } catch (cause) { return refuse('identity-mismatch', `non-JSON ${name}: ${cause instanceof Error ? cause.message : String(cause)}`); }
}
/** Hashes use SHA-256 over RFC 8785 JSON, including source strings. */
export const temporalIdentity = canonicalSha256;
export function temporalContractIdentity(): Promise<string> { return temporalIdentity(temporalSchema); }
export function sameTemporalValue(a: unknown, b: unknown): boolean { return canonicalizeJson(a) === canonicalizeJson(b); }
