/** Translate independent host assertions to public runtime inputs; expected results never enter here. */
import { addToParts, parseRFC3339Parts, epochOfRFC3339Parts } from '@jarenjs/core/dates';
import { createSourceOccurrence, createTemporalClaim, citeSource, createTemporalProjection, temporalStamp, temporalIso,
  success, type TemporalResult, type TemporalBundle, type SourceOccurrence, type TemporalClaim, type ClaimTime, type TemporalProjectionInput } from '@tangleai/memory/temporal';
import type { TemporalRuntimeScenario } from './temporal-conformance.ts';

export interface BuiltTemporalFixture { bundle: TemporalBundle; sourceNames: Record<string, string>; claimNames: Record<string, string> }
export function fixtureTime(value: unknown): string { return typeof value === 'number' ? temporalIso(value) : typeof value === 'string' ? value : ''; }
export function completeTemporalFixtureInput(s: TemporalRuntimeScenario): TemporalRuntimeScenario {
  if (s.action !== 'elapsed' || s.sources.length) return s;
  const points = [{ id: 'start', claimId: 'begin', series: 'recovery', at: String(s.input.start) }, { id: 'end', claimId: 'finish', series: 'jog', at: String(s.input.end) }];
  return { ...s, sources: points.map(p => ({ id: p.id, text: `Alex ${p.series} occurred at ${p.at}.`, observed: p.at })),
    claims: points.map(p => ({ id: p.claimId, source: p.id, subject: 'alex', series: p.series, value: p.series, kind: 'event', from: p.at,
      precision: s.input.precision === 'month' ? 'month' : 'day' })) };
}
export async function buildTemporalFixture(scenario: TemporalRuntimeScenario): Promise<TemporalResult<BuiltTemporalFixture>> {
  const sources: SourceOccurrence[] = [], claims: TemporalClaim[] = [];
  const sourceNames: Record<string, string> = {}, claimNames: Record<string, string> = {};
  for (const [index, s] of scenario.sources.entries()) {
    const observed = temporalStamp(fixtureTime(s.observed)); if (observed.status !== 'success') return observed;
    const source = await createSourceOccurrence({ scope: s.scope ?? 'fixture-scope', sessionOrdinal: s.sessionOrdinal ?? index, turnOrdinal: s.turnOrdinal ?? 0,
      role: 'host', text: s.text, observedAt: observed.value, knownAt: fixtureTime(s.knownAt ?? s.observed), sourceLocator: scenario.input.sameSessionLocator ? 'repeated-locator' : `fixture:${s.id}` });
    if (source.status !== 'success') return source;
    sources.push(source.value); sourceNames[source.value.id] = s.id;
  }
  for (const c of scenario.claims) {
    const source = sources.find(s => sourceNames[s.id] === c.source)!;
    const span = scenario.input.splitSurrogate ? citeSource(source, 2, 3) : citeSource(source);
    if (span.status !== 'success') return span;
    let time: ClaimTime;
    const precision = c.precision ?? 'millisecond';
    if (c.kind === 'unknown') time = { kind: 'unknown' };
    else if (c.kind === 'state') time = { kind: 'state', from: fixtureTime(c.from), until: c.until === null ? { kind: 'open' } : c.until === undefined ? { kind: 'unknown' } : { kind: 'at', at: fixtureTime(c.until) }, precision: precision as 'millisecond' | 'minute' | 'day' };
    else if (precision === 'month' || precision === 'year') {
      const from = fixtureTime(c.from), parts = parseRFC3339Parts(from)!;
      time = { kind: 'period', from, until: temporalIso(epochOfRFC3339Parts(addToParts(parts, 1, precision) as typeof parts)), precision };
    } else time = { kind: 'point', at: fixtureTime(c.from), precision };
    const claim = await createTemporalClaim({ scope: scenario.input.foreignScope ? 'foreign-scope' : 'fixture-scope', series: { subject: c.subject, key: c.series }, value: c.value,
      time, status: c.kind === 'unknown' ? 'unknown' : 'accepted', citations: [span.value], derivation: { method: 'host-asserted', identity: 'independent-fixture-v1' } }, sources);
    if (claim.status !== 'success') return claim;
    claims.push(claim.value); claimNames[claim.value.id] = c.id;
  }
  const bundle = await createTemporalProjection({ scope: 'fixture-scope', sources, claims,
    sourceIdentity: 'tangle-authored-fixture-v1', viewIdentity: 'fixture-view-v1', policyIdentity: 'fixture-policy-v1', modelIdentity: 'host-asserted', promptIdentity: 'none',
    knowledge: scenario.input.profile === 'strict-as-of' ? { mode: 'strict-as-of', cutoff: fixtureTime(scenario.input.cutoff) } : { mode: 'provided-history' },
    embeddedBy: { model: 'fixture-2', dims: 2 }, embeddings: sources.map(s => ({ sourceId: s.id, vector: [1, 0] })), complete: true });
  return bundle.status === 'success' ? success({ bundle: bundle.value, sourceNames, claimNames }) : bundle;
}
export function rebuildTemporalFixture(bundle: TemporalBundle, changes: Partial<TemporalProjectionInput>) {
  const { versionId: _v, contractIdentity: _c, occurrenceIds: _o, claimIds: _i, ...identity } = bundle.projection;
  return createTemporalProjection({ ...identity, sources: bundle.sources, claims: bundle.claims, ...changes });
}
