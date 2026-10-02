import { createGmplCatalog } from '@tangleai/gmpl';
import { tradingArtifacts, createTradingRecord, createFixtureProviders, buildSnapshot } from '@tangleai/trading';
import type { Observation } from '@tangleai/trading';
import { providerFixture } from './provider-fixture.ts';
import { value } from './fixtures.ts';
import { prepareTradingAnalystDrive } from '../../benchmark/lib/trading-analyst-runner.ts';
export { scriptedModel, scriptedSpend } from '../../benchmark/lib/trading-analyst-runner.ts';

export async function analystFixture(sessionIndex = 60) {
  const original = await providerFixture(), compiled = await createGmplCatalog(tradingArtifacts);
  if (!compiled.valid) throw Error(JSON.stringify(compiled.issues));
  const catalog = compiled.value;
  // Every record is rebound because the manifest content address includes the prompt catalog.
  const { id: _id, revision: _revision, kind: _kind, ...body } = original.manifest;
  const manifest = value(await createTradingRecord('manifest', { ...body, promptCatalogRevision: tradingArtifacts.revision }));
  const rebind = async (record: typeof original.sessions[number] | Observation | typeof original.initial) => {
    const { id: _id, revision: _revision, kind, ...data } = record;
    return value(await createTradingRecord(kind, { ...data, manifestId: manifest.id } as never));
  };
  const sessions = await Promise.all(original.sessions.map(rebind)) as typeof original.sessions;
  const observations = await Promise.all(original.input.observations.map(rebind)) as Observation[];
  const portfolio = await rebind(original.initial) as typeof original.initial;
  const fixture = value(await createFixtureProviders({ ...original.input, manifestId: manifest.id, sessions, observations }));
  const snapshot = value(await buildSnapshot({ manifest, asset: manifest.assets[0], session: sessions[sessionIndex], portfolio, providers: fixture.providers }));
  const drive = await prepareTradingAnalystDrive({ catalog, manifest, snapshot, portfolio, providers: fixture.providers });
  return { manifest, sessions, observations, portfolio, fixture, snapshot, catalog, ...drive };
}
