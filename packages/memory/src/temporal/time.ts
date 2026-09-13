/** Jaren calendar/interval kernels, with explicit precision and refusal policy. */
import { getEpochOfDateTimeRFC3339, parseRFC3339Parts, epochOfRFC3339Parts, addToParts, startOfParts,
  partsFromEpoch, daysFromCivil } from '@jarenjs/core/dates';
import { containsInstant, overlapsInterval } from '@jarenjs/core/series';
import { checkTemporal, refuse, success, type TemporalResult, type Stamp, type ClaimTime, type CalendarWindow, type ElapsedValue } from './contracts.ts';

type Parts = NonNullable<ReturnType<typeof parseRFC3339Parts>>;
export function temporalInstant(value: unknown): TemporalResult<number> {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) return refuse('invalid-time', 'an explicit RFC 3339 instant with millisecond-or-coarser precision is required');
  const parts = parseRFC3339Parts(value), epoch = getEpochOfDateTimeRFC3339(value);
  if (!parts || parts.seconds >= 60 || epoch === undefined || !Number.isSafeInteger(epoch)) return refuse('invalid-time', 'invalid calendar, offset, leap second or precision');
  return success(epoch);
}
/** Rendering an already validated epoch; no current clock or date arithmetic. */
export function temporalIso(epoch: number): string { return new Date(epoch).toISOString(); }
export function temporalStamp(at: string, options: Partial<Omit<Stamp, 'at'>> = {}): TemporalResult<Stamp> {
  const instant = temporalInstant(at); if (instant.status !== 'success') return instant;
  const parts = parseRFC3339Parts(at)!;
  const stamp: Stamp = { at, raw: at, precision: 'millisecond', offsetMinutes: parts.offset!, provenance: 'host-asserted', ...options };
  const shape = checkTemporal<Stamp>('stamp', stamp); if (shape.status !== 'success') return shape;
  if (stamp.offsetMinutes !== parts.offset) return refuse('invalid-time', 'stamp offset does not match its explicit instant');
  if (!aligned(at, stamp.precision)) return refuse('invalid-time', 'stamp is not aligned with its declared precision');
  return success(stamp);
}
function aligned(at: string, precision: Stamp['precision']): boolean {
  const p = parseRFC3339Parts(at); if (!p) return false;
  if (precision === 'millisecond') return true;
  if (precision === 'second') return Number.isInteger(p.seconds);
  if (p.seconds !== 0) return false;
  if (precision === 'minute') return true;
  if (p.hours !== 0 || p.minutes !== 0) return false;
  if (precision === 'day') return true;
  if (p.day !== 1) return false;
  return precision === 'month' || p.month === 1;
}
export function checkClaimTime(value: unknown): TemporalResult<ClaimTime> {
  const shape = checkTemporal<ClaimTime>('claimTime', value);
  if (shape.status !== 'success') return refuse('invalid-time', shape.detail);
  const time = shape.value;
  if (time.kind === 'unknown') return shape;
  const from = temporalInstant(time.kind === 'point' ? time.at : time.from); if (from.status !== 'success') return from;
  if (!aligned(time.kind === 'point' ? time.at : time.from, time.precision)) return refuse('invalid-time', 'bound contradicts its precision');
  if (time.kind === 'point') return shape;
  const end = time.kind === 'period' ? time.until : time.until.kind === 'at' ? time.until.at : null;
  if (end !== null) {
    const until = temporalInstant(end); if (until.status !== 'success') return until;
    if (until.value <= from.value) return refuse('invalid-time', 'state/period bounds must be increasing; use a point for an event instant');
    if (!aligned(end, time.precision)) return refuse('invalid-time', 'end contradicts its precision');
    if (time.kind === 'period') {
      const expected = epochOfRFC3339Parts(addToParts(parseRFC3339Parts(time.from)!, 1, time.precision) as Parts);
      if (until.value !== expected) return refuse('invalid-time', 'uncertainty period must cover exactly its declared calendar unit');
    }
  }
  return shape;
}
/** Coarse event time denotes uncertainty, never an invented exact instant. */
export function claimContains(time: ClaimTime, at: number): TemporalResult<boolean> {
  if (!Number.isSafeInteger(at)) return refuse('invalid-time', 'membership needs a finite integer epoch');
  const checked = checkClaimTime(time); if (checked.status !== 'success') return checked;
  if (time.kind === 'unknown' || time.kind === 'period' || (time.kind === 'state' && time.until.kind === 'unknown')) return refuse('unknown-validity', 'exact membership is not evidenced');
  if (time.kind === 'point') {
    if (time.precision !== 'millisecond') return refuse('unknown-validity', 'event precision cannot establish an exact instant');
    return success(getEpochOfDateTimeRFC3339(time.at)! === at);
  }
  const from = getEpochOfDateTimeRFC3339(time.from)!;
  if (time.until.kind === 'unknown') return refuse('unknown-validity', 'state end is unknown');
  return success(time.until.kind === 'open' ? at >= from : containsInstant({ start: from, end: getEpochOfDateTimeRFC3339(time.until.at)! }, at));
}
export function claimOverlaps(time: ClaimTime, from: number, until: number): TemporalResult<boolean> {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(until) || from >= until) return refuse('invalid-time', 'overlap needs increasing finite integer epochs');
  const checked = checkClaimTime(time); if (checked.status !== 'success') return checked;
  if (time.kind === 'unknown' || (time.kind === 'state' && time.until.kind === 'unknown')) return refuse('unknown-validity', 'event or validity window is unknown');
  if (time.kind === 'point') {
    const at = getEpochOfDateTimeRFC3339(time.at)!;
    if (time.precision === 'millisecond') return success(containsInstant({ start: from, end: until }, at));
    const end = epochOfRFC3339Parts(addToParts(parseRFC3339Parts(time.at)!, 1, time.precision) as Parts);
    // A complete uncertainty bucket inside the query is definitely eligible; partial overlap cannot establish truth.
    if (from <= at && end <= until) return success(true);
    return overlapsInterval({ start: at, end }, { start: from, end: until }) ? refuse('unknown-validity', 'query cuts through event precision') : success(false);
  }
  const start = getEpochOfDateTimeRFC3339(time.from)!;
  if (time.kind === 'period') {
    const end = getEpochOfDateTimeRFC3339(time.until)!;
    if (from <= start && end <= until) return success(true);
    return overlapsInterval({ start, end }, { start: from, end: until }) ? refuse('unknown-validity', 'query cuts through event uncertainty') : success(false);
  }
  if (time.until.kind === 'unknown') return refuse('unknown-validity', 'state end is unknown');
  return success(time.until.kind === 'open' ? until > start : overlapsInterval({ start, end: getEpochOfDateTimeRFC3339(time.until.at)! }, { start: from, end: until }));
}
export function relativeTemporalWindow(operand: string, anchor?: Stamp | null): TemporalResult<CalendarWindow> {
  if (!['yesterday', 'previous-week', 'previous-month', 'previous-year'].includes(operand)) return refuse('invalid-time', 'unsupported relative calendar operand');
  if (!anchor) return refuse('unanchored-relative', 'relative calendar requests need an explicit anchor');
  const checked = temporalStamp(anchor.at, anchor); if (checked.status !== 'success') return checked;
  const unit = operand === 'yesterday' ? 'day' : operand.slice('previous-'.length);
  if ((anchor.precision === 'year' && unit !== 'year') || (anchor.precision === 'month' && ['day', 'week'].includes(unit))) return refuse('unknown-validity', 'anchor is too imprecise for this operation');
  const end = startOfParts(parseRFC3339Parts(anchor.at)!, unit) as Parts;
  const begin = addToParts(end, -1, unit) as Parts;
  return success({ from: temporalIso(epochOfRFC3339Parts(begin)), until: temporalIso(epochOfRFC3339Parts(end)), precision: unit === 'week' ? 'day' : unit as CalendarWindow['precision'] });
}
export function temporalElapsed(start: string, end: string, unit: ElapsedValue['unit'], offsetMinutes?: number): TemporalResult<ElapsedValue> {
  const left = temporalInstant(start), right = temporalInstant(end);
  if (left.status !== 'success') return left; if (right.status !== 'success') return right;
  if (right.value < left.value) return refuse('invalid-time', 'elapsed endpoints are reversed');
  if (!['hour', 'day', 'week', 'month', 'year'].includes(unit)) return refuse('invalid-time', 'unsupported elapsed unit');
  if (unit === 'hour') return success({ whole: Math.floor((right.value - left.value) / 3600000), remainder: (right.value - left.value) % 3600000, unit, remainderUnit: 'millisecond' });
  const offset = offsetMinutes ?? parseRFC3339Parts(start)!.offset!;
  if (!Number.isInteger(offset) || Math.abs(offset) > 1439) return refuse('invalid-time', 'invalid fixed calendar offset');
  const a = partsFromEpoch(left.value, offset) as Parts, b = partsFromEpoch(right.value, offset) as Parts;
  const civil = (p: Parts) => daysFromCivil(p.year, p.month, p.day);
  const days = civil(b) - civil(a);
  if (unit === 'day' || unit === 'week') return success({ whole: unit === 'day' ? days : Math.floor(days / 7), remainder: unit === 'day' ? 0 : days % 7, unit, remainderUnit: 'day' });
  let whole = unit === 'year' ? b.year - a.year : (b.year - a.year) * 12 + b.month - a.month;
  let boundary = addToParts(a, whole, unit) as Parts;
  if (epochOfRFC3339Parts(boundary) > right.value) { whole--; boundary = addToParts(a, whole, unit) as Parts; }
  return success({ whole, remainder: civil(b) - civil(boundary), unit, remainderUnit: 'day' });
}
