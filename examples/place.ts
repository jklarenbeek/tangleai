/** Sourced places and exact host reporting instants through actual SQLite reopen. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { geoDistance } from '@jarenjs/core/geo';
import { openTangleDb, createPlaceDbStore, createTemporalDbStore } from '@tangleai/store';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createGazetteer, createPlaceClaim, answerPlace, type PlaceQuery, type PlaceResult } from '@tangleai/memory/place';
import { createSourceOccurrence, citeSource, temporalStamp, createTemporalClaim, createTemporalProjection,
  type SourceOccurrence, type TemporalClaim, type TemporalResult } from '@tangleai/memory/temporal';
import entries from './place-gazetteer.json' with { type: 'json' };

function value<T>(result: PlaceResult<T> | TemporalResult<T>): T {
  if (result.status !== 'success') throw Error(`${result.reason}: ${result.detail}`);
  return result.value;
}

export async function runPlaceExample(path: string): Promise<void> {
  const gazetteer = value(await createGazetteer({ id: 'public-place-example', revision: await canonicalSha256(entries), entries }));
  const scope = 'public-place-example', sources: SourceOccurrence[] = [], claims: TemporalClaim[] = [], events: TemporalClaim[] = [];
  const assertions = [
    { subject: 'alex', entryId: 'shibuya-scramble-crossing-q21083961', at: '2026-09-01T12:00:00Z' },
    { subject: 'alex', entryId: 'shibuya-q595153', at: '2026-09-02T12:00:00Z' },
    { subject: 'blair', entryId: 'tokyo-q1490', at: '2026-09-02T12:00:00Z' },
  ];
  for (const [i, assertion] of assertions.entries()) {
    const entry = value(gazetteer.byId(assertion.entryId));
    const source = value(await createSourceOccurrence({ scope, sessionOrdinal: i, turnOrdinal: 0, role: 'host',
      text: `${assertion.subject} reported a visit to ${entry.names[0]} at reporting index ${assertion.at}.`,
      observedAt: value(temporalStamp(assertion.at, { precision: 'minute' })), knownAt: assertion.at, sourceLocator: `example:place:${i}` }));
    sources.push(source);
    const span = value(citeSource(source)), derivation = { method: 'host-asserted' as const, identity: 'example-reporting-index' };
    claims.push(value(await createPlaceClaim({ scope, subject: assertion.subject, entry, kind: 'event', at: assertion.at,
      until: null, source, span, derivation, precision: 'millisecond' })));
    const event = value(await createTemporalClaim({ scope, series: { subject: assertion.subject, key: 'reporting-event' }, value: `report-${i}`,
      time: { kind: 'point', at: assertion.at, precision: 'millisecond' }, status: 'accepted', citations: [span], derivation }, [source]));
    claims.push(event); events.push(event);
  }
  const embedder = createHashEmbedder({ dims: 512 }), embeddedBy = { model: embedder.model, dims: embedder.dims };
  const vectors = await embedder.embed(sources.map(source => source.text));
  const bundle = value(await createTemporalProjection({ scope, sources, claims, sourceIdentity: 'public-place-example',
    viewIdentity: 'provided-history', policyIdentity: 'reporting-index', modelIdentity: 'host-asserted', promptIdentity: 'none',
    knowledge: { mode: 'provided-history' }, embeddedBy, embeddings: sources.map((source, i) => ({ sourceId: source.id, vector: [...vectors[i]] })), complete: true }));
  let db = await openTangleDb({ path });
  try {
    let temporal = createTemporalDbStore(db), place = createPlaceDbStore(db);
    value(await place.loadGazetteer(gazetteer));
    const applied = value(await temporal.apply(bundle, { key: 'example', expectedHead: null }));
    const query: PlaceQuery = { scope, subject: 'alex', operation: { kind: 'location-at-event', eventClaimId: events[0].id },
      knowledge: bundle.projection.knowledge, embeddedBy, embedding: [...(await embedder.embed(['alex visit']))[0]],
      candidatePool: 100, k: 10, minScore: 0, expectedHead: applied.head };
    const stores = () => ({ temporal, gazetteer, entriesInCells: (cells: readonly string[]) => place.entriesInCells(gazetteer.id, cells) });
    const location = value(await answerPlace(stores(), query));
    assert.equal(location.answer.kind === 'location-at-event' && location.answer.entryId, assertions[0].entryId);
    const movementQuery: PlaceQuery = { ...query, operation: { kind: 'movement', fromClaimId: events[0].id, toClaimId: events[1].id } };
    const movement = value(await answerPlace(stores(), movementQuery));
    const metres = Math.round(geoDistance(value(gazetteer.byId(assertions[0].entryId)).geometry, value(gazetteer.byId(assertions[1].entryId)).geometry)!);
    assert.equal(movement.answer.kind === 'movement' && movement.answer.metres, metres); assert.equal(metres, 310);
    const unmatched = await answerPlace(stores(), { ...query, operation: { kind: 'location-at', at: '2026-09-03T12:00:00Z' } });
    assert.equal(unmatched.status === 'refused' && unmatched.code, 'TPLC1008');
    const nearby = value(await answerPlace(stores(), { ...query, operation: { kind: 'nearby', entryId: assertions[0].entryId, radiusMetres: 400, precision: 6 } }));
    assert.deepEqual(nearby.answer.kind === 'nearby' && nearby.answer.entryIds, [assertions[1].entryId]);
    const blair = value(await answerPlace(stores(), { ...query, subject: 'blair', operation: { kind: 'location-at-event', eventClaimId: events[2].id } }));
    assert.equal(blair.answer.kind === 'location-at-event' && blair.answer.entryId, assertions[2].entryId);
    await db.close(); db = await openTangleDb({ path }); temporal = createTemporalDbStore(db); place = createPlaceDbStore(db);
    assert.deepEqual(value(await answerPlace(stores(), query)), location);
    assert.deepEqual(value(await answerPlace(stores(), movementQuery)), movement);
    const replay = value(await temporal.apply(bundle, { key: 'example', expectedHead: null }));
    const loaded = value(await place.loadGazetteer(gazetteer));
    assert.equal(replay.writes, 0); assert.equal(loaded.writes, 0);
    assert.equal(temporal.stats().writes, 0); assert.equal(place.stats().writes, 0);
    console.log(JSON.stringify({ location: location.text, movement: movement.text, nearby: nearby.text, unmatched,
      reopenedEqual: true, projectionReplayWrites: replay.writes, gazetteerReplayWrites: loaded.writes, liveRequests: 0 }, null, 2));
  } finally { await db.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const directory = process.argv[2] ? null : await mkdtemp(join(tmpdir(), 'tangle-place-'));
  const before = globalThis.fetch; globalThis.fetch = async () => { throw Error('public place example forbids network requests'); };
  try { await runPlaceExample(process.argv[2] ?? join(directory!, 'example.db')); }
  finally { globalThis.fetch = before; if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); }
}
