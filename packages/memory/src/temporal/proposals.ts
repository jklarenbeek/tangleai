/** Model output becomes evidence only after exact source coverage and semantic checks. */
import { checkTemporal, success, refuse, type ExtractionProposal, type TemporalClaim, type SourceOccurrence, type TemporalResult } from './contracts.ts';
import { createTemporalClaim } from './evidence.ts';
import { resolveTemporalWindow } from './resolve.ts';
export async function validateTemporalExtraction(value: unknown, sources: readonly SourceOccurrence[], scope: string, derivationIdentity: string, maxClaims: number): Promise<TemporalResult<TemporalClaim[]>> {
  const checked = checkTemporal<ExtractionProposal>('extractionProposal', value); if (checked.status !== 'success') return checked;
  const p = checked.value;
  if (JSON.stringify([...p.coveredSourceIds].sort()) !== JSON.stringify(sources.map(s => s.id).sort())) return refuse('incomplete-index', 'extractor coverage differs from permitted source occurrences');
  if (p.claims.length > maxClaims) return refuse('budget-exhausted', 'claim coverage exceeds the declared limit');
  const claims: TemporalClaim[] = [];
  for (const proposal of p.claims) {
    let time = proposal.time;
    if (time.kind === 'relative') {
      const sourceId = time.sourceId;
      const source = sources.find(s => s.id === sourceId);
      if (!source || !proposal.citations.some(c => c.sourceId === source.id)) return refuse('identity-mismatch', 'relative time anchor must be a cited source');
      const resolved = resolveTemporalWindow(time.operand, source.observedAt); if (resolved.status !== 'success') return resolved;
      if (time.operand === 'previous-week') return refuse('unknown-validity', 'a week-wide event cannot be promoted to a one-day precision claim');
      time = { kind: 'period', ...resolved.value };
    }
    const claim = await createTemporalClaim({ ...proposal, scope, time, derivation: { method: 'model', identity: derivationIdentity } }, sources);
    if (claim.status !== 'success') return claim;
    claims.push(claim.value);
  }
  return success(claims);
}
