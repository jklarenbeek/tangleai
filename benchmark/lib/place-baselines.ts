/** Matched keyless rankers over one immutable host-asserted projection per conversation. */
import { createHashEmbedder } from '@tangleai/models/embed';
import { recallByEmbedding } from '@tangleai/memory';
import { createTemporalMemoryStore, recallTemporal, type TemporalStore } from '@tangleai/memory/temporal';
import type { LoadedPlaceFixture, PlaceInput } from './place-fixture.ts';
import { buildPlaceProjection, type PlaceProjection } from './place-projection.ts';
import type { Outcome } from './place-report.types.ts';

export interface PlaceBaselineContext {
  loaded: LoadedPlaceFixture; projections: Map<string, PlaceProjection>; stores: Map<string, TemporalStore>;
  embed: (text: string) => Promise<number[]>;
}
export async function preparePlaceBaselines(loaded: LoadedPlaceFixture): Promise<PlaceBaselineContext> {
  const projections = new Map<string, PlaceProjection>(), stores = new Map<string, TemporalStore>();
  const embedder = createHashEmbedder({ dims: loaded.fixture.manifest.registration.dims });
  if (loaded.corpus.status === 'available') for (const sample of loaded.corpus.samples) {
    const projection = await buildPlaceProjection(sample, loaded.fixture.mentions, loaded.fixture.manifest.registration, loaded.fixture.manifest.source.sha256);
    const store = createTemporalMemoryStore(), applied = await store.apply(projection.bundle, { key: projection.replayKey, expectedHead: null });
    if (applied.status !== 'success') throw new Error(`place projection refused: ${applied.detail}`);
    projections.set(sample.sample_id, projection); stores.set(sample.sample_id, store);
  }
  return { loaded, projections, stores, embed: async text => [...(await embedder.embed([text]))[0]] };
}
export async function meaningOnly(context: PlaceBaselineContext, question: PlaceInput): Promise<Outcome> {
  if (question.kind === 'movement-distance' || question.kind === 'nearby' || question.kind === 'false-proximity') return { refused: 'no-geometry' };
  const projection = context.projections.get(question.sampleId)!;
  const registration = context.loaded.fixture.manifest.registration;
  const pool = recallByEmbedding(projection.units, await context.embed(question.text), { k: registration.candidatePool,
    minScore: registration.minScore, identity: projection.bundle.projection.embeddedBy });
  for (const result of pool.ranked.slice(0, registration.k)) {
    const mention = context.loaded.fixture.mentions.find(m => m.sampleId === question.sampleId && m.diaId === result.unit.id && m.status === 'grounded');
    if (mention) return { entryId: mention.entryId! };
  }
  return { refused: 'no-grounded-ranked-turn' };
}
export async function meaningTime(context: PlaceBaselineContext, question: PlaceInput): Promise<Outcome> {
  if (question.kind === 'movement-distance' || question.kind === 'nearby' || question.kind === 'false-proximity') return { refused: 'no-geometry' };
  const { loaded } = context;
  if (loaded.corpus.status !== 'available') throw new Error(loaded.corpus.detail);
  const diaId = 'eventDiaId' in question ? question.eventDiaId : loaded.fixture.mentions.find(m => m.id === question.mentionId)!.diaId;
  const source = context.projections.get(question.sampleId)!.sourcesByDiaId.get(diaId)!;
  const { candidatePool, k, minScore } = loaded.fixture.manifest.registration;
  const p = context.projections.get(question.sampleId)!.bundle.projection;
  const result = await recallTemporal(context.stores.get(question.sampleId)!, { text: question.text, scope: question.sampleId, subject: question.subject, series: 'location',
    operation: { kind: 'at', at: source.observedAt.at }, knowledge: p.knowledge, embeddedBy: p.embeddedBy, embedding: await context.embed(question.text),
    candidatePool, k, minScore, expectedHead: null, anchor: null });
  if (result.status !== 'success') return { refused: 'temporal-refusal', cause: result.reason };
  const entries = [...new Set(result.value.claims.map(c => c.value))];
  return entries.length === 1 ? { entryId: entries[0] } : { refused: 'temporal-refusal', cause: 'conflicting-claims' };
}
