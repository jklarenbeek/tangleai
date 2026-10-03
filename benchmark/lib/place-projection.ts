/** Host assertions indexed by reporting session; this builder receives no questions or answers. */
import { createHashEmbedder } from '@tangleai/models/embed';
import { createSourceOccurrence, citeSource, createTemporalClaim, createTemporalProjection, temporalStamp,
  type SourceOccurrence, type TemporalClaim, type TemporalBundle, type TemporalResult } from '@tangleai/memory/temporal';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import { conversationCorpus, transcriptUnits } from './locomo-corpus.ts';
import type { LocomoSample } from './locomo.ts';
import type { Mention, Registration } from './place-report.types.ts';

export interface PlaceProjection {
  bundle: TemporalBundle; units: MemoryUnit[]; sourcesByDiaId: Map<string, SourceOccurrence>;
  eventsByDiaId: Map<string, TemporalClaim>; replayKey: string;
}
function checked<T>(result: TemporalResult<T>): T {
  if (result.status !== 'success') throw new Error(`place projection: ${result.reason}: ${result.detail}`);
  return result.value;
}
export async function buildPlaceProjection(sample: LocomoSample, mentions: readonly Mention[], registration: Pick<Registration, 'dims'>,
  sourceIdentity: string): Promise<PlaceProjection> {
  const corpus = conversationCorpus(sample), units = transcriptUnits(corpus), embedder = createHashEmbedder({ dims: registration.dims });
  const vectors = await embedder.embed(units.map(u => u.text)), embeddedBy = { model: embedder.model, dims: embedder.dims };
  const sourcesByDiaId = new Map<string, SourceOccurrence>(), eventsByDiaId = new Map<string, TemporalClaim>();
  const sources: SourceOccurrence[] = [], claims: TemporalClaim[] = [];
  const policy = 'reporting-session-annotation-index-v1';
  for (const [index, turn] of corpus.turns.entries()) {
    const at = units[index].at, raw = sample.conversation[`session_${turn.session}_date_time`];
    const observedAt = checked(temporalStamp(at, { precision: 'minute', raw: typeof raw === 'string' ? raw : at, provenance: 'host-asserted' }));
    const source = checked(await createSourceOccurrence({ scope: sample.sample_id, sessionOrdinal: turn.session,
      turnOrdinal: Number(turn.diaId.split(':')[1]), role: 'host', text: units[index].text, observedAt, knownAt: at, sourceLocator: turn.address }));
    sources.push(source); sourcesByDiaId.set(turn.diaId, source);
    units[index] = { ...units[index], embedding: [...vectors[index]], embeddedBy };
    const event = checked(await createTemporalClaim({ scope: sample.sample_id, series: { subject: `${sample.sample_id}/${turn.speaker}`, key: 'reporting-event' },
      value: turn.address, time: { kind: 'point', at, precision: 'millisecond' }, status: 'accepted', citations: [checked(citeSource(source))],
      derivation: { method: 'host-asserted', identity: policy } }, [source]));
    claims.push(event); eventsByDiaId.set(turn.diaId, event);
  }
  for (const mention of mentions.filter(m => m.sampleId === sample.sample_id && m.positionEligible)) {
    const source = sourcesByDiaId.get(mention.diaId);
    if (!source || !mention.entryId) throw new Error('place position has no grounded source');
    // The only residence in this fixture has no evidenced end. It stays unknown.
    const time = mention.kind === 'state' ? { kind: 'state' as const, from: source.observedAt.at, until: { kind: 'unknown' as const }, precision: 'minute' as const }
      : { kind: 'point' as const, at: source.observedAt.at, precision: 'millisecond' as const };
    claims.push(checked(await createTemporalClaim({ scope: sample.sample_id, series: { subject: mention.subject, key: 'location' }, value: mention.entryId,
      time, status: 'accepted', citations: [checked(citeSource(source, mention.start, mention.end))], derivation: { method: 'host-asserted', identity: policy } }, [source])));
  }
  const bundle = checked(await createTemporalProjection({ scope: sample.sample_id, sources, claims, sourceIdentity,
    viewIdentity: 'provided-history', policyIdentity: policy, modelIdentity: 'host-asserted', promptIdentity: 'none', knowledge: { mode: 'provided-history' },
    embeddedBy, embeddings: sources.map((s, index) => ({ sourceId: s.id, vector: [...vectors[index]] })), complete: true }));
  units.sort((a, b) => sourcesByDiaId.get(a.id)!.id.localeCompare(sourcesByDiaId.get(b.id)!.id));
  return { bundle, units, sourcesByDiaId, eventsByDiaId, replayKey: `place:${bundle.projection.versionId}` };
}
