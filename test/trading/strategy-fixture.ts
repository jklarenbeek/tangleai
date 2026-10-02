import type { TradingExecutionPolicy, TradingStrategyData, CorporateActionObservation, BarObservation, RiskPolicy } from '@tangleai/trading';
import { providerFixture } from './provider-fixture.ts';
import { reidentify } from './fixtures.ts';

export async function strategyFixture(kind: TradingExecutionPolicy['kind'], options: { sessions?: number; seed?: number; riskPolicy?: Partial<RiskPolicy> } = {}): Promise<TradingStrategyData> {
  const fixture = await providerFixture(), selected = fixture.sessions.slice(0, options.sessions);
  const manifest = await reidentify(fixture.manifest, { executionPolicy: { kind, strategyId: kind === 'signals' ? 'target-test' : kind, entryQuantity: 100 },
    seed: options.seed ?? fixture.manifest.seed, sessionRange: { first: selected[0].key, last: selected.at(-1)!.key },
    riskPolicy: { ...fixture.manifest.riskPolicy, ...options.riskPolicy } });
  const manifestId = manifest.id, sessions = await Promise.all(selected.map((s, i) => reidentify(s, { manifestId, prev: selected[i - 1]?.key ?? null, next: selected[i + 1]?.key ?? null })));
  const retained = new Set(sessions.map(s => s.key));
  const bars = await Promise.all(fixture.observations.filter((o): o is BarObservation => o.kind === 'bar' && retained.has(o.sessionId)).map(o => reidentify(o, { manifestId })));
  const actions = await Promise.all(fixture.input.observations.filter((o): o is CorporateActionObservation => o.kind === 'corporate-action' && retained.has(o.sessionId)).map(o => reidentify(o, { manifestId })));
  const observations = await Promise.all(fixture.input.observations.filter(o => o.kind !== 'corporate-action' && (o.kind !== 'bar' || o.sourceKey.startsWith('poison-'))).map(o => reidentify(o, { manifestId })));
  return { manifest, sessions, bars, actions, observations };
}
