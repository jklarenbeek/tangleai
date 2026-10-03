/** Native backward joins followed by the temporal owner's validity decision. */
import { asOfJoin } from '@jarenjs/core/series';
import { geoDistance } from '@jarenjs/core/geo';
import { checkTemporal, type TemporalClaim } from '../temporal/contracts.ts';
import { temporalInstant, claimContains } from '../temporal/time.ts';
import { fromTemporal, placeRefuse, placeSuccess, type PlaceResult } from './contracts.ts';
import type { PositionSeries, PositionRow } from './series.ts';

export function locationAtInstant(series: PositionSeries, atEpoch: number): PlaceResult<PositionRow> {
  if (!Number.isSafeInteger(atEpoch) || Math.abs(atEpoch) > 8640000000000000) return placeRefuse('TPLC1009', 'location needs a finite integer epoch', 'invalid-time');
  if (series.table.some(row => row.atEpoch === null)) return placeRefuse('TPLC1009', 'unknown-time position cannot be ordered around the instant', 'unknown-validity');
  try {
    const match = asOfJoin([{ at: atEpoch, value: 0 }], series.samples, { direction: 'backward' })[0];
    if (match.right === null) return placeRefuse('TPLC1008', 'no position started at or before the instant');
    const index: unknown = match.right.value;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= series.table.length) return placeRefuse('TPLC1001', 'position sample does not address its table');
    const row = series.table[index];
    if (row.atEpoch !== match.right.at) return placeRefuse('TPLC1001', 'position sample instant differs from its table');
    if (row.claim.status === 'conflicting') return placeRefuse('TPLC1009', 'matched position is marked conflicting', 'conflicting-claims');
    if (row.unplaceable || row.claim.status !== 'accepted') return placeRefuse('TPLC1009', 'matched position has unknown validity', 'unknown-validity');
    const contains = claimContains(row.claim.time, atEpoch);
    if (contains.status !== 'success') return fromTemporal(contains);
    return contains.value ? placeSuccess(row) : placeRefuse('TPLC1008', 'state ended before the instant or the point is not this instant');
  } catch (cause) { return placeRefuse('TPLC1001', `invalid position series: ${cause instanceof Error ? cause.message : String(cause)}`); }
}

export function locationAtEvent(series: PositionSeries, eventClaim: TemporalClaim): PlaceResult<PositionRow> {
  const shape = checkTemporal<TemporalClaim>('temporalClaim', eventClaim); if (shape.status !== 'success') return fromTemporal(shape);
  const event = shape.value;
  if (event.scope !== series.scope || event.series.subject !== series.subject) return placeRefuse('TPLC1009', 'event belongs to another scope or subject', 'identity-mismatch');
  if (event.status === 'conflicting') return placeRefuse('TPLC1009', 'event is marked conflicting', 'conflicting-claims');
  if (event.status !== 'accepted' || event.time.kind !== 'point') return placeRefuse('TPLC1009', 'event needs an accepted exact point', 'unknown-validity');
  const at = temporalInstant(event.time.at); if (at.status !== 'success') return fromTemporal(at);
  const exact = claimContains(event.time, at.value); if (exact.status !== 'success') return fromTemporal(exact);
  return locationAtInstant(series, at.value);
}

export function movementDistance(series: PositionSeries, fromClaim: TemporalClaim, toClaim: TemporalClaim): PlaceResult<{ from: PositionRow; to: PositionRow; metres: number }> {
  const from = locationAtEvent(series, fromClaim);
  if (from.status !== 'success') return { ...from, detail: `from: ${from.detail}` };
  const to = locationAtEvent(series, toClaim);
  if (to.status !== 'success') return { ...to, detail: `to: ${to.detail}` };
  if (fromClaim.time.kind !== 'point' || toClaim.time.kind !== 'point') return placeRefuse('TPLC1009', 'movement needs exact event operands', 'unknown-validity');
  const start = temporalInstant(fromClaim.time.at), end = temporalInstant(toClaim.time.at);
  if (start.status !== 'success') return fromTemporal(start); if (end.status !== 'success') return fromTemporal(end);
  if (start.value > end.value) return placeRefuse('TPLC1009', 'movement endpoints are reversed', 'invalid-time');
  const distance = geoDistance(from.value.entry.geometry, to.value.entry.geometry);
  if (distance === null || !Number.isFinite(distance)) return placeRefuse('TPLC1002', 'native distance could not measure both sourced positions');
  return placeSuccess({ from: from.value, to: to.value, metres: Math.round(distance) });
}
