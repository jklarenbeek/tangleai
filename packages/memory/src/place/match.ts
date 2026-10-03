/** Exact alias matching with original UTF-16 citations and explicit host qualification. */
import { getSegmenter, compareCodePoints } from '@jarenjs/core/string';
import { deepFreeze } from '@jarenjs/core/object';
import { citeSource, validateSourceOccurrence } from '../temporal/evidence.ts';
import type { SourceOccurrence } from '../temporal/contracts.ts';
import { checkPlace, fromTemporal, placeRefuse, placeSuccess, type GazetteerEntry, type PlaceMention, type PlaceResult } from './contracts.ts';
import { normalizePlaceName, type GazetteerView } from './gazetteer.ts';

export interface PlaceMatchContext {
  text: string; source: SourceOccurrence; start: number; end: number; quote: string;
}
export interface PlaceMatchOptions {
  source: SourceOccurrence;
  knownUngrounded?: readonly string[];
  /** False rejects a lexical occurrence as a place assertion; it does not choose another place. */
  qualify?: (candidates: readonly GazetteerEntry[], context: Readonly<PlaceMatchContext>) => boolean;
  /** Select an existing candidate id, or retain ambiguity with null/undefined. */
  disambiguate?: (candidates: readonly GazetteerEntry[], context: Readonly<PlaceMatchContext>) => string | null | undefined;
}
export interface PlaceMentions {
  mentions: PlaceMention[];
  counts: { grounded: number; ungrounded: number; ambiguous: number };
}

function indexedText(text: string): { text: string; starts: number[]; ends: number[] } {
  const segments = [...getSegmenter().segment(text)];
  const normalized = segments.map(part => part.segment.normalize('NFC')).join('');
  if (normalized !== text.normalize('NFC')) throw Error('normalization crossed an original grapheme boundary');
  const lower = normalized.toLowerCase(), starts: number[] = [], ends: number[] = [];
  // Lowercase the whole string so context-sensitive forms such as final sigma
  // remain native. Segment lengths map expansions back to their original span.
  for (const part of segments) {
    const length = part.segment.normalize('NFC').toLowerCase().length;
    for (let i = 0; i < length; i++) { starts.push(part.index); ends.push(part.index + part.segment.length); }
  }
  if (starts.length !== lower.length) throw Error('case normalization changed the offset partition');
  const output: string[] = [], mappedStarts: number[] = [], mappedEnds: number[] = [];
  for (let i = 0; i < lower.length; i++) {
    if (/\s/u.test(lower[i])) {
      if (!output.length) continue;
      if (output.at(-1) === ' ') { mappedEnds[mappedEnds.length - 1] = ends[i]; continue; }
      output.push(' ');
    } else output.push(lower[i]);
    mappedStarts.push(starts[i]); mappedEnds.push(ends[i]);
  }
  if (output.at(-1) === ' ') { output.pop(); mappedStarts.pop(); mappedEnds.pop(); }
  return { text: output.join(''), starts: mappedStarts, ends: mappedEnds };
}
function wordBounded(text: string, start: number, end: number): boolean {
  return !/[\p{L}\p{M}\p{N}\p{Pc}]$/u.test(text.slice(Math.max(0, start - 2), start)) &&
    !/^[\p{L}\p{M}\p{N}\p{Pc}]/u.test(text.slice(end, end + 2));
}
function isAsyncResult(value: unknown): boolean {
  // Unsupported native promises are refused immediately. Consume a rejection
  // only to prevent a caller's invalid callback from creating an unhandled one.
  if (value instanceof Promise) { void value.catch(() => undefined); return true; }
  return value !== null && typeof value === 'object' && 'then' in value && typeof value.then === 'function';
}

export async function matchPlaceMentions(text: string, gazetteer: GazetteerView, options: PlaceMatchOptions): Promise<PlaceResult<PlaceMentions>> {
  try {
    if (typeof text !== 'string') return placeRefuse('TPLC1001', 'mention text must be a string');
    const checked = await validateSourceOccurrence(options?.source); if (checked.status !== 'success') return fromTemporal(checked);
    const source = deepFreeze(checked.value);
    if (text !== source.text) return placeRefuse('TPLC1001', 'mention text must equal its source occurrence text');
    const ungrounded = options.knownUngrounded ?? [];
    if (!Array.isArray(ungrounded) || ungrounded.some(name => typeof name !== 'string' || !normalizePlaceName(name))) {
      return placeRefuse('TPLC1001', 'known ungrounded aliases must be nonempty strings');
    }
    const aliases = [...new Set([...gazetteer.entries.flatMap(entry => entry.names), ...ungrounded].map(normalizePlaceName))]
      .sort((a, b) => b.length - a.length || compareCodePoints(a, b));
    const indexed = indexedText(text), selected: Array<{ alias: string; start: number; end: number }> = [];
    for (const alias of aliases) {
      if (!alias) return placeRefuse('TPLC1001', 'empty normalized gazetteer alias');
      for (let offset = indexed.text.indexOf(alias); offset !== -1; offset = indexed.text.indexOf(alias, offset + 1)) {
        const stop = offset + alias.length;
        if (!wordBounded(indexed.text, offset, stop)) continue;
        const start = indexed.starts[offset], end = indexed.ends[stop - 1];
        if (normalizePlaceName(text.slice(start, end)) !== alias) continue;
        if (selected.some(span => span.start < end && span.end > start)) continue;
        selected.push({ alias, start, end });
      }
    }
    selected.sort((a, b) => a.start - b.start || a.end - b.end || compareCodePoints(a.alias, b.alias));
    const mentions: PlaceMention[] = [], counts = { grounded: 0, ungrounded: 0, ambiguous: 0 };
    for (const match of selected) {
      const span = citeSource(source, match.start, match.end); if (span.status !== 'success') return fromTemporal(span);
      const context = deepFreeze({ text, source, start: match.start, end: match.end, quote: span.value.quote });
      let candidates = gazetteer.byName(match.alias);
      if (options.qualify) {
        const qualified: unknown = options.qualify(candidates, context);
        if (isAsyncResult(qualified) || typeof qualified !== 'boolean') return placeRefuse('TPLC1001', 'place qualification must return a synchronous boolean');
        if (!qualified) candidates = Object.freeze([]);
      }
      let entryId: string | null = candidates.length === 1 ? candidates[0].id : null;
      if (candidates.length > 1 && options.disambiguate) {
        const chosen: unknown = options.disambiguate(candidates, context);
        if (isAsyncResult(chosen)) return placeRefuse('TPLC1001', 'place disambiguation must be synchronous');
        if (chosen !== null && chosen !== undefined) {
          if (typeof chosen !== 'string' || !candidates.some(entry => entry.id === chosen)) return placeRefuse('TPLC1001', 'disambiguation returned an id outside its candidates');
          entryId = chosen;
        }
      }
      const status = entryId !== null ? 'grounded' : candidates.length > 1 ? 'ambiguous' : 'ungrounded';
      const mention = checkPlace<PlaceMention>('placeMention', { ...span.value, entryId, status, candidates: candidates.map(entry => entry.id) });
      if (mention.status !== 'success') return mention;
      mentions.push(mention.value); counts[status]++;
    }
    return placeSuccess(deepFreeze({ mentions, counts }));
  } catch (cause) { return placeRefuse('TPLC1001', `place matching refused: ${cause instanceof Error ? cause.message : String(cause)}`); }
}
