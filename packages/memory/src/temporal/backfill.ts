/** Explicit legacy projection. Surviving text records cannot recover lost occurrence history. */
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { createSourceOccurrence, citeSource, createTemporalClaim, createTemporalProjection } from './evidence.ts';
import { temporalStamp } from './time.ts';
import { success, refuse, temporalIdentity, type TemporalResult, type TemporalBundle, type EmbeddedBy, type SourceOccurrence, type TemporalClaim, type ProjectionEmbedding } from './contracts.ts';

export async function legacyTemporalProjection(units: readonly MemoryUnit[], options: { scope: string; subject: string; embeddedBy: EmbeddedBy }): Promise<TemporalResult<{
  bundle: TemporalBundle; legacyRecords: number; unknownValidity: number; unrecoverableHistory: true;
}>> {
  const sorted = [...units].sort((a, b) => a.id.localeCompare(b.id));
  const sources: SourceOccurrence[] = [], claims: TemporalClaim[] = [], embeddings: ProjectionEmbedding[] = [];
  for (const [sessionOrdinal, unit] of sorted.entries()) {
    const stamp = temporalStamp(unit.at); if (stamp.status !== 'success') return stamp;
    const source = await createSourceOccurrence({ scope: options.scope, sessionOrdinal, turnOrdinal: 0, role: 'host', text: unit.text,
      sourceLocator: unit.evidence, observedAt: stamp.value, knownAt: unit.at, legacyMemoryId: unit.id });
    if (source.status !== 'success') return source;
    sources.push(source.value);
    const citation = citeSource(source.value); if (citation.status !== 'success') return citation;
    const claim = await createTemporalClaim({ scope: options.scope, series: { subject: options.subject, key: 'legacy' }, value: unit.text,
      time: { kind: 'unknown' }, status: 'unknown', citations: [citation.value], derivation: { method: 'legacy-backfill', identity: 'observed-only-v1' } }, [source.value]);
    if (claim.status !== 'success') return claim;
    claims.push(claim.value);
    if (unit.embedding && unit.embeddedBy) {
      if (unit.embeddedBy.model !== options.embeddedBy.model || unit.embeddedBy.dims !== options.embeddedBy.dims) return refuse('identity-mismatch', 'legacy embedding identity differs; re-embedding must be explicit');
      embeddings.push({ sourceId: source.value.id, vector: [...unit.embedding] });
    }
  }
  const identity = await temporalIdentity({ units: sorted, scope: options.scope, subject: options.subject, embeddedBy: options.embeddedBy });
  const projection = await createTemporalProjection({ scope: options.scope, sources, claims, sourceIdentity: identity, viewIdentity: identity,
    policyIdentity: 'legacy-observed-only-v1', modelIdentity: 'host-asserted', promptIdentity: 'none', embeddedBy: options.embeddedBy,
    knowledge: { mode: 'provided-history' }, embeddings, complete: true });
  return projection.status === 'success' ? success({ bundle: projection.value, legacyRecords: units.length, unknownValidity: claims.length, unrecoverableHistory: true }) : projection;
}
