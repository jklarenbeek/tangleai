/** Occurrence and claim identity, exact source spans and immutable projection validation. */
import { checkTemporal, refuse, success, temporalIdentity, temporalContractIdentity,
  type TemporalResult, type SourceOccurrence, type TemporalClaim, type SourceSpan, type TemporalProjection, type Knowledge, type TemporalBundle } from './contracts.ts';
export type { TemporalBundle } from './contracts.ts';
import { temporalInstant, temporalStamp, checkClaimTime } from './time.ts';

export async function createSourceOccurrence(input: Omit<SourceOccurrence, 'id' | 'sourceHash'>): Promise<TemporalResult<SourceOccurrence>> {
  try {
    const sourceHash = await temporalIdentity(input.text);
    const id = await temporalIdentity([input.scope, input.sessionOrdinal, input.turnOrdinal, sourceHash]);
    return validateSourceOccurrence({ ...input, sourceHash, id });
  } catch (cause) { return refuse('identity-mismatch', `invalid source input: ${String(cause)}`); }
}
export async function validateSourceOccurrence(value: unknown): Promise<TemporalResult<SourceOccurrence>> {
  const shape = checkTemporal<SourceOccurrence>('sourceOccurrence', value); if (shape.status !== 'success') return shape;
  const source = shape.value;
  const observed = temporalStamp(source.observedAt.at, source.observedAt), known = temporalInstant(source.knownAt);
  if (observed.status !== 'success') return observed; if (known.status !== 'success') return known;
  if (source.sourceHash !== await temporalIdentity(source.text) || source.id !== await temporalIdentity([source.scope, source.sessionOrdinal, source.turnOrdinal, source.sourceHash])) return refuse('identity-mismatch', 'source content or occurrence identity differs');
  return success(source);
}
function isCodePointBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true;
  const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
export function validateSourceSpan(value: unknown, source: SourceOccurrence, scope: string): TemporalResult<SourceSpan> {
  const shape = checkTemporal<SourceSpan>('sourceSpan', value); if (shape.status !== 'success') return shape;
  const span = shape.value;
  if (source.scope !== scope || span.sourceId !== source.id || span.sourceHash !== source.sourceHash || span.start >= span.end || span.end > source.text.length ||
    !isCodePointBoundary(source.text, span.start) || !isCodePointBoundary(source.text, span.end) || source.text.slice(span.start, span.end) !== span.quote) return refuse('identity-mismatch', 'citation must be an exact, scoped, hash-verified UTF-16 source span');
  return shape;
}
export function citeSource(source: SourceOccurrence, start = 0, end = source.text.length): TemporalResult<SourceSpan> {
  return validateSourceSpan({ sourceId: source.id, sourceHash: source.sourceHash, start, end, quote: source.text.slice(start, end) }, source, source.scope);
}
export async function createTemporalClaim(input: Omit<TemporalClaim, 'id'>, sources: readonly SourceOccurrence[]): Promise<TemporalResult<TemporalClaim>> {
  try { return validateTemporalClaim({ ...input, id: await temporalIdentity(input) }, sources); }
  catch (cause) { return refuse('identity-mismatch', `invalid claim input: ${String(cause)}`); }
}
export async function validateTemporalClaim(value: unknown, sources: readonly SourceOccurrence[]): Promise<TemporalResult<TemporalClaim>> {
  const shape = checkTemporal<TemporalClaim>('temporalClaim', value); if (shape.status !== 'success') return shape;
  const claim = shape.value, time = checkClaimTime(claim.time); if (time.status !== 'success') return time;
  if (claim.time.kind === 'unknown' && claim.status === 'accepted') return refuse('unknown-validity', 'unknown claim time cannot be accepted as exact');
  const { id, ...content } = claim;
  if (id !== await temporalIdentity(content)) return refuse('identity-mismatch', 'claim identity differs from its content');
  for (const span of claim.citations) {
    const source = sources.find(s => s.id === span.sourceId && s.scope === claim.scope);
    if (!source) return refuse('identity-mismatch', 'citation source is absent from the claim scope');
    const checked = validateSourceSpan(span, source, claim.scope); if (checked.status !== 'success') return checked;
  }
  return success(claim);
}
export function validateKnowledge(value: unknown): TemporalResult<Knowledge> {
  const shape = checkTemporal<Knowledge>('knowledge', value); if (shape.status !== 'success') return shape;
  if (shape.value.mode === 'strict-as-of') {
    const time = temporalInstant(shape.value.cutoff); if (time.status !== 'success') return time;
  }
  return shape;
}
export interface TemporalProjectionInput extends Omit<TemporalProjection, 'versionId' | 'contractIdentity' | 'occurrenceIds' | 'claimIds'> {
  sources: SourceOccurrence[]; claims: TemporalClaim[];
}
export async function createTemporalProjection(input: TemporalProjectionInput): Promise<TemporalResult<TemporalBundle>> {
  try {
    const { sources, claims, ...identity } = input;
    const content = { ...identity, contractIdentity: await temporalContractIdentity(),
      occurrenceIds: sources.map(s => s.id).sort(), claimIds: claims.map(c => c.id).sort(),
      embeddings: [...input.embeddings].sort((a, b) => a.sourceId.localeCompare(b.sourceId)) };
    const bundle = { projection: { ...content, versionId: await temporalIdentity(content) }, sources, claims };
    return validateTemporalBundle(bundle);
  } catch (cause) { return refuse('identity-mismatch', `invalid projection input: ${String(cause)}`); }
}
export async function validateTemporalBundle(bundle: TemporalBundle): Promise<TemporalResult<TemporalBundle>> {
  if (!bundle || !Array.isArray(bundle.sources) || !Array.isArray(bundle.claims)) return refuse('identity-mismatch', 'projection bundle needs explicit source and claim arrays');
  const shape = checkTemporal<TemporalProjection>('temporalProjection', bundle.projection); if (shape.status !== 'success') return shape;
  const p = shape.value, knowledge = validateKnowledge(p.knowledge); if (knowledge.status !== 'success') return knowledge;
  const { versionId, ...content } = p;
  if (versionId !== await temporalIdentity(content) || p.contractIdentity !== await temporalContractIdentity()) return refuse('identity-mismatch', 'projection version or contract identity differs');
  const sources: SourceOccurrence[] = [], claims: TemporalClaim[] = [];
  for (const source of bundle.sources) {
    const checked = await validateSourceOccurrence(source); if (checked.status !== 'success') return checked;
    if (source.scope !== p.scope) return refuse('identity-mismatch', 'projection contains a foreign source');
    if (p.knowledge.mode === 'strict-as-of') {
      const cutoff = temporalInstant(p.knowledge.cutoff), known = temporalInstant(source.knownAt);
      if (cutoff.status !== 'success') return cutoff; if (known.status !== 'success') return known;
      if (known.value > cutoff.value) return refuse('future-source', 'strict source view contains knowledge after its cutoff');
    }
    sources.push(checked.value);
  }
  for (const claim of bundle.claims) {
    const checked = await validateTemporalClaim(claim, sources); if (checked.status !== 'success') return checked;
    if (claim.scope !== p.scope) return refuse('identity-mismatch', 'projection contains a foreign claim');
    claims.push(checked.value);
  }
  const sourceIds = sources.map(s => s.id).sort(), claimIds = claims.map(c => c.id).sort();
  if (new Set(sourceIds).size !== sourceIds.length || new Set(claimIds).size !== claimIds.length ||
    JSON.stringify(sourceIds) !== JSON.stringify([...p.occurrenceIds].sort()) || JSON.stringify(claimIds) !== JSON.stringify([...p.claimIds].sort())) return refuse('incomplete-index', 'projection references do not exactly cover supplied records');
  const embeddingIds = new Set<string>();
  for (const entry of p.embeddings) {
    if (!sourceIds.includes(entry.sourceId) || embeddingIds.has(entry.sourceId) || entry.vector.length !== p.embeddedBy.dims || !entry.vector.every(Number.isFinite)) return refuse('identity-mismatch', 'projection embedding references, identity or dimensions differ');
    embeddingIds.add(entry.sourceId);
  }
  // Completeness names source/claim preparation. Missing vectors remain explicit retrieval coverage, never fabricated embeddings.
  return success({ projection: p, sources: sources.sort((a, b) => a.id.localeCompare(b.id)), claims: claims.sort((a, b) => a.id.localeCompare(b.id)) });
}
