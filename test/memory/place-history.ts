import { createTemporalClaim, createTemporalProjection, createTemporalMemoryStore, citeSource,
  type ClaimTime, type TemporalClaim, type TemporalStore } from '@tangleai/memory/temporal';
import { type PlaceQuery } from '@tangleai/memory/place';
import { placeGazetteer, placeSource, placeValue } from './place-fixture.ts';

export interface PlaceAssertion { time: ClaimTime; value?: string; subject?: string; series?: string; status?: TemporalClaim['status']; }
export const exactPlaceTime = (epoch: number): ClaimTime => ({ kind: 'point', at: new Date(epoch).toISOString(), precision: 'millisecond' });
export async function placeHistory(rows: PlaceAssertion[], store: TemporalStore = createTemporalMemoryStore()) {
  const gazetteer = await placeGazetteer(), scope = 'place-test';
  const sources = await Promise.all(rows.map((row, i) => placeSource(`Host assertion ${i}: ${JSON.stringify(row)}`, scope, i)));
  const claims = await Promise.all(rows.map(async (row, i) => placeValue(await createTemporalClaim({ scope,
    series: { subject: row.subject ?? 'alex', key: row.series ?? 'location' }, value: row.value ?? gazetteer.entries[i % 2].id,
    status: row.status ?? 'accepted', time: row.time, citations: [placeValue(citeSource(sources[i]))],
    derivation: { method: 'host-asserted', identity: 'place-test' } }, sources))));
  const bundle = placeValue(await createTemporalProjection({ scope, sources, claims, sourceIdentity: 'place-test', viewIdentity: 'provided-history',
    policyIdentity: 'place-test', modelIdentity: 'host-asserted', promptIdentity: 'none', knowledge: { mode: 'provided-history' },
    embeddedBy: { model: 'place-test', dims: 2 }, embeddings: sources.map(source => ({ sourceId: source.id, vector: [1, 0] })), complete: true }));
  const receipt = placeValue(await store.apply(bundle, { key: 'place-test', expectedHead: null }));
  const query: PlaceQuery = { scope, subject: 'alex', operation: { kind: 'location-at', at: new Date(0).toISOString() },
    knowledge: bundle.projection.knowledge, embeddedBy: bundle.projection.embeddedBy, embedding: [1, 0], candidatePool: 100, k: 10, minScore: 0, expectedHead: receipt.head };
  return { gazetteer, store, bundle, claims, sources, receipt, query,
    seriesOptions: { scope, subject: 'alex', versionId: bundle.projection.versionId, gazetteer } };
}
