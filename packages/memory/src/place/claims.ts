/** Location assertions reuse the temporal identity, citation and validity owners. */
import { createTemporalClaim, validateSourceOccurrence } from '../temporal/evidence.ts';
import { checkTemporal, type TemporalClaim, type SourceOccurrence, type SourceSpan, type ClaimTime } from '../temporal/contracts.ts';
import { fromTemporal, placeRefuse, placeSuccess, type GazetteerEntry, type PlaceGeometry, type PlaceResult } from './contracts.ts';
import { checkGazetteerEntry, type GazetteerView } from './gazetteer.ts';

export interface PlaceClaimInput {
  scope: string; subject: string; entry: GazetteerEntry; kind: 'state' | 'event';
  at: string; until: string | null; source: SourceOccurrence; span: SourceSpan;
  derivation: TemporalClaim['derivation'];
  /** Defaults to minute uncertainty. Exact host indices must explicitly declare millisecond precision. */
  precision?: Extract<ClaimTime, { kind: 'state' }>['precision'];
}
export async function createPlaceClaim(input: PlaceClaimInput): Promise<PlaceResult<TemporalClaim>> {
  try {
    if (!input || typeof input.subject !== 'string' || !input.subject.length || !['state', 'event'].includes(input.kind) ||
      input.until !== null && typeof input.until !== 'string' || input.kind === 'event' && input.until !== null) {
      return placeRefuse('TPLC1001', 'a place claim needs a subject, state/event kind and explicit end; an event has no end');
    }
    const entry = checkGazetteerEntry(input.entry); if (entry.status !== 'success') return entry;
    const source = await validateSourceOccurrence(input.source); if (source.status !== 'success') return fromTemporal(source);
    const precision = input.precision ?? 'minute';
    const time = input.kind === 'state' ? { kind: 'state' as const, from: input.at,
      until: input.until === null ? { kind: 'unknown' as const } : { kind: 'at' as const, at: input.until }, precision }
      : { kind: 'point' as const, at: input.at, precision };
    const claim = await createTemporalClaim({ scope: input.scope, series: { subject: input.subject, key: 'location' },
      value: entry.value.id, time, status: 'accepted', citations: [input.span], derivation: input.derivation }, [source.value]);
    return claim.status === 'success' ? placeSuccess(claim.value) : fromTemporal(claim);
  } catch (cause) { return placeRefuse('TPLC1001', `invalid place claim input: ${cause instanceof Error ? cause.message : String(cause)}`); }
}
/** Resolves geometry only; temporal eligibility and evidence validation remain the caller's responsibility. */
export function placeClaimGeometry(claim: TemporalClaim, gazetteer: GazetteerView): PlaceResult<PlaceGeometry> {
  const checked = checkTemporal<TemporalClaim>('temporalClaim', claim); if (checked.status !== 'success') return fromTemporal(checked);
  if (checked.value.series.key !== 'location') return placeRefuse('TPLC1001', 'geometry requires a location-series claim');
  const entry = gazetteer.byId(checked.value.value);
  return entry.status === 'success' ? placeSuccess(entry.value.geometry) : entry;
}
