/** The forward-only replay admission rule; capture timestamps never prove publication. */
import { checkTime } from './schema.ts';
import { failure, type ForecastCommandResult } from './errors.ts';
import { sha256Hex } from '@jarenjs/core/string';

export type ForecastAdmission = { admitted: true; reason: null } | { admitted: false; reason: 'post-cutoff' | 'undated'; code: 'TFCT1006' };
export function admitEvidence(item: { availableAt: string | null }, cutoffAt: string): ForecastCommandResult<ForecastAdmission> {
  try {
    checkTime(cutoffAt);
    if (item.availableAt === null) return { ok: true, value: { admitted: false, reason: 'undated', code: 'TFCT1006' }, writes: 0 };
    checkTime(item.availableAt);
    return { ok: true, value: item.availableAt <= cutoffAt ? { admitted: true, reason: null } : { admitted: false, reason: 'post-cutoff', code: 'TFCT1006' }, writes: 0 };
  } catch (error) { return failure(error); }
}
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}
