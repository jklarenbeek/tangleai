/** Eligibility precedes winner selection. Input must be a complete, scoped candidate set. */
import { claimContains, temporalInstant } from './time.ts';
import { success, refuse, type TemporalClaim, type TemporalResult } from './contracts.ts';
export function selectTemporalAt(claims: readonly TemporalClaim[], at: string | number): TemporalResult<TemporalClaim[]> {
  if (typeof at === 'number' && (!Number.isSafeInteger(at) || Math.abs(at) > 8640000000000000)) return refuse('invalid-time', 'invalid epoch');
  const instant = temporalInstant(typeof at === 'number' && Number.isSafeInteger(at) ? new Date(at).toISOString() : at);
  if (instant.status !== 'success') return instant;
  const eligible: TemporalClaim[] = [];
  for (const claim of claims) {
    const contains = claimContains(claim.time, instant.value);
    if (contains.status !== 'success') return contains;
    if (!contains.value) continue;
    if (claim.status === 'conflicting') return refuse('conflicting-claims', 'candidate was marked conflicting');
    if (claim.status !== 'accepted') return refuse('unknown-validity', 'candidate is not accepted');
    eligible.push(claim);
  }
  const values = new Map<string, string>();
  for (const claim of eligible) {
    const key = JSON.stringify(claim.series), prior = values.get(key);
    if (prior !== undefined && prior !== claim.value) return refuse('conflicting-claims', 'incompatible claims overlap in one series');
    values.set(key, claim.value);
  }
  return eligible.length ? success(eligible.sort((a, b) => a.id.localeCompare(b.id))) : refuse('no-match', 'no eligible claim contains the instant');
}
