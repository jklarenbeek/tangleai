/** Native GeoJSON and geohash kernels with explicit two-dimensional source policy. */
import { isValidGeoJson, geohashEncode, geohashNeighbours } from '@jarenjs/core/geo';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { checkPlace, placeRefuse, placeSuccess, type PlaceResult, type PlaceGeometry,
  type PlaceSourceLatLon, type GazetteerEntry } from './contracts.ts';

function hasCrs(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  return Object.hasOwn(value, 'crs') || Object.values(value).some(hasCrs);
}

export function checkPlaceGeometry(value: unknown, sourceLatLon?: unknown): PlaceResult<PlaceGeometry> {
  try {
    canonicalizeJson(value);
    const native = isValidGeoJson(value), cause = native ? undefined : 'isValidGeoJson=false';
    if (hasCrs(value)) return placeRefuse('TPLC1002', 'a crs member is not accepted anywhere in place geometry', cause);
    if (value === null || typeof value !== 'object' || Array.isArray(value) || !('type' in value) || value.type !== 'Point') {
      return placeRefuse('TPLC1002', 'place geometry must be a GeoJSON Point', cause);
    }
    const coordinates = 'coordinates' in value ? value.coordinates : undefined;
    if (!Array.isArray(coordinates) || coordinates.length !== 2) return placeRefuse('TPLC1002', 'a place position must have exactly two components', cause);
    if (!coordinates.every(v => typeof v === 'number' && Number.isFinite(v))) return placeRefuse('TPLC1002', 'position components must be finite numbers', cause);
    const [lon, lat] = coordinates as [number, number];
    if (lon < -180 || lon > 180) return placeRefuse('TPLC1002', 'longitude is outside -180..180', cause);
    if (lat < -90 || lat > 90) return placeRefuse('TPLC1002', 'latitude is outside -90..90', cause);
    if (!native) return placeRefuse('TPLC1002', 'the native GeoJSON validator refused the geometry', cause);
    const shape = checkPlace<PlaceGeometry>('placeGeometry', value);
    if (shape.status !== 'success') return placeRefuse('TPLC1002', shape.detail);
    if (sourceLatLon !== undefined) {
      const source = checkPlace<PlaceSourceLatLon>('placeSourceLatLon', sourceLatLon);
      if (source.status !== 'success') return placeRefuse('TPLC1002', `invalid source latitude/longitude: ${source.detail}`);
      if (lon !== source.value.lon || lat !== source.value.lat) return placeRefuse('TPLC1002',
        lon === source.value.lat && lat === source.value.lon ? 'swapped longitude/latitude pair differs from the source' : 'coordinates differ from sourceLatLon');
    }
    return shape;
  } catch (cause) { return placeRefuse('TPLC1002', `non-JSON geometry: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

/** Validate precision before entering the native encoder, which assumes bounded input. */
export function placeCell(entry: Pick<GazetteerEntry, 'geometry' | 'sourceLatLon'>, precision: number): PlaceResult<string> {
  const checked = checkPlace<number>('geohashPrecision', precision); if (checked.status !== 'success') return checked;
  const geometry = checkPlaceGeometry(entry?.geometry, entry?.sourceLatLon); if (geometry.status !== 'success') return geometry;
  return placeSuccess(geohashEncode(geometry.value.coordinates[0], geometry.value.coordinates[1], checked.value));
}
export function placeNeighbourhood(entry: Pick<GazetteerEntry, 'geometry' | 'sourceLatLon'>, precision: number): PlaceResult<string[]> {
  const cell = placeCell(entry, precision);
  return cell.status === 'success' ? placeSuccess(geohashNeighbours(cell.value)) : cell;
}
