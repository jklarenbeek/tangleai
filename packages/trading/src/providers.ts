/** Fixture/replay policy only. A live adapter would use @jarenjs/contract/provider
 * after its licence, terms, archived publication times and snapshot policy are declared. */
import { toEpoch } from '@jarenjs/core/series';
import { immutableTradingJson, tradingIdentityOf } from './identity.ts';
import { validateTradingShape } from './schema.ts';
import { validateTradingRecord } from './records.ts';
import { admit, sessionIndex } from './time.ts';
import { tradingRefuse, tradingIssue } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingAdmission } from './time.ts';
import type { MarketSession, Observation, TradingIssue, TradingProviderName, TradingProviderSnapshot, TradingProviderBindings,
  TradingFixtureProviderInput, TradingReplayProviderInput, TradingTimeRange, TradingCalendarRange } from './contracts.gen.ts';

export const TRADING_PROVIDERS: readonly TradingProviderName[] = Object.freeze(['calendar', 'market', 'fundamentals', 'news', 'social', 'insiders', 'profiles']);
const KINDS: Record<TradingProviderName, readonly Observation['kind'][]> = {
  calendar: [], market: ['bar', 'corporate-action'], fundamentals: ['fundamental'], news: ['news'], social: ['social'], insiders: ['insider'], profiles: ['profile'],
};
export function providerOwnsObservation(provider: TradingProviderName, observation: Observation): boolean { return KINDS[provider].includes(observation.kind); }
export type TradingProviderOutcome<T> = { outcome: 'ok'; value: T; snapshotId: string; refused: TradingAdmission['refused'] }
  | { outcome: 'unavailable' | 'failed'; reason: string; code: 'TTRD1007'; cause?: TradingIssue };
export interface TradingProviders {
  calendar: { sessions(range: TradingCalendarRange, cutoffAt: string): Promise<TradingProviderOutcome<MarketSession[]>> };
  market: { bars(asset: string, range: TradingTimeRange, cutoffAt: string): Promise<TradingProviderOutcome<Observation[]>> };
  fundamentals: { facts(asset: string, cutoffAt: string): Promise<TradingProviderOutcome<Observation[]>> };
  news: { items(asset: string, range: TradingTimeRange, cutoffAt: string): Promise<TradingProviderOutcome<Observation[]>> };
  social: { items(asset: string, range: TradingTimeRange, cutoffAt: string): Promise<TradingProviderOutcome<Observation[]>> };
  insiders: { events(asset: string, cutoffAt: string): Promise<TradingProviderOutcome<Observation[]>> };
  profiles: { company(asset: string, cutoffAt: string): Promise<TradingProviderOutcome<Observation[]>> };
}
export interface TradingFixtureProviders { providers: TradingProviders; snapshots: TradingProviderSnapshot[]; bindings: TradingProviderBindings; }

function failed<T>(reason: string, cause?: TradingIssue): TradingProviderOutcome<T> {
  return { outcome: 'failed', code: 'TTRD1007', reason, ...(cause ? { cause } : {}) };
}
async function checkSnapshot(input: unknown, identity: boolean): Promise<TradingOutcome<TradingProviderSnapshot>> {
  const shape = validateTradingShape<TradingProviderSnapshot>('tradingProviderSnapshot', input); if (!shape.valid) return shape;
  const snapshot = shape.value;
  try {
    if (toEpoch(snapshot.availableAt) < toEpoch(snapshot.eventAt)) return tradingRefuse('TTRD1001', '/availableAt', 'Provider revision publication precedes its event');
  } catch (cause) { return tradingRefuse('TTRD1001', '/availableAt', 'Invalid provider publication instant', cause); }
  if (snapshot.provider === 'calendar' ? snapshot.observations.length !== 0 : snapshot.sessions.length !== 0)
    return tradingRefuse('TTRD1001', '/provider', 'Provider corpus carries the wrong record family');
  if (snapshot.observations.some(o => !providerOwnsObservation(snapshot.provider, o))) return tradingRefuse('TTRD1001', '/observations', 'Provider corpus carries another provider kind');
  const records = [...snapshot.sessions, ...snapshot.observations];
  if (new Set(records.map(r => r.id)).size !== records.length) return tradingRefuse('TTRD1001', '/records', 'Provider corpus repeats an identity');
  for (const [i, record] of records.entries()) {
    const valid = await validateTradingRecord(record);
    if (!valid.valid) return { valid: false, issues: valid.issues.map(issue => ({ ...issue, path: `/records/${i}${issue.path}` })) };
    if (record.manifestId !== snapshot.manifestId) return tradingRefuse('TTRD1002', `/records/${i}/manifestId`, 'Provider corpus crosses run boundaries');
  }
  if (snapshot.provider === 'calendar') { const calendar = await sessionIndex(snapshot.sessions); if (!calendar.valid) return calendar; }
  if (identity) {
    const { id, revision, ...body } = snapshot, expected = await tradingIdentityOf({ kind: 'provider-snapshot', ...body });
    if (id !== expected.id || revision !== expected.revision) return tradingRefuse('TTRD1002', '/id', 'Provider snapshot bytes differ from their content address');
  }
  return shape;
}

export async function createTradingProviderSnapshot(input: Omit<TradingProviderSnapshot, 'id' | 'revision'>): Promise<TradingOutcome<TradingProviderSnapshot>> {
  if (input && (Object.hasOwn(input, 'id') || Object.hasOwn(input, 'revision'))) return tradingRefuse('TTRD1001', '/id', 'Provider constructors assign the content address');
  const prepared = await checkSnapshot({ ...input, id: 'provider-pending', revision: '0'.repeat(64) }, false); if (!prepared.valid) return prepared;
  const { id: _id, revision: _revision, ...body } = prepared.value;
  return { valid: true, value: immutableTradingJson({ ...body, ...await tradingIdentityOf({ kind: 'provider-snapshot', ...body }) }) };
}

export async function createFixtureProviders(input: TradingFixtureProviderInput): Promise<TradingOutcome<TradingFixtureProviders>> {
  const shape = validateTradingShape<TradingFixtureProviderInput>('tradingFixtureProviderInput', input); if (!shape.valid) return shape;
  const source = shape.value, snapshots: TradingProviderSnapshot[] = [], bindings = {} as TradingProviderBindings;
  for (const provider of TRADING_PROVIDERS) {
    const result = await createTradingProviderSnapshot({ manifestId: source.manifestId, provider, eventAt: source.eventAt, availableAt: source.availableAt,
      sessions: provider === 'calendar' ? source.sessions : [], observations: source.observations.filter(o => providerOwnsObservation(provider, o)) });
    if (!result.valid) return result;
    snapshots.push(result.value); bindings[provider] = result.value.id;
  }
  const replay = await createReplayProviders({ manifestId: source.manifestId, snapshots, bindings }); if (!replay.valid) return replay;
  return { valid: true, value: { providers: replay.value, snapshots: immutableTradingJson(snapshots), bindings: immutableTradingJson(bindings) } };
}

export async function createReplayProviders(input: TradingReplayProviderInput): Promise<TradingOutcome<TradingProviders>> {
  const shape = validateTradingShape<TradingReplayProviderInput>('tradingReplayProviderInput', input); if (!shape.valid) return shape;
  const frozen = shape.value, snapshots = new Map<string, TradingProviderSnapshot>();
  for (const snapshot of frozen.snapshots) {
    const valid = await checkSnapshot(snapshot, true); if (!valid.valid) return valid;
    if (snapshot.manifestId !== frozen.manifestId || snapshots.has(snapshot.id)) return tradingRefuse('TTRD1002', '/snapshots', 'Replay snapshots must be distinct and scoped to this run');
    snapshots.set(snapshot.id, valid.value);
  }
  for (const provider of TRADING_PROVIDERS) {
    const id = frozen.bindings[provider], snapshot = id === null ? undefined : snapshots.get(id);
    if (snapshot && snapshot.provider !== provider) return tradingRefuse('TTRD1002', `/bindings/${provider}`, 'Replay binding names another provider');
  }
  function source(provider: TradingProviderName, cutoffAt: string): TradingProviderOutcome<TradingProviderSnapshot | null> {
    const id = frozen.bindings[provider], snapshot = id === null ? undefined : snapshots.get(id);
    if (!snapshot) return { outcome: 'unavailable', code: 'TTRD1007', reason: `No retained ${provider} snapshot for this binding` };
    try {
      if (toEpoch(snapshot.availableAt) > toEpoch(cutoffAt)) return { outcome: 'ok', value: null, snapshotId: snapshot.id,
        refused: [{ id: snapshot.id, reason: 'TTRD1003', issue: tradingIssue('TTRD1003', '/availableAt', 'Provider revision was published after the cutoff') }] };
    } catch (cause) { return failed('Invalid provider cutoff', tradingIssue('TTRD1001', '/cutoffAt', 'Expected a valid instant', cause)); }
    return { outcome: 'ok', value: snapshot, snapshotId: snapshot.id, refused: [] };
  }
  async function observations(provider: TradingProviderName, asset: string, cutoffAt: string, range?: TradingTimeRange): Promise<TradingProviderOutcome<Observation[]>> {
    const current = source(provider, cutoffAt); if (current.outcome !== 'ok') return current;
    if (!current.value) return { ...current, value: [] };
    if (typeof asset !== 'string' || !asset.length) return failed('Asset is required', tradingIssue('TTRD1001', '/asset', 'Expected a nonempty asset'));
    let from = -Infinity, to = Infinity;
    if (range !== undefined) {
      const shaped = validateTradingShape<TradingTimeRange>('tradingTimeRange', range); if (!shaped.valid) return failed('Invalid provider range', shaped.issues[0]);
      try { from = toEpoch(shaped.value.from); to = toEpoch(shaped.value.to); }
      catch (cause) { return failed('Invalid provider range', tradingIssue('TTRD1001', '/range', 'Expected valid range instants', cause)); }
      if (from > to) return failed('Reversed provider range', tradingIssue('TTRD1001', '/range', 'Range ends before it starts'));
    }
    const records = current.value.observations.filter(o => o.asset === asset && toEpoch(o.eventAt) >= from && toEpoch(o.eventAt) <= to);
    const admitted = await admit(records, cutoffAt); if (!admitted.valid) return failed('Provider observation validation failed', admitted.issues[0]);
    return { outcome: 'ok', value: immutableTradingJson(admitted.value.admitted), snapshotId: current.snapshotId, refused: immutableTradingJson(admitted.value.refused) };
  }
  return { valid: true, value: Object.freeze<TradingProviders>({
    calendar: { async sessions(range, cutoffAt) {
      const shape = validateTradingShape<TradingCalendarRange>('tradingCalendarRange', range); if (!shape.valid) return failed('Invalid calendar range', shape.issues[0]);
      const current = source('calendar', cutoffAt); if (current.outcome !== 'ok') return current;
      if (!current.value) return { ...current, value: [] };
      const first = current.value.sessions.findIndex(s => s.key === shape.value.first), last = current.value.sessions.findIndex(s => s.key === shape.value.last);
      if (first < 0 || last < first) return failed('Requested calendar range is unavailable', tradingIssue('TTRD1003', '/range', 'Unknown or reversed calendar range'));
      return { outcome: 'ok', value: immutableTradingJson(current.value.sessions.slice(first, last + 1)), snapshotId: current.snapshotId, refused: [] };
    } },
    market: { bars: (asset, range, cutoffAt) => observations('market', asset, cutoffAt, range) },
    fundamentals: { facts: (asset, cutoffAt) => observations('fundamentals', asset, cutoffAt) },
    news: { items: (asset, range, cutoffAt) => observations('news', asset, cutoffAt, range) },
    social: { items: (asset, range, cutoffAt) => observations('social', asset, cutoffAt, range) },
    insiders: { events: (asset, cutoffAt) => observations('insiders', asset, cutoffAt) },
    profiles: { company: (asset, cutoffAt) => observations('profiles', asset, cutoffAt) },
  }) };
}
