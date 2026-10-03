/** Deterministic names and metres rendered from verified sourced answers. */
import { checkPlace, placeSuccess, type PlaceAnswer, type PlaceQuery, type PlaceResult } from './contracts.ts';
import type { GazetteerView } from './gazetteer.ts';
import { recallPlace, type PlaceRecall, type PlaceStores } from './retrieval.ts';

export function renderPlaceAnswer(input: PlaceAnswer, gazetteer: GazetteerView): PlaceResult<string> {
  const checked = checkPlace<PlaceAnswer>('placeAnswer', input); if (checked.status !== 'success') return checked;
  const answer = checked.value;
  const ids = answer.kind === 'movement' ? [answer.fromEntryId, answer.toEntryId] : answer.kind === 'nearby' ? answer.entryIds : [answer.entryId];
  const names: string[] = [];
  for (const id of ids) { const entry = gazetteer.byId(id); if (entry.status !== 'success') return entry; names.push(entry.value.names[0]); }
  const citations = answer.citations.map(span => `[${span.sourceId}:${span.start}-${span.end}]`).join(' ');
  const text = answer.kind === 'movement' ? `${names[0]} to ${names[1]}: ${answer.metres} metres.` :
    answer.kind === 'nearby' ? names.length ? `Nearby: ${names.join(', ')}.` : 'No entries within the radius.' : `${names[0]}.`;
  return placeSuccess(citations ? `${text} ${citations}` : text);
}

export async function answerPlace(stores: PlaceStores, query: PlaceQuery): Promise<PlaceResult<PlaceRecall & { text: string }>> {
  const recall = await recallPlace(stores, query); if (recall.status !== 'success') return recall;
  const rendered = renderPlaceAnswer(recall.value.answer, stores.gazetteer);
  return rendered.status === 'success' ? placeSuccess({ ...recall.value, text: rendered.value }) : { ...rendered, coverage: recall.value.coverage };
}
