import { createTradingRecord } from '@tangleai/trading';
import type { Observation, TradingFixtureProviderInput } from '@tangleai/trading';
import fundamentals from '../../benchmark/fixtures/trading/fundamentals.json' with { type: 'json' };
import news from '../../benchmark/fixtures/trading/news.json' with { type: 'json' };
import social from '../../benchmark/fixtures/trading/social.json' with { type: 'json' };
import insiders from '../../benchmark/fixtures/trading/insiders.json' with { type: 'json' };
import profiles from '../../benchmark/fixtures/trading/profiles.json' with { type: 'json' };
import actions from '../../benchmark/fixtures/trading/corporate-actions.json' with { type: 'json' };
import { tradingFixture, value } from './fixtures.ts';

export async function providerFixture() {
  const fixture = await tradingFixture(), observations: Observation[] = [...fixture.observations, ...fixture.poison];
  for (const record of [...fundamentals, ...news, ...social, ...insiders, ...profiles, ...actions]) {
    const { id: sourceKey, kind, ...body } = record;
    observations.push(value(await createTradingRecord(kind as Observation['kind'], { ...body, sourceKey, manifestId: fixture.manifest.id } as never)));
  }
  const input: TradingFixtureProviderInput = { manifestId: fixture.manifest.id, eventAt: '2024-12-31T00:00:00Z', availableAt: '2024-12-31T12:00:00Z',
    sessions: fixture.sessions, observations };
  return { ...fixture, input };
}
