import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createGazetteer, matchPlaceMentions, createPlaceClaim, placeNeighbourhood, checkAuthoredQuery, placeIntent, answerPlace, nearbyEntries } from '@tangleai/memory/place';
import { createSourceOccurrence, temporalStamp, citeSource, validateTemporalClaim, createTemporalProjection, createTemporalMemoryStore } from '@tangleai/memory/temporal';
import { geoDistance } from '@jarenjs/core/geo';
import { validatePlaceShape } from '@tangleai/core/schemas/place';
import fixture from './place-gazetteer.json' with { type: 'json' };

const value = result => { if (result.status !== 'success') throw Error(`${result.reason}: ${result.detail}`); return result.value; };
const ensure = (condition, detail) => { if (!condition) throw Error(detail); };
export async function qualifyPlace() {
  const gazetteer = value(await createGazetteer({ id: 'installed-place', revision: await canonicalSha256(fixture.entries), entries: fixture.entries }));
  const entry = gazetteer.entries[0], at = '2026-09-01T12:00:00Z', text = `I visited ${entry.names[0]}.`;
  const source = value(await createSourceOccurrence({ scope: 'installed-place', sessionOrdinal: 0, turnOrdinal: 0,
    role: 'host', text, sourceLocator: 'installed:place', observedAt: value(temporalStamp(at, { precision: 'minute' })), knownAt: at }));
  const mentions = value(await matchPlaceMentions(text, gazetteer, { source }));
  ensure(mentions.counts.grounded === 1 && mentions.mentions[0].entryId === entry.id, 'installed exact place alias');
  const span = value(citeSource(source, 10, 10 + entry.names[0].length));
  const claim = value(await createPlaceClaim({ scope: source.scope, subject: 'traveller', entry, kind: 'event', at,
    until: null, source, span, derivation: { method: 'host-asserted', identity: 'installed-place' }, precision: 'millisecond' }));
  ensure((await validateTemporalClaim(claim, [source])).status === 'success', 'installed temporal citation identity');
  ensure(validatePlaceShape('gazetteerEntry', entry).valid, 'installed closed place schema');
  const cells = value(placeNeighbourhood(entry, 6));
  ensure(cells.length === 9, 'installed native neighbours');
  const prefix = { $jslt: '0.1', rules: [{ match: '$', body: { $for: { p: '$.places[*]' },
    $where: { '$starts-with': [{ $geohash: ['$p.at', 6] }, 'u173'] }, $return: '$p' } }] };
  const refusal = checkAuthoredQuery(prefix, { question: 'group by cell', sample: { places: [{ at: entry.geometry.coordinates }] }, intent: placeIntent({ kind: 'nearby' }) });
  ensure(refusal.status === 'refused' && refusal.code === 'TPLC1007' && refusal.cause === 'AI0230', 'installed explicit spatial gate');
  const secondEntry = gazetteer.entries[1], later = '2026-09-02T12:00:00Z';
  const secondSource = value(await createSourceOccurrence({ scope: source.scope, sessionOrdinal: 1, turnOrdinal: 0, role: 'host',
    text: `I visited ${secondEntry.names[0]}.`, sourceLocator: 'installed:place:later', observedAt: value(temporalStamp(later)), knownAt: later }));
  const secondClaim = value(await createPlaceClaim({ scope: source.scope, subject: 'traveller', entry: secondEntry, kind: 'event', at: later,
    until: null, source: secondSource, span: value(citeSource(secondSource)), derivation: { method: 'host-asserted', identity: 'installed-place' }, precision: 'millisecond' }));
  const sources = [source, secondSource];
  const bundle = value(await createTemporalProjection({ scope: source.scope, sources, claims: [claim, secondClaim],
    sourceIdentity: 'installed-place', viewIdentity: 'provided-history', policyIdentity: 'installed-place', modelIdentity: 'host-asserted', promptIdentity: 'none',
    knowledge: { mode: 'provided-history' }, embeddedBy: { model: 'installed-place', dims: 2 }, embeddings: sources.map(s => ({ sourceId: s.id, vector: [1, 0] })), complete: true }));
  const temporal = createTemporalMemoryStore(), head = value(await temporal.apply(bundle, { key: 'installed-place', expectedHead: null })).head;
  const query = { scope: source.scope, subject: 'traveller', operation: { kind: 'movement', fromClaimId: claim.id, toClaimId: secondClaim.id },
    knowledge: bundle.projection.knowledge, embeddedBy: bundle.projection.embeddedBy, embedding: [1, 0], candidatePool: 10, k: 2, minScore: 0, expectedHead: head };
  const answer = value(await answerPlace({ temporal, gazetteer }, query));
  const metres = Math.round(geoDistance(entry.geometry, secondEntry.geometry));
  ensure(answer.answer.kind === 'movement' && answer.answer.metres === metres && answer.answer.citations.length === 2, 'installed cited movement');
  const nearby = value(await nearbyEntries(gazetteer, value(gazetteer.byId('shibuya-scramble-crossing-q21083961')), { radiusMetres: 400, precision: 6 }));
  ensure(nearby.entryIds.length === 1 && nearby.entryIds[0] === 'shibuya-q595153' && nearby.probedCells === 9, 'installed nearby boundary');
  return { gazetteer, entry, cells, bundle, query, answer, summary: { entries: gazetteer.entries.length, grounded: 1, cells: cells.length,
    claim: true, refusal: refusal.code, cause: refusal.cause, movementMetres: metres, citedSources: answer.answer.sourceIds.length, nearby: nearby.entryIds } };
}
