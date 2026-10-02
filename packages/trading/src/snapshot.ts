/** Independently validate and admit injected provider output before it becomes cited context. */
import { equalsJson } from '@jarenjs/core/object';
import { toEpoch } from '@jarenjs/core/series';
import { immutableTradingJson } from './identity.ts';
import { validateTradingRecord, createTradingRecord } from './records.ts';
import { validateTradingShape } from './schema.ts';
import { admit, cutoffFor, sessionIndex, snapshotBarStaleness } from './time.ts';
import { providerOwnsObservation } from './providers.ts';
import { tradingIssue, tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingProviders, TradingProviderOutcome } from './providers.ts';
import type { TradingRunManifest, MarketSession, PortfolioSnapshot, MarketSnapshot, Observation, TradingIssue, TradingProviderName } from './contracts.gen.ts';

export interface TradingSnapshotInput { manifest: TradingRunManifest; asset: string; session: MarketSession; portfolio: PortfolioSnapshot; providers: TradingProviders; }
export interface TradingSnapshotBundle { snapshot: MarketSnapshot; observations: Observation[]; sessions: MarketSession[]; }

async function capture<T>(read: () => Promise<TradingProviderOutcome<T>>): Promise<TradingProviderOutcome<T>> {
  try { return await read(); }
  catch (cause) { return { outcome: 'failed', code: 'TTRD1007', reason: 'Injected provider failed', cause: tradingIssue('TTRD1007', '', 'Provider call threw', cause) }; }
}

export async function buildSnapshot(input: TradingSnapshotInput): Promise<TradingOutcome<TradingSnapshotBundle>> {
  let frozen: Omit<TradingSnapshotInput, 'providers'>;
  try { frozen = immutableTradingJson({ manifest: input.manifest, asset: input.asset, session: input.session, portfolio: input.portfolio }); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Snapshot inputs must be finite JSON', cause); }
  const { manifest, asset, session, portfolio } = frozen, providers = input.providers;
  for (const record of [manifest, session, portfolio]) { const valid = await validateTradingRecord(record); if (!valid.valid) return valid; }
  if (!manifest.assets.includes(asset) || portfolio.manifestId !== manifest.id) return tradingRefuse('TTRD1002', '/asset', 'Snapshot inputs cross run or asset boundaries');
  const cutoff = cutoffFor(session, manifest); if (!cutoff.valid) return cutoff;
  const calendarResult = validateTradingShape<TradingProviderOutcome<MarketSession[]>>('tradingCalendarProviderResult', await capture(() => providers.calendar.sessions(manifest.sessionRange, cutoff.value)));
  if (!calendarResult.valid) return tradingRefuse('TTRD1007', '/calendar', 'Invalid calendar provider outcome', calendarResult.issues[0]);
  const calendar = calendarResult.value;
  if (calendar.outcome !== 'ok') return tradingRefuse('TTRD1007', '/calendar', calendar.reason, calendar.cause);
  if (calendar.refused.length) return tradingRefuse('TTRD1003', '/calendar', 'Calendar revision is unavailable at the decision cutoff', calendar.refused[0].issue);
  const indexed = await sessionIndex(calendar.value); if (!indexed.valid) return indexed;
  const sessions = [...indexed.value.sessions], index = sessions.findIndex(s => s.key === session.key);
  if (index < 0 || !equalsJson(sessions[index], session) || sessions[0]?.key !== manifest.sessionRange.first || sessions.at(-1)?.key !== manifest.sessionRange.last)
    return tradingRefuse('TTRD1003', '/session', 'Calendar does not reproduce the declared complete run range and decision session');
  if (portfolio.asOfSessionId !== null) {
    const at = sessions.findIndex(s => s.key === portfolio.asOfSessionId);
    if (at < 0 || at > index) return tradingRefuse('TTRD1003', '/portfolio', 'A decision cannot read a future or unknown portfolio session');
  }
  const range = { from: sessions[0].openAt, to: cutoff.value };
  const reads: Array<[TradingProviderName, () => Promise<TradingProviderOutcome<Observation[]>>]> = [
    ['market', () => providers.market.bars(asset, range, cutoff.value)], ['fundamentals', () => providers.fundamentals.facts(asset, cutoff.value)],
    ['news', () => providers.news.items(asset, range, cutoff.value)], ['social', () => providers.social.items(asset, range, cutoff.value)],
    ['insiders', () => providers.insiders.events(asset, cutoff.value)], ['profiles', () => providers.profiles.company(asset, cutoff.value)],
  ];
  const observations: Observation[] = [], refused = new Map<string, { id: string; reason: 'TTRD1003' }>(), providerErrors: TradingIssue[] = [];
  for (const [provider, read] of reads) {
    const shape = validateTradingShape<TradingProviderOutcome<Observation[]>>('tradingObservationProviderResult', await capture(read));
    if (!shape.valid) { providerErrors.push(tradingIssue('TTRD1007', `/providers/${provider}`, 'Invalid provider outcome', shape.issues[0])); continue; }
    const response = shape.value;
    if (response.outcome !== 'ok') { providerErrors.push(tradingIssue('TTRD1007', `/providers/${provider}`, response.reason, response.cause)); continue; }
    if (response.value.some(o => o.asset !== asset || o.manifestId !== manifest.id || !providerOwnsObservation(provider, o)) || response.refused.some(r => r.issue.code !== 'TTRD1003')) {
      providerErrors.push(tradingIssue('TTRD1007', `/providers/${provider}`, 'Provider output violates its scope or refusal protocol', tradingIssue('TTRD1004', '/value', 'Foreign observation or inconsistent refusal'))); continue;
    }
    const admitted = await admit(response.value, cutoff.value);
    if (!admitted.valid) { providerErrors.push(tradingIssue('TTRD1007', `/providers/${provider}`, 'Invalid observation content', admitted.issues[0])); continue; }
    const withheld = [...response.refused, ...admitted.value.refused];
    if (admitted.value.admitted.some(o => withheld.some(r => r.id === o.id))) { providerErrors.push(tradingIssue('TTRD1007', `/providers/${provider}`, 'Provider both admits and refuses one observation')); continue; }
    observations.push(...admitted.value.admitted);
    for (const record of withheld) refused.set(record.id, { id: record.id, reason: 'TTRD1003' });
  }
  observations.sort((a, b) => toEpoch(a.availableAt) - toEpoch(b.availableAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (new Set(observations.map(o => o.id)).size !== observations.length) return tradingRefuse('TTRD1004', '/observations', 'Provider outputs repeat evidence identities');
  const staleness = snapshotBarStaleness(sessions, session.key, observations); if (!staleness.valid) return staleness;
  const snapshot = await createTradingRecord('snapshot', { manifestId: manifest.id, asset, sessionId: session.key, cutoffAt: cutoff.value, observationIds: observations.map(o => o.id),
    refused: [...refused.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), providerErrors, portfolioId: portfolio.id, staleness: staleness.value });
  return snapshot.valid ? { valid: true, value: immutableTradingJson({ snapshot: snapshot.value, observations, sessions }) } : snapshot;
}
