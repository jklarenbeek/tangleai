/** Content failures are values; the core schema owns the refusal vocabulary. */
import { canonicalizeJson, canonicalSha256 } from '@jarenjs/json/canonical';
import { cloneJson } from '@jarenjs/core/object';
import { validatePlaceShape, placeReasons, type PlaceSchemaName, type PlaceCode, type PlaceRefusal } from '@tangleai/core/schemas/place';
import type { Refusal as TemporalRefusal } from '@tangleai/core/schemas/temporal';
export type * from '@tangleai/core/schemas/place';

export type PlaceResult<T> = { status: 'success'; value: T } | PlaceRefusal;
export function placeSuccess<T>(value: T): PlaceResult<T> { return { status: 'success', value }; }
export function placeRefuse(code: PlaceCode, detail: string, cause?: string): PlaceRefusal {
  return { status: 'refused', code, reason: placeReasons[code], detail: detail || placeReasons[code], ...(cause ? { cause } : {}) } as PlaceRefusal;
}
export function checkPlace<T>(name: PlaceSchemaName, value: unknown): PlaceResult<T> {
  try {
    canonicalizeJson(value);
    const result = validatePlaceShape(name, value);
    if (!result.valid) return placeRefuse('TPLC1001', `invalid ${name}: ${JSON.stringify(result.errors?.[0] ?? null)}`);
    return placeSuccess(cloneJson(value) as T);
  } catch (cause) { return placeRefuse('TPLC1001', `non-JSON ${name}: ${cause instanceof Error ? cause.message : String(cause)}`); }
}
export const placeIdentity = canonicalSha256;
export function fromTemporal(refusal: Pick<TemporalRefusal, 'reason' | 'detail'>): PlaceRefusal {
  return placeRefuse('TPLC1009', refusal.detail, refusal.reason);
}
