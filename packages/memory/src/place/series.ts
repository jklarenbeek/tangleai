/** Complete, version-bound position membership read through the temporal owner. */
import { deepFreeze } from '@jarenjs/core/object';
import { checkTemporal, sameTemporalValue, type TemporalClaim, type TemporalClaimRow, type TemporalHead,
  type TemporalSnapshot } from '../temporal/contracts.ts';
import { temporalProjectionRecords, type TemporalStore } from '../temporal/store.ts';
import { fromTemporal, placeRefuse, placeSuccess, type GazetteerEntry, type PlaceResult } from './contracts.ts';
import type { GazetteerView } from './gazetteer.ts';

/** Internal classification; an accepted unknown state end is checked at query time. */
export function unplaceablePosition(claim: TemporalClaim): boolean {
  return claim.status !== 'accepted' || !['state', 'point'].includes(claim.time.kind);
}

export interface PositionRow {
  claim: TemporalClaim; entry: GazetteerEntry; atEpoch: number | null; untilEpoch: number | null; unplaceable: boolean;
}
export interface PositionSeries {
  scope: string; versionId: string; subject: string;
  /** Numeric table indexes satisfy the native as-of sample contract. */
  samples: { at: number; value: number }[];
  table: PositionRow[];
  counts: { positions: number; unplaceable: number; pages: number };
}
export interface PositionSeriesOptions {
  scope: string; versionId: string; subject: string; gazetteer: GazetteerView;
  pageLimit?: number; maxPages?: number;
}
interface PlaceSnapshot { snapshot: TemporalSnapshot; rows: TemporalClaimRow[]; }

/** Shared capture for retrieval and standalone series reads; not a public bypass. */
export async function capturePlaceSnapshot(store: TemporalStore, scope: string, expectedHead?: TemporalHead): Promise<PlaceResult<PlaceSnapshot>> {
  try {
    const captured = await store.snapshot(scope, expectedHead);
    if (captured.status !== 'success') return fromTemporal(captured);
    const shape = checkTemporal<TemporalSnapshot>('temporalSnapshot', captured.value);
    if (shape.status !== 'success') return fromTemporal(shape);
    const head = checkTemporal<TemporalHead>('temporalHead', shape.value.head);
    if (head.status !== 'success') return fromTemporal(head);
    const { projection, sources, claims } = shape.value;
    const records = await temporalProjectionRecords({ projection, sources, claims });
    if (records.status !== 'success') return fromTemporal(records);
    const { bundle } = records.value;
    if (head.value.scope !== scope || bundle.projection.scope !== scope || head.value.versionId !== bundle.projection.versionId ||
      expectedHead && !sameTemporalValue(head.value, expectedHead)) return placeRefuse('TPLC1009', 'captured head and projection identity differ', 'stale-projection');
    if (!bundle.projection.complete) return placeRefuse('TPLC1009', 'position reads require a complete projection', 'incomplete-index');
    return placeSuccess({ snapshot: { ...bundle, head: head.value }, rows: records.value.records.flatMap(row => row.table === 'claims' ? [row.value] : []) });
  } catch (cause) { return placeRefuse('TPLC1010', `position snapshot failed: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

/** The captured inventory proves that short pages and physical mirrors are complete. */
export async function readPositionSeries(store: TemporalStore, options: PositionSeriesOptions, captured: PlaceSnapshot): Promise<PlaceResult<PositionSeries>> {
  const { scope, versionId, subject, gazetteer, pageLimit = 256, maxPages = 128 } = options;
  if (!scope || !versionId || !subject || !Number.isSafeInteger(pageLimit) || pageLimit < 1 || !Number.isSafeInteger(maxPages) || maxPages < 1) {
    return placeRefuse('TPLC1001', 'position reads need scope, version, subject and positive integer page limits');
  }
  if (captured.snapshot.projection.scope !== scope || captured.snapshot.projection.versionId !== versionId) {
    return placeRefuse('TPLC1009', 'requested position version differs from the captured projection', 'stale-projection');
  }
  const expected = new Map(captured.rows.filter(row => row.subject === subject && row.series === 'location').map(row => [row.id, row]));
  const seen = new Set<string>(), table: PositionRow[] = [], samples: PositionSeries['samples'] = [];
  let afterId: string | undefined, pages = 0, unplaceable = 0;
  try {
    while (pages < maxPages) {
      const result = await store.queryClaims({ scope, versionId, subject, series: 'location', afterId, limit: pageLimit }); pages++;
      if (result.status !== 'success') return fromTemporal(result);
      if (!Array.isArray(result.value) || result.value.length > pageLimit) return placeRefuse('TPLC1009', 'position page exceeds its declared bound', 'incomplete-index');
      for (const row of result.value) {
        const member = expected.get(row.id);
        if (!member || !sameTemporalValue(row, member) || seen.has(row.id) || afterId !== undefined && row.id <= afterId) {
          return placeRefuse('TPLC1009', 'position page contains foreign, repeated, unordered or altered membership', 'identity-mismatch');
        }
        seen.add(row.id); afterId = row.id;
        const entry = gazetteer.byId(row.claim.value); if (entry.status !== 'success') return entry;
        const unusable = unplaceablePosition(row.claim);
        if (unusable) unplaceable++;
        const index = table.length;
        table.push({ claim: row.claim, entry: entry.value, atEpoch: row.validFromEpochMs, untilEpoch: row.validUntilEpochMs, unplaceable: unusable });
        // Unknown-time assertions remain in the table, never receive an invented instant.
        if (row.validFromEpochMs !== null) samples.push({ at: row.validFromEpochMs, value: index });
      }
      if (result.value.length < pageLimit) {
        if (seen.size !== expected.size) return placeRefuse('TPLC1009', 'short position page omitted captured membership', 'incomplete-index');
        return placeSuccess(deepFreeze({ scope, versionId, subject, table, samples, counts: { positions: table.length, unplaceable, pages } }));
      }
    }
    return placeRefuse('TPLC1011', `position series exceeded ${maxPages} pages of ${pageLimit} rows`);
  } catch (cause) { return placeRefuse('TPLC1010', `position read failed: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

export async function positionSeries(store: TemporalStore, options: PositionSeriesOptions): Promise<PlaceResult<PositionSeries>> {
  const captured = await capturePlaceSnapshot(store, options.scope);
  return captured.status === 'success' ? readPositionSeries(store, options, captured.value) : captured;
}
