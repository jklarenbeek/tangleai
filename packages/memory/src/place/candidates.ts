/** Internal sweep over already validated points; cells are buckets, not distance. */
import { geohashEncode } from '@jarenjs/core/geo';
import type { PlaceGeometry } from './contracts.ts';

export function entriesInPlaceCells<T extends { geometry: PlaceGeometry }>(entries: readonly T[], cells: readonly string[], precision: number): T[] {
  const members = new Set(cells);
  return entries.filter(entry => members.has(geohashEncode(...entry.geometry.coordinates, precision)));
}
