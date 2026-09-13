/** Deterministic display over the verified result, with Jaren-owned calendar names. */
import { compileDateFormat, parseRFC3339Parts } from '@jarenjs/core/dates';
import { temporalEnglishNames } from './resolve.ts';
import type { TemporalAnswer, ElapsedValue } from './contracts.ts';
const dates = {
  year: compileDateFormat('yyyy', temporalEnglishNames), month: compileDateFormat('MMMM yyyy', temporalEnglishNames),
  day: compileDateFormat('d MMMM yyyy', temporalEnglishNames), minute: compileDateFormat('d MMMM yyyy HH:mm XXX', temporalEnglishNames),
  second: compileDateFormat('d MMMM yyyy HH:mm:ss XXX', temporalEnglishNames), millisecond: compileDateFormat('d MMMM yyyy HH:mm:ss.SSS XXX', temporalEnglishNames),
};
export function renderTemporalAnswer(answer: TemporalAnswer): string {
  const citations = answer.citations.map(s => `[${s.sourceId}:${s.start}-${s.end}]`).join(' ');
  if (answer.operation === 'elapsed') {
    const value = answer.value as unknown as ElapsedValue;
    return `${value.whole} ${value.unit}${value.whole === 1 ? '' : 's'} and ${value.remainder} ${value.remainderUnit}${value.remainder === 1 ? '' : 's'}. ${citations}`;
  }
  const byId = new Map(answer.recall.claims.map(claim => [claim.id, claim]));
  const claims = answer.operation === 'order' ? (answer.value as { claimId: string }[]).map(row => byId.get(row.claimId)!) : answer.recall.claims;
  return claims.map(claim => {
    const time = claim.time;
    if (time.kind === 'unknown') return `${claim.series.subject}: ${claim.value} (time unknown)`;
    const format = dates[time.precision], at = format(parseRFC3339Parts(time.kind === 'point' ? time.at : time.from)!);
    const label = time.kind === 'state' ? `from ${at}, ${time.until.kind === 'at' ? `until ${format(parseRFC3339Parts(time.until.at)!)}` : time.until.kind === 'open' ? 'open end' : 'end unknown'}` : time.kind === 'period' ? `within ${at}` : at;
    return `${claim.series.subject}: ${claim.value} (${label})`;
  }).join('; ') + `. ${citations}`;
}
