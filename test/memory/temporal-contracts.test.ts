import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTemporalShape } from '@tangleai/core/schemas/temporal';
import { temporalInstant, temporalStamp, checkClaimTime, claimContains, claimOverlaps, relativeTemporalWindow, temporalElapsed,
  createSourceOccurrence, validateSourceOccurrence, citeSource, validateSourceSpan, createTemporalClaim, temporalIdentity } from '@tangleai/memory/temporal';

test('temporal contracts retain strict calendars, precision and offset equality', () => {
  assert.equal(temporalInstant('2024-02-29T00:00:00Z').status, 'success');
  for (const value of ['2023-02-29T00:00:00Z', '2024-02-29', '2024-02-29T00:00:60Z', '2024-02-29T00:00:00.0001Z']) assert.equal(temporalInstant(value).status, 'refused');
  assert.deepEqual(temporalInstant('2024-03-01T00:00:00Z'), temporalInstant('2024-03-01T02:00:00+02:00'));
  assert.equal(temporalStamp('2024-03-15T00:00:00Z', { precision: 'month' }).status, 'refused');
  assert.equal(temporalStamp('2024-03-01T00:00:00Z', { offsetMinutes: 60 }).status, 'refused');
  assert.equal(validateTemporalShape('claimTime', { kind: 'unknown', invented: true }).valid, false);
});
test('state bounds and uncertain event periods do not fabricate exact instants', () => {
  const state = { kind: 'state' as const, from: '1970-01-01T00:00:00.000Z', until: { kind: 'at' as const, at: '1970-01-01T00:00:00.010Z' }, precision: 'millisecond' as const };
  assert.deepEqual(claimContains(state, 0), { status: 'success', value: true });
  assert.deepEqual(claimContains(state, 10), { status: 'success', value: false });
  assert.equal(checkClaimTime({ ...state, from: state.until.at }).status, 'refused');
  assert.deepEqual(claimContains({ ...state, until: { kind: 'open' } }, 100), { status: 'success', value: true });
  assert.equal(claimContains({ ...state, until: { kind: 'unknown' } }, 0).status, 'refused');
  const period = { kind: 'period' as const, from: '2024-02-01T00:00:00Z', until: '2024-03-01T00:00:00Z', precision: 'month' as const };
  assert.equal(claimContains(period, 1706745600000).status, 'refused');
  assert.deepEqual(claimOverlaps(period, 1706745600000, 1709251200000), { status: 'success', value: true });
  assert.equal(claimOverlaps(period, 1706745600001, 1709251200000).status, 'refused');
  assert.equal(claimContains(state, NaN).status, 'refused');
  assert.equal(claimOverlaps(state, 10, 0).status, 'refused');
});
test('calendar operations use explicit anchors and independently known arithmetic', () => {
  const anchor = temporalStamp('2024-03-15T12:00:00Z'); assert.equal(anchor.status, 'success'); if (anchor.status !== 'success') return;
  assert.deepEqual(relativeTemporalWindow('previous-month', anchor.value), { status: 'success', value: { from: '2024-02-01T00:00:00.000Z', until: '2024-03-01T00:00:00.000Z', precision: 'month' } });
  assert.equal(relativeTemporalWindow('yesterday').status, 'refused');
  assert.deepEqual(temporalElapsed('2023-01-19T00:00:00Z', '2023-04-10T00:00:00Z', 'week'), { status: 'success', value: { whole: 11, remainder: 4, unit: 'week', remainderUnit: 'day' } });
  assert.deepEqual(temporalElapsed('2024-01-31T00:00:00Z', '2024-02-29T00:00:00Z', 'month'), { status: 'success', value: { whole: 1, remainder: 0, unit: 'month', remainderUnit: 'day' } });
});
test('occurrence hashes and citations bind immutable source text, scope and code-point boundaries', async () => {
  const stamp = temporalStamp('2024-03-01T00:00:00Z'); if (stamp.status !== 'success') throw Error(stamp.detail);
  const made = await createSourceOccurrence({ scope: 'one', sessionOrdinal: 0, turnOrdinal: 0, role: 'host', text: 'A 😀 rehearsal.', sourceLocator: 'host:one', observedAt: stamp.value, knownAt: stamp.value.at });
  if (made.status !== 'success') throw Error(made.detail);
  const source = made.value;
  assert.equal((await validateSourceOccurrence({ ...source, text: 'tampered' })).status, 'refused');
  assert.equal(citeSource(source, 2, 3).status, 'refused');
  const span = citeSource(source, 2, 4); if (span.status !== 'success') throw Error(span.detail);
  assert.equal(span.value.quote, '😀');
  assert.equal(validateSourceSpan(span.value, source, 'foreign').status, 'refused');
  assert.equal(validateSourceSpan({ ...span.value, sourceHash: 'f'.repeat(64) }, source, 'one').status, 'refused');
  assert.equal(validateSourceSpan({ ...span.value, quote: 'x' }, source, 'one').status, 'refused');
  const claim = await createTemporalClaim({ scope: 'one', series: { subject: 'alex', key: 'rehearsal' }, value: 'rehearsal', time: { kind: 'unknown' }, status: 'unknown', citations: [span.value], derivation: { method: 'host-asserted', identity: 'host' } }, [source]);
  assert.equal(claim.status, 'success');
  assert.equal(source.sourceHash, await temporalIdentity(source.text));
});
