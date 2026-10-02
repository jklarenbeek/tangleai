import { createGmplCatalog } from '@tangleai/gmpl';
import { createTradingRecord, createFixtureProviders, tradingArtifacts, type Observation, type TradingStrategyData } from '@tangleai/trading';
import { providerFixture } from './provider-fixture.ts';
import { reidentify, value } from './fixtures.ts';
import { checked } from '../../benchmark/lib/trading-research-runner.ts';
export async function backtestFixture(length = 4) {
  const original = await providerFixture(), catalog = checked(await createGmplCatalog(tradingArtifacts));
  const selected = original.sessions.slice(0, length), manifest = await reidentify(original.manifest, { promptCatalogRevision: tradingArtifacts.revision,
    sessionRange: { first: selected[0].key, last: selected.at(-1)!.key }, executionPolicy: { strategyId: 'tradingagents-scripted', kind: 'agent', entryQuantity: 2 },
    rolesByProfile: { analyst: 'scripted', research: 'scripted', trader: 'scripted', risk: 'scripted', 'fund-manager': 'scripted' } });
  const sessions = await Promise.all(selected.map((s, i) => reidentify(s, { manifestId: manifest.id, prev: selected[i - 1]?.key ?? null, next: selected[i + 1]?.key ?? null })));
  const observations: Observation[] = [];
  for (const record of original.input.observations) {
    if ((record.kind === 'bar' || record.kind === 'corporate-action') && !record.sourceKey.startsWith('poison-') && !selected.some(s => s.key === record.sessionId)) continue;
    const { id: _id, revision: _revision, kind, ...body } = record;
    observations.push(value(await createTradingRecord(kind, { ...body, manifestId: manifest.id } as never)));
  }
  const data: TradingStrategyData = { manifest, sessions,
    bars: observations.filter(o => o.kind === 'bar' && !o.sourceKey.startsWith('poison-')) as TradingStrategyData['bars'],
    actions: observations.filter(o => o.kind === 'corporate-action') as TradingStrategyData['actions'],
    observations: observations.filter(o => !['bar', 'corporate-action'].includes(o.kind) || o.sourceKey.startsWith('poison-')) };
  const fixture = value(await createFixtureProviders({ ...original.input, manifestId: manifest.id, sessions, observations }));
  return { data, catalog, providers: fixture.providers };
}
