import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createGazetteer, matchPlaceMentions, createPlaceClaim, placeNeighbourhood, checkAuthoredQuery, placeIntent } from '@tangleai/memory/place';
import { createSourceOccurrence, temporalStamp, citeSource, validateTemporalClaim } from '@tangleai/memory/temporal';
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
    until: null, source, span, derivation: { method: 'host-asserted', identity: 'installed-place' } }));
  ensure((await validateTemporalClaim(claim, [source])).status === 'success', 'installed temporal citation identity');
  ensure(validatePlaceShape('gazetteerEntry', entry).valid, 'installed closed place schema');
  const cells = value(placeNeighbourhood(entry, 6));
  ensure(cells.length === 9, 'installed native neighbours');
  const prefix = { $jslt: '0.1', rules: [{ match: '$', body: { $for: { p: '$.places[*]' },
    $where: { '$starts-with': [{ $geohash: ['$p.at', 6] }, 'u173'] }, $return: '$p' } }] };
  const refusal = checkAuthoredQuery(prefix, { question: 'group by cell', sample: { places: [{ at: entry.geometry.coordinates }] }, intent: placeIntent({ kind: 'nearby' }) });
  ensure(refusal.status === 'refused' && refusal.code === 'TPLC1007' && refusal.cause === 'AI0230', 'installed explicit spatial gate');
  return { gazetteer, entry, cells, summary: { entries: gazetteer.entries.length, grounded: 1, cells: cells.length, claim: true, refusal: refusal.code, cause: refusal.cause } };
}
