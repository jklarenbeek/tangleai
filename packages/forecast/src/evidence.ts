/** The forward-only replay admission rule; capture timestamps never prove publication. */
import { checkTime } from './schema.ts';
import { failure, type ForecastCommandResult } from './errors.ts';

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
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
