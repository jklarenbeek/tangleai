import { validatePlaceShape, type Gazetteer, type GazetteerEntry, type PlaceQuery, type PlaceRefusal, type Position } from '@tangleai/core/schemas/place';
import { createGazetteer, matchPlaceMentions, createPlaceClaim, placeGates, placeIntent, placeNeighbourhood,
  positionSeries, locationAtEvent, movementDistance, nearbyEntries, recallPlace, answerPlace, renderPlaceAnswer,
  type GazetteerView, type PlaceClaimInput } from '@tangleai/memory/place';
import { createPlaceDbStore, type PlaceDbStore, type TangleDb } from '@tangleai/store';
import type { SourceOccurrence, TemporalClaim, TemporalStore } from '@tangleai/memory/temporal';

declare const document: Gazetteer, gazetteer: GazetteerView, entry: GazetteerEntry, db: TangleDb;
declare const source: SourceOccurrence, input: PlaceClaimInput, query: PlaceQuery;
declare const temporal: TemporalStore, event: TemporalClaim;
const loaded = await createGazetteer(document);
if (loaded.status === 'success') { const found: GazetteerView = loaded.value; void found; }
const matched = await matchPlaceMentions(source.text, gazetteer, { source, disambiguate: candidates => candidates[0]?.id });
if (matched.status === 'success') { const count: number = matched.value.counts.ambiguous; void count; }
const claimed = await createPlaceClaim(input);
if (claimed.status === 'success') { const claim: TemporalClaim = claimed.value; void claim; }
const cells = placeNeighbourhood(entry, 6), store: PlaceDbStore = createPlaceDbStore(db);
if (cells.status === 'success') await store.entriesInCells(document.id, cells.value);
await store.loadGazetteer(document);
validatePlaceShape('gazetteerEntry', entry);
placeGates({ question: 'next to', intent: placeIntent(query.operation) });
const series = await positionSeries(temporal, { scope: query.scope, versionId: 'projection', subject: query.subject, gazetteer });
if (series.status === 'success') {
  const sample: { at: number; value: number } | undefined = series.value.samples[0]; void sample;
  locationAtEvent(series.value, event); movementDistance(series.value, event, event);
}
await nearbyEntries(gazetteer, entry, { radiusMetres: 100, precision: 6, entriesInCells: cells => store.entriesInCells(document.id, cells) });
const recalled = await recallPlace({ temporal, gazetteer }, query), answered = await answerPlace({ temporal, gazetteer }, query);
if (recalled.status === 'refused') { const complete: boolean | undefined = recalled.coverage?.complete; void complete; }
if (answered.status === 'success') {
  const text: string = answered.value.text; void text;
  renderPlaceAnswer(answered.value.answer, gazetteer);
}
// @ts-expect-error a qualified subject is required, including for geometry-only queries
await recallPlace({ temporal, gazetteer }, { ...query, subject: undefined });
// @ts-expect-error geometry is exactly two-dimensional
const invalidPosition: Position = [1, 2, 3];
// @ts-expect-error codes and reasons are paired by the generated closed union
const invalidRefusal: PlaceRefusal = { status: 'refused', code: 'TPLC1002', reason: 'invalid-shape', detail: 'mismatched reason' };
// @ts-expect-error disambiguation is synchronous
await matchPlaceMentions(source.text, gazetteer, { source, disambiguate: async () => entry.id });
// @ts-expect-error no location assertion without its original source and citation
await createPlaceClaim({ entry, subject: 'person', kind: 'event' });
void invalidPosition; void invalidRefusal;
