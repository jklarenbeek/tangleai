/** Calendar and admission policy over the suite's interval and as-of kernels. */
import { createIntervalIndex, asOfJoin, toEpoch } from '@jarenjs/core/series';
import { immutableTradingJson } from './identity.ts';
import { validateTradingRecord } from './records.ts';
import { tradingIssue, tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { MarketSession, Observation, BarObservation, TradingRunManifest, TradingIssue } from './contracts.gen.ts';

export interface TradingSessionIndex {
  readonly sessions: readonly MarketSession[];
  readonly intervals: ReturnType<typeof createIntervalIndex>;
}
export async function sessionIndex(input: readonly MarketSession[]): Promise<TradingOutcome<TradingSessionIndex>> {
  try { input = immutableTradingJson(input); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Sessions must be finite JSON', cause); }
  const sessions: MarketSession[] = [];
  for (const [i, value] of input.entries()) {
    const valid = await validateTradingRecord(value);
    if (!valid.valid) return { valid: false, issues: valid.issues.map(issue => ({ ...issue, path: `/${i}${issue.path}` })) };
    if (valid.value.kind !== 'session') return tradingRefuse('TTRD1001', `/${i}/kind`, 'Expected a market session');
    sessions.push(valid.value);
  }
  if (new Set(sessions.map(s => s.key)).size !== sessions.length) return tradingRefuse('TTRD1001', '/key', 'Session keys must be distinct');
  sessions.sort((a, b) => toEpoch(a.openAt) - toEpoch(b.openAt));
  for (const [i, session] of sessions.entries()) {
    if (session.prev !== (sessions[i - 1]?.key ?? null) || session.next !== (sessions[i + 1]?.key ?? null))
      return tradingRefuse('TTRD1001', `/${i}/next`, 'Calendar links must describe the supplied complete session range');
    if (i && (session.manifestId !== sessions[0].manifestId || session.calendar !== sessions[0].calendar || toEpoch(session.openAt) <= toEpoch(sessions[i - 1].closeAt)))
      return tradingRefuse('TTRD1001', `/${i}/openAt`, 'Sessions must be nonoverlapping and belong to one manifest/calendar');
  }
  const retained = immutableTradingJson(sessions);
  try { return { valid: true, value: Object.freeze({ sessions: retained, intervals: createIntervalIndex(retained, { start: 'openAt', end: 'closeAt' }) }) }; }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Invalid calendar intervals', cause); }
}
export function sessionAt(index: TradingSessionIndex, at: string): TradingOutcome<MarketSession> {
  try {
    const found = index.intervals.at(at) as MarketSession[];
    if (found.length !== 1) return tradingRefuse('TTRD1003', '/at', 'Instant is outside one open session');
    return { valid: true, value: found[0] };
  } catch (cause) { return tradingRefuse('TTRD1001', '/at', 'Invalid session lookup instant', cause); }
}
export function nextSession(index: TradingSessionIndex, key: string): TradingOutcome<MarketSession | null> {
  const session = index.sessions.find(s => s.key === key);
  if (!session) return tradingRefuse('TTRD1003', '/sessionId', 'Unknown calendar session');
  return { valid: true, value: session.next === null ? null : index.sessions.find(s => s.key === session.next)! };
}
export function cutoffFor(session: MarketSession, manifest: TradingRunManifest): TradingOutcome<string> {
  if (session.manifestId !== manifest.id || session.calendar !== manifest.calendar) return tradingRefuse('TTRD1003', '/sessionId', 'Session does not belong to the run');
  if (manifest.decisionCutoff !== 'session-close') return tradingRefuse('TTRD1003', '/decisionCutoff', 'Unsupported cutoff');
  return { valid: true, value: session.closeAt };
}
export interface TradingAdmission {
  admitted: Observation[];
  refused: Array<{ id: string; reason: 'TTRD1003'; issue: TradingIssue }>;
}
export async function admit(input: readonly Observation[], cutoffAt: string): Promise<TradingOutcome<TradingAdmission>> {
  try { input = immutableTradingJson(input); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Observations must be finite JSON', cause); }
  let cutoff: number;
  try { cutoff = toEpoch(cutoffAt); } catch (cause) { return tradingRefuse('TTRD1001', '/cutoffAt', 'Invalid cutoff instant', cause); }
  const admitted: Observation[] = [], refused: TradingAdmission['refused'] = [];
  const seen = new Set<string>();
  for (const [i, value] of input.entries()) {
    const valid = await validateTradingRecord(value);
    if (!valid.valid) return { valid: false, issues: valid.issues.map(issue => ({ ...issue, path: `/${i}${issue.path}` })) };
    if (!('availableAt' in valid.value)) return tradingRefuse('TTRD1001', `/${i}/kind`, 'Expected an observation');
    const observation = valid.value;
    if (seen.has(observation.id)) return tradingRefuse('TTRD1001', `/${i}/id`, 'Duplicate observation identity');
    seen.add(observation.id);
    if (toEpoch(observation.availableAt) <= cutoff) admitted.push(observation);
    else refused.push({ id: observation.id, reason: 'TTRD1003', issue: tradingIssue('TTRD1003', `/${i}/availableAt`, 'Observation was not available at the cutoff') });
  }
  return { valid: true, value: { admitted, refused } };
}
export async function latestBarsAsOf(bars: readonly BarObservation[], cutoffAt: string, assets: readonly string[]): Promise<TradingOutcome<{
  rows: Array<{ asset: string; bar: BarObservation | null }>; missing: number; refused: TradingAdmission['refused'];
}>> {
  try { bars = immutableTradingJson(bars); assets = immutableTradingJson(assets); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Bar requests must be finite JSON', cause); }
  if (bars.some(b => b.kind !== 'bar')) return tradingRefuse('TTRD1001', '/bars', 'Bar selection accepts only bar observations');
  if (assets.some(asset => typeof asset !== 'string' || !asset.length)) return tradingRefuse('TTRD1001', '/assets', 'Expected nonempty asset names');
  const admitted = await admit(bars, cutoffAt);
  if (!admitted.valid) return admitted;
  if (new Set(assets).size !== assets.length) return tradingRefuse('TTRD1001', '/assets', 'Asset requests must be distinct');
  const matches = asOfJoin(assets.map(asset => ({ asset, at: cutoffAt, value: null })), admitted.value.admitted,
    { key: 'asset', direction: 'backward', right: { at: 'availableAt', value: 'close' } });
  const byId = new Map(admitted.value.admitted.map(b => [b.id, b as BarObservation]));
  const rows = matches.map(m => ({ asset: m.left.asset as string, bar: m.right ? immutableTradingJson(byId.get(m.right.id)!) : null }));
  return { valid: true, value: { rows, missing: rows.filter(r => r.bar === null).length, refused: admitted.value.refused } };
}
