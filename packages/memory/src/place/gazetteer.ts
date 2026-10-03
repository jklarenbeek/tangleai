/** An immutable sourced gazetteer, with deterministic exact alias lookup. */
import { deepFreeze } from '@jarenjs/core/object';
import { compareCodePoints } from '@jarenjs/core/string';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { checkPlace, placeIdentity, placeRefuse, placeSuccess, type PlaceResult,
  type Gazetteer, type GazetteerEntry } from './contracts.ts';
import { checkPlaceGeometry } from './geometry.ts';

/** NFC, Unicode lowercase and collapsed whitespace; no stemming or fuzzy matching. */
export function normalizePlaceName(value: string): string { return value.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim(); }
export interface GazetteerView extends Gazetteer {
  byId(id: string): PlaceResult<GazetteerEntry>;
  byName(name: string): readonly GazetteerEntry[];
}

/** Shared source/geometry policy for gazetteer loading and cited claim creation. */
export function checkGazetteerEntry(input: unknown): PlaceResult<GazetteerEntry> {
  try {
    canonicalizeJson(input);
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return checkPlace('gazetteerEntry', input);
    const entry = input as Record<string, unknown>;
    const source = checkPlace('placeSource', entry.source);
    if (source.status !== 'success') return placeRefuse('TPLC1003', `entry ${String(entry.id ?? '(unnamed)')} needs a citable source: ${source.detail}`);
    const geometry = checkPlaceGeometry(entry.geometry, entry.sourceLatLon); if (geometry.status !== 'success') return geometry;
    const shape = checkPlace<GazetteerEntry>('gazetteerEntry', input); if (shape.status !== 'success') return shape;
    if (shape.value.names.some(name => !normalizePlaceName(name))) return placeRefuse('TPLC1001', 'gazetteer aliases must contain non-whitespace text');
    return shape;
  } catch (cause) { return placeRefuse('TPLC1001', `invalid gazetteer entry: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

export async function createGazetteer(input: unknown): Promise<PlaceResult<GazetteerView>> {
  try {
    canonicalizeJson(input);
    // Route the specific missing-source/geometry refusals before the enclosing
    // closed shape would turn them into a generic invalid-shape result.
    if (input !== null && typeof input === 'object' && 'entries' in input && Array.isArray(input.entries)) {
      for (const entry of input.entries) {
        const checked = checkGazetteerEntry(entry); if (checked.status !== 'success') return checked;
      }
    }
    const shape = checkPlace<Gazetteer>('gazetteer', input); if (shape.status !== 'success') return shape;
    const document = shape.value, entries = [...document.entries].sort((a, b) => compareCodePoints(a.id, b.id));
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) return placeRefuse('TPLC1001', 'gazetteer entry ids must be unique');
    if (document.revision !== await placeIdentity(entries)) return placeRefuse('TPLC1001', 'gazetteer revision differs from its sorted entries');
    deepFreeze(entries);
    const byId = new Map(entries.map(entry => [entry.id, entry])), aliases = new Map<string, GazetteerEntry[]>();
    for (const entry of entries) for (const alias of new Set(entry.names.map(normalizePlaceName))) {
      const values = aliases.get(alias) ?? []; values.push(entry); aliases.set(alias, values);
    }
    for (const values of aliases.values()) Object.freeze(values);
    const empty: readonly GazetteerEntry[] = Object.freeze([]);
    return placeSuccess(Object.freeze({ id: document.id, revision: document.revision, entries,
      byId(id: string) { const entry = byId.get(id); return entry ? placeSuccess(entry) : placeRefuse('TPLC1004', `unknown gazetteer entry: ${id}`); },
      byName(name: string) { return aliases.get(normalizePlaceName(name)) ?? empty; },
    }));
  } catch (cause) { return placeRefuse('TPLC1001', `invalid gazetteer: ${cause instanceof Error ? cause.message : String(cause)}`); }
}
