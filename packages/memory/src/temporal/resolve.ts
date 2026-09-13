/** Deterministic calendar resolution over Jaren clocks and locale names. */
import { resolveClock, type ZoneProvider } from '@jarenjs/core/series';
import { parseRFC3339Parts, epochOfRFC3339Parts } from '@jarenjs/core/dates';
import { compileDateLocale } from '@jarenjs/locales/dates';
import { checkTemporal, refuse, success, type Stamp, type TemporalQuery, type QueryProposal, type RelativeOperand, type TemporalResult, type CalendarWindow } from './contracts.ts';
import { temporalInstant, temporalIso, relativeTemporalWindow } from './time.ts';
export const temporalEnglishNames = compileDateLocale().names;
export interface TemporalClockOptions { zone?: string; provider?: ZoneProvider; disambiguation?: 'reject' | 'earlier' | 'later' }
export function resolveTemporalWindow(operand: string, anchor?: Stamp | null, options: TemporalClockOptions = {}): TemporalResult<CalendarWindow> {
  if (!anchor) return refuse('unanchored-relative', 'relative calendar operation needs an explicit host anchor');
  if (!['yesterday', 'previous-week', 'previous-month', 'previous-year'].includes(operand)) return refuse('invalid-time', 'unsupported-calendar-operand: seasons and numeric date conventions need a host definition');
  if (!options.zone) return relativeTemporalWindow(operand, anchor);
  try {
    const instant = temporalInstant(anchor.at); if (instant.status !== 'success') return instant;
    const clock = resolveClock(options), local = clock.partsAt(instant.value);
    // Represent the wall fields on UTC only to reuse the calendar kernel; convert both resulting bounds through the supplied clock.
    const wall = temporalIso(epochOfRFC3339Parts({ ...local, offset: 0 }));
    const resolved = relativeTemporalWindow(operand, { ...anchor, at: wall, offsetMinutes: 0 });
    if (resolved.status !== 'success') return resolved;
    const from = clock.epochOf(parseRFC3339Parts(resolved.value.from)), until = clock.epochOf(parseRFC3339Parts(resolved.value.until));
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(until) || from >= until) return refuse('invalid-time', 'zone provider returned invalid calendar boundaries');
    return success({ ...resolved.value, from: temporalIso(from), until: temporalIso(until) });
  } catch (cause) { return refuse('invalid-time', `unsupported-zone-or-clock: ${String(cause)}`); }
}
function splitSurrogate(text: string, at: number) { return at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]); }
export function resolveTemporalProposal(value: unknown, query: string, anchor?: Stamp | null, options: TemporalClockOptions = {}): TemporalResult<Pick<TemporalQuery, 'subject' | 'series' | 'operation'>> {
  const checked = checkTemporal<QueryProposal>('queryProposal', value); if (checked.status !== 'success') return checked;
  const p = checked.value;
  if (p.citations.some(s => s.start >= s.end || s.end > query.length || query.slice(s.start, s.end) !== s.quote || splitSurrogate(query, s.start) || splitSurrogate(query, s.end))) return refuse('identity-mismatch', 'query citation is not an exact UTF-16 span');
  if (p.operation.kind === 'none') return { status: 'fallback', reason: 'ordinary-query', detail: 'ordinary-query: resolver bypassed the temporal lane' };
  if (p.operation.kind === 'relative') {
    const window = resolveTemporalWindow(p.operation.operand, anchor, options); if (window.status !== 'success') return window;
    return success({ subject: p.subject, series: p.series, operation: { kind: 'overlaps', from: window.value.from, until: window.value.until } });
  }
  const times = p.operation.kind === 'at' || p.operation.kind === 'as-of' ? [p.operation.at] : p.operation.kind === 'overlaps' ? [p.operation.from, p.operation.until] : [];
  for (const time of times) { const r = temporalInstant(time); if (r.status !== 'success') return r; }
  if (p.operation.kind === 'overlaps' && parseRFC3339Parts(p.operation.from) && epochOfRFC3339Parts(parseRFC3339Parts(p.operation.from)!) >= epochOfRFC3339Parts(parseRFC3339Parts(p.operation.until)!)) return refuse('invalid-time', 'query range must be increasing and half-open');
  return success({ subject: p.subject, series: p.series, operation: p.operation });
}
export type { RelativeOperand };
