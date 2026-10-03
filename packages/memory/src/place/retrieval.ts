/** Semantic source budgets constrain every cited operand of a place answer. */
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { sameTemporalValue, type TemporalClaim, type SourceOccurrence, type TemporalHead } from '../temporal/contracts.ts';
import { validateKnowledge } from '../temporal/evidence.ts';
import { temporalInstant } from '../temporal/time.ts';
import { temporalSourcePool } from '../temporal/source-pool.ts';
import type { TemporalStore } from '../temporal/store.ts';
import { recallByEmbedding, type RankOptions } from '../retrieval.ts';
import { checkPlace, fromTemporal, placeRefuse, placeSuccess, type PlaceResult, type PlaceQuery,
  type PlaceAnswer, type PlaceCoverage, type PlaceRefusal } from './contracts.ts';
import type { GazetteerView } from './gazetteer.ts';
import { capturePlaceSnapshot, readPositionSeries } from './series.ts';
import { locationAtInstant, locationAtEvent, movementDistance } from './join.ts';
import { nearbyEntries, type NearbyOptions } from './nearby.ts';

export interface PlaceStores {
  temporal: TemporalStore; gazetteer: GazetteerView;
  entriesInCells?: NearbyOptions['entriesInCells'];
}
export interface PlaceRecall {
  head: TemporalHead; answer: PlaceAnswer; claims: TemporalClaim[]; sources: SourceOccurrence[];
  coverage: PlaceCoverage; refusals: Record<string, number>;
}

export async function recallPlace(stores: PlaceStores, input: PlaceQuery): Promise<PlaceResult<PlaceRecall>> {
  const coverage: PlaceCoverage = { occurrences: 0, comparable: 0, semanticCandidates: 0, positions: 0, unplaceable: 0, poolTruncated: false, complete: false };
  const fail = (refusal: PlaceRefusal): PlaceRefusal => ({ ...refusal, coverage: { ...coverage } });
  const checked = checkPlace<PlaceQuery>('placeQuery', input); if (checked.status !== 'success') return fail(checked);
  const query = checked.value, operation = query.operation;
  if (!query.subject.trim()) return fail(placeRefuse('TPLC1001', 'place recall requires a qualified subject'));
  const knowledge = validateKnowledge(query.knowledge); if (knowledge.status !== 'success') return fail(fromTemporal(knowledge));
  if (query.k > query.candidatePool) return fail(placeRefuse('TPLC1011', 'final k cannot exceed the semantic candidate pool'));
  const captured = await capturePlaceSnapshot(stores.temporal, query.scope, query.expectedHead ?? undefined);
  if (captured.status !== 'success') return fail(captured);
  const { projection, sources, claims, head } = captured.value.snapshot;
  coverage.occurrences = sources.length;
  if (!sameTemporalValue(projection.knowledge, query.knowledge)) return fail(placeRefuse('TPLC1009', 'knowledge view differs; prepare an independent projection', 'identity-mismatch'));
  if (!sameTemporalValue(projection.embeddedBy, query.embeddedBy) || query.embedding.length !== projection.embeddedBy.dims) {
    return fail(placeRefuse('TPLC1009', 'query embedding identity or dimensions differ', 'identity-mismatch'));
  }
  const pool = temporalSourcePool(sources, projection, query);
  coverage.comparable = pool.comparable; coverage.semanticCandidates = pool.pool.length; coverage.poolTruncated = pool.poolTruncated;
  const positions = captured.value.rows.filter(row => row.subject === query.subject && row.series === 'location');
  coverage.positions = positions.length;
  coverage.unplaceable = positions.filter(row => row.claim.status !== 'accepted' || !['state', 'point'].includes(row.claim.time.kind)).length;
  const selected = new Map<string, TemporalClaim>();
  function budget(): PlaceRefusal | null {
    const cited = new Set([...selected.values()].flatMap(claim => claim.citations.map(span => span.sourceId)));
    if ([...cited].some(id => !pool.poolIds.has(id))) return placeRefuse('TPLC1011', 'required citation is outside the declared semantic source pool');
    if (cited.size > query.k) return placeRefuse('TPLC1011', 'required citations exceed final k');
    return null;
  }
  function event(id: string): PlaceResult<TemporalClaim> {
    const claim = claims.find(c => c.id === id);
    if (!claim) return placeRefuse('TPLC1009', 'event operand is not in the captured projection', 'incomplete-index');
    if (claim.series.subject !== query.subject) return placeRefuse('TPLC1009', 'event operand belongs to another subject', 'identity-mismatch');
    selected.set(claim.id, claim);
    const refused = budget(); return refused ?? placeSuccess(claim);
  }
  let answer: PlaceAnswer;
  if (operation.kind === 'nearby') {
    const entry = stores.gazetteer.byId(operation.entryId); if (entry.status !== 'success') return fail(entry);
    const nearby = await nearbyEntries(stores.gazetteer, entry.value, { ...operation, entriesInCells: stores.entriesInCells });
    if (nearby.status !== 'success') return fail(nearby);
    answer = { kind: 'nearby', entryIds: nearby.value.entryIds, claimIds: [], sourceIds: [], citations: [] };
  } else {
    const series = await readPositionSeries(stores.temporal, { scope: query.scope, versionId: projection.versionId, subject: query.subject, gazetteer: stores.gazetteer }, captured.value);
    if (series.status !== 'success') return fail(series);
    if (operation.kind === 'movement') {
      const from = event(operation.fromClaimId); if (from.status !== 'success') return fail(from);
      const to = event(operation.toClaimId); if (to.status !== 'success') return fail(to);
      const movement = movementDistance(series.value, from.value, to.value); if (movement.status !== 'success') return fail(movement);
      selected.set(movement.value.from.claim.id, movement.value.from.claim); selected.set(movement.value.to.claim.id, movement.value.to.claim);
      answer = { kind: 'movement', fromEntryId: movement.value.from.entry.id, toEntryId: movement.value.to.entry.id,
        metres: movement.value.metres, claimIds: [], sourceIds: [], citations: [] };
    } else {
      let location;
      if (operation.kind === 'location-at-event') {
        const operand = event(operation.eventClaimId); if (operand.status !== 'success') return fail(operand);
        location = locationAtEvent(series.value, operand.value);
      } else {
        const instant = temporalInstant(operation.at); if (instant.status !== 'success') return fail(fromTemporal(instant));
        location = locationAtInstant(series.value, instant.value);
      }
      if (location.status !== 'success') return fail(location);
      selected.set(location.value.claim.id, location.value.claim);
      answer = { kind: operation.kind, entryId: location.value.entry.id, claimIds: [], sourceIds: [], citations: [] };
    }
  }
  const refused = budget(); if (refused) return fail(refused);
  const usedClaims = [...selected.values()].sort((a, b) => a.id.localeCompare(b.id));
  const citations = [...new Map(usedClaims.flatMap(claim => claim.citations).map(span => [canonicalizeJson(span), span])).values()]
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.start - b.start || a.end - b.end);
  const sourceIds = [...new Set(citations.map(span => span.sourceId))].sort();
  const result = checkPlace<PlaceAnswer>('placeAnswer', { ...answer, claimIds: usedClaims.map(claim => claim.id), sourceIds, citations });
  if (result.status !== 'success') return fail(result);
  coverage.complete = coverage.comparable === coverage.occurrences && !coverage.poolTruncated;
  return placeSuccess({ head, answer: result.value, claims: usedClaims, sources: sources.filter(source => sourceIds.includes(source.id)), coverage, refusals: {} });
}

/** Ordinary recall is separate output, preserving the original place refusal. */
export async function recallPlaceWithFallback(stores: PlaceStores, query: PlaceQuery, ordinary: { units: MemoryUnit[]; options?: RankOptions }) {
  const place = await recallPlace(stores, query);
  return place.status === 'success' ? { place, ordinary: null } :
    { place, ordinary: recallByEmbedding(ordinary.units, query.embedding, { ...ordinary.options, identity: query.embeddedBy }) };
}
