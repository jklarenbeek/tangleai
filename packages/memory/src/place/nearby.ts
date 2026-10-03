/** Nine native cells are only a prefilter; the whole radius must fit before refinement. */
import { circleBounds, geohashBounds, geohashEncode, bboxUnion, bboxContains, geoDistance } from '@jarenjs/core/geo';
import { compareCodePoints } from '@jarenjs/core/string';
import { sameTemporalValue } from '../temporal/contracts.ts';
import { placeCell, placeNeighbourhood } from './geometry.ts';
import { checkGazetteerEntry, type GazetteerView } from './gazetteer.ts';
import { placeRefuse, placeSuccess, type PlaceResult, type GazetteerEntry } from './contracts.ts';

export interface NearbyOptions {
  radiusMetres: number; precision: number;
  /** Bind this callback to the same immutable gazetteer revision. */
  entriesInCells?: (cells: readonly string[]) => Promise<PlaceResult<GazetteerEntry[]>>;
}
export interface NearbyEntries { entryIds: string[]; probedCells: number; candidates: number; narrowed: number; }

export async function nearbyEntries(gazetteer: GazetteerView, entry: GazetteerEntry, options: NearbyOptions): Promise<PlaceResult<NearbyEntries>> {
  try {
    if (!options || !Number.isFinite(options.radiusMetres) || options.radiusMetres < 0) return placeRefuse('TPLC1001', 'nearby radius must be finite nonnegative metres');
    const checked = checkGazetteerEntry(entry); if (checked.status !== 'success') return checked;
    const member = gazetteer.byId(checked.value.id); if (member.status !== 'success') return member;
    if (!sameTemporalValue(member.value, checked.value)) return placeRefuse('TPLC1001', 'nearby centre differs from its gazetteer entry');
    const centre = placeCell(member.value, options.precision); if (centre.status !== 'success') return centre;
    const neighbours = placeNeighbourhood(member.value, options.precision); if (neighbours.status !== 'success') return neighbours;
    const cells = [...new Set(neighbours.value)], boxes = cells.map(cell => geohashBounds(cell)!);
    const centreBox = geohashBounds(centre.value)!;
    const columns = [...new Set(boxes.map(box => box[0]))].sort((a, b) => a - b);
    const rows = [...new Set(boxes.map(box => box[1]))].sort((a, b) => a - b);
    // Wrapped cells can have a huge union with an uncovered gap. Prove the
    // native cells tile a contiguous 3x3 rectangle before using its bounds.
    const tiled = cells.length === 9 && columns.length === 3 && rows.length === 3 &&
      columns.every((west, x) => rows.every((south, y) => {
        const box = boxes.find(b => b[0] === west && b[1] === south);
        return box !== undefined && (x === 2 || box[2] === columns[x + 1]) && (y === 2 || box[3] === rows[y + 1]);
      }));
    const [lon, lat] = member.value.geometry.coordinates;
    const circle = circleBounds(lon, lat, options.radiusMetres);
    const footprint = boxes.reduce((a, b) => bboxUnion(a, b));
    if (!tiled || !circle || !bboxContains(footprint, circle[0], circle[1]) || !bboxContains(footprint, circle[2], circle[3])) {
      return placeRefuse('TPLC1011', `radius is not covered by the nine-cell footprint; centre=${JSON.stringify(centreBox)}, footprint=${JSON.stringify(footprint)}, probedCells=${cells.length}`);
    }
    const cellSet = new Set(cells);
    // GazetteerView has already validated and frozen every position. No new
    // coordinate spelling, geographic arithmetic or partial prefix lookup.
    const expected = gazetteer.entries.filter(candidate => cellSet.has(geohashEncode(...candidate.geometry.coordinates, options.precision)));
    let candidates = expected;
    if (options.entriesInCells) {
      const loaded = await options.entriesInCells(cells); if (loaded.status !== 'success') return loaded;
      const order = (values: GazetteerEntry[]) => [...values].sort((a, b) => compareCodePoints(a.id, b.id));
      if (!sameTemporalValue(order(loaded.value), order(expected))) return placeRefuse('TPLC1011', 'cell reader did not return the complete captured gazetteer candidates');
      candidates = loaded.value;
    }
    const entryIds: string[] = [];
    for (const candidate of candidates) {
      if (candidate.id === member.value.id) continue;
      const distance = geoDistance(member.value.geometry, candidate.geometry);
      if (distance === null || !Number.isFinite(distance)) return placeRefuse('TPLC1002', 'native nearby distance could not measure a sourced candidate');
      if (distance <= options.radiusMetres) entryIds.push(candidate.id);
    }
    entryIds.sort(compareCodePoints);
    return placeSuccess({ entryIds, probedCells: cells.length, candidates: candidates.length, narrowed: candidates.length - entryIds.length });
  } catch (cause) { return placeRefuse('TPLC1010', `nearby read failed: ${cause instanceof Error ? cause.message : String(cause)}`); }
}
