/** Meaning first, then temporal eligibility. No model call or implicit ordinary-path mutation. */
import { cosineSimilarity } from '@jarenjs/core/vector';
import { checkTemporal, sameTemporalValue, refuse, success, type TemporalQuery, type TemporalRecall, type TemporalClaim, type TemporalResult, type Coverage, type Refusal } from './contracts.ts';
import { temporalInstant, temporalStamp, claimOverlaps, claimContains } from './time.ts';
import { selectTemporalAt } from './selection.ts';
import type { TemporalStore } from './store.ts';
import { validateKnowledge } from './evidence.ts';
import { recallByEmbedding, type RankOptions } from '../retrieval.ts';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
export function temporalClaimsConflict(claims: readonly TemporalClaim[]): boolean {
  for (let i = 0; i < claims.length; i++) for (let j = i + 1; j < claims.length; j++) {
    const a = claims[i], b = claims[j];
    if (!sameTemporalValue(a.series, b.series) || a.value === b.value) continue;
    if (a.status === 'conflicting' || b.status === 'conflicting') return true;
    const x = a.time, y = b.time;
    if (x.kind === 'point' && y.kind === 'point') {
      const left = temporalInstant(x.at), right = temporalInstant(y.at);
      if (left.status === 'success' && right.status === 'success' && left.value === right.value) return true;
    } else if (x.kind === 'state' && y.kind === 'state') {
      const left = temporalInstant(x.from), right = temporalInstant(y.from);
      if (left.status !== 'success' || right.status !== 'success') return true;
      const at = Math.max(left.value, right.value), l = claimContains(x, at), r = claimContains(y, at);
      if (l.status === 'success' && r.status === 'success' && l.value && r.value) return true;
    }
  }
  return false;
}
export async function recallTemporal(store: TemporalStore, input: TemporalQuery): Promise<TemporalResult<TemporalRecall>> {
  const coverage: Coverage = { occurrences: 0, comparable: 0, semanticCandidates: 0, eligibleClaims: 0, selected: 0, poolTruncated: false, complete: false, refusals: {} };
  const fail = (failure: Refusal): Refusal => ({ ...failure, coverage: { ...coverage, refusals: { [failure.reason]: 1 } } });
  const checked = checkTemporal<TemporalQuery>('temporalQuery', input); if (checked.status !== 'success') return fail(checked);
  const query = checked.value, operation = query.operation;
  if (operation.kind === 'none') return fail({ status: 'fallback', reason: 'ordinary-query', detail: 'ordinary query explicitly bypasses the temporal lane' });
  const knowledge = validateKnowledge(query.knowledge); if (knowledge.status !== 'success') return fail(knowledge);
  const times = operation.kind === 'at' || operation.kind === 'as-of' ? [operation.at] : operation.kind === 'overlaps' ? [operation.from, operation.until] : [];
  const epochs: number[] = [];
  for (const time of times) { const instant = temporalInstant(time); if (instant.status !== 'success') return fail(instant); epochs.push(instant.value); }
  if (operation.kind === 'overlaps' && epochs[0] >= epochs[1]) return fail(refuse('invalid-time', 'query overlap must be increasing and half-open'));
  if (query.k > query.candidatePool) return fail(refuse('budget-exhausted', 'final k cannot exceed the semantic candidate pool'));
  if (query.anchor) { const stamp = temporalStamp(query.anchor.at, query.anchor); if (stamp.status !== 'success') return fail(stamp); }
  const snapshot = await store.snapshot(query.scope, query.expectedHead ?? undefined); if (snapshot.status !== 'success') return fail(snapshot);
  const { projection, sources, claims, head } = snapshot.value;
  coverage.occurrences = sources.length;
  if (!sameTemporalValue(projection.knowledge, query.knowledge)) return fail(refuse('identity-mismatch', 'knowledge view differs; prepare an independent projection for this cutoff/profile'));
  if (!sameTemporalValue(projection.embeddedBy, query.embeddedBy) || query.embedding.length !== projection.embeddedBy.dims) return fail(refuse('identity-mismatch', 'query embedding identity or dimensions differ'));
  if (operation.kind === 'elapsed' && query.subject !== null && (operation.fromSeries.subject !== query.subject || operation.toSeries.subject !== query.subject)) return fail(refuse('identity-mismatch', 'elapsed operand subjects contradict the query constraint'));
  const relevant = claims.filter(c => (query.subject === null || c.series.subject === query.subject) && (query.series === null || c.series.key === query.series) &&
    (operation.kind !== 'elapsed' || sameTemporalValue(c.series, operation.fromSeries) || sameTemporalValue(c.series, operation.toSeries)));
  const sourceIds = new Set(relevant.flatMap(c => c.citations.map(s => s.sourceId)));
  const vectors = new Map(projection.embeddings.map(e => [e.sourceId, e.vector]));
  coverage.comparable = sources.filter(s => vectors.has(s.id)).length;
  const ranked = sources.filter(s => vectors.has(s.id)).map(source => ({ source, score: cosineSimilarity(vectors.get(source.id)!, query.embedding) }))
    .filter(row => row.score >= query.minScore).sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id));
  const pool = ranked.slice(0, query.candidatePool), poolIds = new Set(pool.map(r => r.source.id));
  coverage.semanticCandidates = pool.length; coverage.poolTruncated = ranked.length > pool.length;
  const missingVectors = [...sourceIds].some(id => !vectors.has(id));
  const candidates = relevant.filter(c => c.citations.every(s => poolIds.has(s.sourceId)));
  if (operation.kind !== 'elapsed' && query.subject === null && new Set(candidates.map(c => c.series.subject)).size > 1) return fail(refuse('ambiguous-series', 'semantic candidates contain multiple subjects; supply a qualified subject'));
  let eligible: TemporalClaim[] = [];
  if (operation.kind === 'at' || operation.kind === 'as-of') {
    const selected = selectTemporalAt(candidates, operation.at);
    if (selected.status !== 'success') return fail(selected.reason === 'no-match' && (missingVectors || coverage.poolTruncated) ? refuse('incomplete-index', 'bounded or unembedded candidates cannot prove no-match') : selected);
    eligible = selected.value;
  } else {
    for (const claim of candidates) {
      if (claim.status === 'conflicting') return fail(refuse('conflicting-claims', 'candidate is marked conflicting'));
      if (claim.status !== 'accepted' || claim.time.kind === 'unknown') return fail(refuse('unknown-validity', 'candidate has unknown temporal semantics'));
      if (operation.kind === 'overlaps') {
        const from = temporalInstant(operation.from), until = temporalInstant(operation.until);
        if (from.status !== 'success') return fail(from); if (until.status !== 'success') return fail(until);
        const result = claimOverlaps(claim.time, from.value, until.value); if (result.status !== 'success') return fail(result);
        if (!result.value) continue;
      }
      eligible.push(claim);
    }
    if (temporalClaimsConflict(eligible)) return fail(refuse('conflicting-claims', 'incompatible claims overlap within one qualified series'));
  }
  coverage.eligibleClaims = eligible.length;
  if (!eligible.length) return fail(refuse(missingVectors || coverage.poolTruncated ? 'incomplete-index' : 'no-match', 'no eligible evidence in the declared candidate coverage'));
  // Preserve all evidence for compatible duplicates; never discard a conflict or operand merely to fit final k.
  const eligibleSourceIds = new Set(eligible.flatMap(c => c.citations.map(s => s.sourceId)));
  if (eligibleSourceIds.size > query.k) return fail(refuse('incomplete-index', 'eligible evidence exceeds final k; narrowing needs an explicit query constraint'));
  eligible.sort((a, b) => a.id.localeCompare(b.id));
  const selectedSources = sources.filter(s => eligibleSourceIds.has(s.id)).sort((a, b) => a.id.localeCompare(b.id));
  coverage.selected = selectedSources.length; coverage.complete = !missingVectors && !coverage.poolTruncated;
  return success({ head, claims: eligible, sources: selectedSources, claimIds: eligible.map(c => c.id), sourceIds: selectedSources.map(s => s.id), coverage });
}
/** Explicit ordinary fallback is separate data and retains the original temporal failure. */
export async function recallTemporalWithFallback(store: TemporalStore, query: TemporalQuery, ordinary: { units: MemoryUnit[]; options?: RankOptions }) {
  const temporal = await recallTemporal(store, query);
  return temporal.status === 'success' ? { temporal, ordinary: null } : { temporal, ordinary: recallByEmbedding(ordinary.units, query.embedding, { ...ordinary.options, identity: query.embeddedBy }) };
}
