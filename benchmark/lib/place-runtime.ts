/** Real place policies over the same host-asserted projection and semantic budgets. */
import { fileURLToPath } from 'node:url';
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { compareCodePoints } from '@jarenjs/core/string';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createGazetteer, answerPlace, matchPlaceMentions, placeCell, checkAuthoredQuery,
  type GazetteerView, type PlaceCoverage, type PlaceQuery, type PlaceResult } from '@tangleai/memory/place';
import { createTemporalMemoryStore, createTemporalProjection, type TemporalStore, type TemporalResult } from '@tangleai/memory/temporal';
import { openTangleDb, createPlaceDbStore, createTemporalDbStore, type TangleDb } from '@tangleai/store';
import { temporalSourcePool } from '../../packages/memory/src/temporal/source-pool.ts';
import { runRuntimeFixture } from '../../scripts/runtime-fixture.ts';
import { preparePlaceBaselines, type PlaceBaselineContext } from './place-baselines.ts';
import { loadPlaceFixture, type LoadedPlaceFixture, type PlaceInput } from './place-fixture.ts';
import type { PlaceAdapters, PlaceRuntimeMeasurement } from './place-conformance.ts';
import type { Outcome } from './place-report.types.ts';

function value<T>(result: PlaceResult<T> | TemporalResult<T>): T {
  if (result.status !== 'success') throw Error(`place runtime setup refused: ${result.reason}: ${result.detail}`);
  return result.value;
}
const emptyCoverage = (): PlaceCoverage => ({ occurrences: 0, comparable: 0, semanticCandidates: 0, positions: 0, unplaceable: 0, poolTruncated: false, complete: false });
export interface PlaceBackendReceipt {
  backend: 'memory' | 'node-sqlite' | 'bun-sqlite'; fixtureHash: string; inputHash: string;
  rows: { id: string; input: PlaceInput; result: PlaceRuntimeMeasurement | { unavailable: string } }[];
  replay: { projectionWrites: number; gazetteerWrites: number }; liveRequests: 0;
}

async function runQuestion(prepared: PlaceBaselineContext, question: PlaceInput, temporal: TemporalStore,
  gazetteer: GazetteerView, geometry: Awaited<ReturnType<typeof createTemporalProjection>>,
  entriesInCells?: (cells: readonly string[]) => Promise<PlaceResult<import('@tangleai/memory/place').GazetteerEntry[]>>): Promise<PlaceRuntimeMeasurement> {
  const { loaded } = prepared, { candidatePool, k, minScore } = loaded.fixture.manifest.registration;
  const projection = 'sampleId' in question ? prepared.projections.get(question.sampleId)! : null;
  const bundle = projection?.bundle ?? value(geometry), p = bundle.projection;
  const embedding = await prepared.embed(question.text);
  if ('mentionId' in question) {
    if (!projection) throw Error('mention has no scoped projection');
    const annotation = loaded.fixture.mentions.find(m => m.id === question.mentionId && m.sampleId === question.sampleId && m.subject === question.subject);
    if (!annotation) throw Error('mention operand does not resolve in its scope');
    const snapshot = value(await temporal.snapshot(p.scope));
    if (snapshot.projection.versionId !== p.versionId) throw Error('mention projection differs from the shared fixture head');
    const source = snapshot.sources.find(s => s.id === projection.sourcesByDiaId.get(annotation.diaId)!.id);
    if (!source) throw Error('persisted mention source is missing');
    const pool = temporalSourcePool(snapshot.sources, snapshot.projection, { embedding, candidatePool, minScore });
    const positionClaims = snapshot.claims.filter(c => c.series.subject === question.subject && c.series.key === 'location');
    const coverage: PlaceCoverage = { occurrences: snapshot.sources.length, comparable: pool.comparable, semanticCandidates: pool.pool.length,
      positions: positionClaims.length, unplaceable: positionClaims.filter(c => c.status !== 'accepted' || !['point', 'state'].includes(c.time.kind)).length,
      poolTruncated: pool.poolTruncated, complete: false };
    if (!pool.poolIds.has(source.id)) return { outcome: { refused: 'TPLC1011' }, coverage };
    const qualifications = new Map(loaded.fixture.mentions.filter(m => m.sampleId === question.sampleId && m.diaId === annotation.diaId)
      .map(m => [`${m.start}:${m.end}`, m.qualification]));
    const matches = await matchPlaceMentions(source.text, gazetteer, { source, knownUngrounded: loaded.fixture.manifest.knownUngrounded,
      qualify: (_candidates, context) => qualifications.get(`${context.start}:${context.end}`) !== 'nonlocative-adjective' });
    if (matches.status !== 'success') return { outcome: { refused: matches.code, ...(matches.cause ? { cause: matches.cause } : {}) }, coverage };
    const mention = matches.value.mentions.find(m => m.start === annotation.start && m.end === annotation.end);
    if (!mention) throw Error('runtime matcher omitted an addressed source span');
    coverage.complete = pool.comparable === snapshot.sources.length && !pool.poolTruncated;
    return { outcome: mention.status === 'grounded' ? { entryId: mention.entryId } : { refused: mention.status === 'ambiguous' ? 'TPLC1006' : 'TPLC1005' }, coverage };
  }
  const operation: PlaceQuery['operation'] = question.kind === 'nearby' || question.kind === 'false-proximity'
    ? { kind: 'nearby', entryId: question.entryId, radiusMetres: question.radiusMetres, precision: 6 }
    : question.kind === 'movement-distance' ? { kind: 'movement', fromClaimId: projection!.eventsByDiaId.get(question.fromDiaId)!.id,
      toClaimId: projection!.eventsByDiaId.get(question.toDiaId)!.id }
      : { kind: 'location-at-event', eventClaimId: projection!.eventsByDiaId.get(question.eventDiaId)!.id };
  const query: PlaceQuery = { scope: p.scope, subject: 'subject' in question ? question.subject : 'gazetteer-geometry', operation,
    knowledge: p.knowledge, embeddedBy: p.embeddedBy, embedding, candidatePool, k, minScore, expectedHead: value(await temporal.head(p.scope)) };
  const result = await answerPlace({ temporal, gazetteer, entriesInCells }, query);
  if (result.status !== 'success') return { outcome: { refused: result.code, ...(result.cause ? { cause: result.cause } : {}) }, coverage: result.coverage ?? emptyCoverage() };
  const { answer, coverage } = result.value;
  let outcome: Outcome;
  if (question.kind === 'false-proximity') {
    if (answer.kind !== 'nearby') throw Error('nearby kernel returned another operation');
    const a = value(gazetteer.byId(question.entryId)), b = value(gazetteer.byId(question.otherEntryId));
    const gate = checkAuthoredQuery(loaded.fixture.gateDocuments['refusals/prefix-as-proximity.json'], {
      question: question.text, intent: { proximity: true, spatial: true } });
    outcome = { ninecell: answer.entryIds.includes(b.id), singlePrefix: value(placeCell(b, 6)).startsWith(value(placeCell(a, 6))),
      gate: gate.status === 'refused' ? gate.cause ?? gate.code : 'not-refused' };
  } else if (answer.kind === 'movement') outcome = { fromEntryId: answer.fromEntryId, toEntryId: answer.toEntryId, metres: answer.metres };
  else if (answer.kind === 'nearby') outcome = { entryIds: answer.entryIds };
  else outcome = { entryId: answer.entryId };
  return { outcome, coverage };
}

export async function runPlaceBackend(backend: PlaceBackendReceipt['backend'], loadedInput?: LoadedPlaceFixture,
  preparedInput?: PlaceBaselineContext): Promise<PlaceBackendReceipt> {
  if (backend !== 'memory' && (process.versions.bun ? 'bun-sqlite' : 'node-sqlite') !== backend) throw Error('place SQLite runtime identity differs');
  const before = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error('network forbidden in the keyless place backend'); };
  let db: TangleDb | null = null;
  try {
    const loaded = loadedInput ?? await loadPlaceFixture(), prepared = preparedInput ?? await preparePlaceBaselines(loaded);
    db = backend === 'memory' ? null : await openTangleDb({ path: ':memory:' });
    const temporal = db ? createTemporalDbStore(db) : createTemporalMemoryStore();
    const entries = structuredClone(loaded.fixture.entries).sort((a, b) => compareCodePoints(a.id, b.id));
    const gazetteer = value(await createGazetteer({ id: `place-fixture:${loaded.fixtureHash}`, revision: await canonicalSha256(entries), entries }));
    const place = db ? createPlaceDbStore(db) : null;
    let gazetteerWrites = 0, projectionWrites = 0;
    if (place) { value(await place.loadGazetteer(gazetteer)); gazetteerWrites = value(await place.loadGazetteer(gazetteer)).writes; }
    const embedder = createHashEmbedder({ dims: loaded.fixture.manifest.registration.dims });
    const geometry = await createTemporalProjection({ scope: 'place-gazetteer-geometry', sources: [], claims: [], sourceIdentity: loaded.fixtureHash,
      viewIdentity: 'provided-history', policyIdentity: 'sourced-gazetteer-geometry', modelIdentity: 'host-asserted', promptIdentity: 'none',
      knowledge: { mode: 'provided-history' }, embeddedBy: { model: embedder.model, dims: embedder.dims }, embeddings: [], complete: true });
    for (const bundle of [...prepared.projections.values()].map(p => p.bundle).concat(value(geometry))) {
      const key = `place:${bundle.projection.versionId}`;
      value(await temporal.apply(bundle, { key, expectedHead: null }));
      projectionWrites += value(await temporal.apply(bundle, { key, expectedHead: null })).writes;
    }
    const rows: PlaceBackendReceipt['rows'] = [];
    for (const { expected: _expected, ...input } of loaded.fixture.questions) {
      const result = loaded.corpus.status === 'unavailable' && 'sampleId' in input ? { unavailable: loaded.corpus.detail } :
        await runQuestion(prepared, input, temporal, gazetteer, geometry, place ? cells => place.entriesInCells(gazetteer.id, cells) : undefined);
      rows.push({ id: input.id, input, result });
    }
    if (requests) throw Error(`place backend observed ${requests} forbidden network requests`);
    if (projectionWrites || gazetteerWrites) throw Error('place backend replay wrote additional rows');
    return { backend, fixtureHash: loaded.fixtureHash, inputHash: await canonicalSha256(rows.map(row => row.input)), rows,
      replay: { projectionWrites, gazetteerWrites }, liveRequests: 0 };
  } finally { try { if (db) await db.close(); } finally { globalThis.fetch = before; } }
}

export async function placeRuntimeAdapters(loaded: LoadedPlaceFixture, prepared?: PlaceBaselineContext): Promise<PlaceAdapters> {
  const adapters: PlaceAdapters = {}, inputs = loaded.fixture.questions.map(({ expected: _expected, ...input }) => input);
  for (const backend of ['memory', 'node-sqlite', 'bun-sqlite'] as const) {
    let receipt: PlaceBackendReceipt;
    if (backend === 'memory') receipt = await runPlaceBackend(backend, loaded, prepared);
    else {
      try {
        const { stdout } = await runRuntimeFixture(backend === 'bun-sqlite' ? 'bun' : 'node',
          [fileURLToPath(new URL('../scripts/place-backend.ts', import.meta.url)), ...(loaded.corpus.status === 'unavailable' ? ['--without-corpus'] : [])],
          { timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
        receipt = JSON.parse(stdout) as PlaceBackendReceipt;
      } catch (cause) {
        if (backend === 'bun-sqlite' && cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
          adapters[`meaning-time-place/${backend}`] = async () => ({ unavailable: 'Bun executable is not installed' }); continue;
        }
        throw cause;
      }
    }
    if (receipt.backend !== backend || receipt.fixtureHash !== loaded.fixtureHash || receipt.inputHash !== await canonicalSha256(inputs) ||
      canonicalizeJson(receipt.rows.map(row => row.input)) !== canonicalizeJson(inputs) || new Set(receipt.rows.map(row => row.id)).size !== inputs.length ||
      receipt.rows.some(row => row.id !== row.input.id) || receipt.liveRequests !== 0 || receipt.replay.projectionWrites !== 0 || receipt.replay.gazetteerWrites !== 0) {
      throw Error('place backend receipt differs from the registered inputs or zero-request replay');
    }
    const byId = new Map(receipt.rows.map(row => [row.id, row]));
    adapters[`meaning-time-place/${backend}`] = async input => {
      const row = byId.get(input.id);
      if (!row || canonicalizeJson(row.input) !== canonicalizeJson(input)) throw Error('place backend input identity differs');
      return structuredClone(row.result);
    };
  }
  return adapters;
}
