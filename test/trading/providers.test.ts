import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureProviders, createReplayProviders, createTradingProviderSnapshot, TRADING_PROVIDERS } from '@tangleai/trading';
import type { TradingProviders, TradingProviderName, TradingProviderSnapshot, TradingProviderOutcome, Observation, MarketSession } from '@tangleai/trading';
import { providerFixture } from './provider-fixture.ts';
import { reidentify, value } from './fixtures.ts';

const fixture = await providerFixture(), range = { from: '2024-01-01T00:00:00Z', to: '2025-12-31T23:59:59Z' };
function read(providers: TradingProviders, name: TradingProviderName, cutoffAt: string): Promise<TradingProviderOutcome<Observation[] | MarketSession[]>> {
  switch (name) {
    case 'calendar': return providers.calendar.sessions(fixture.manifest.sessionRange, cutoffAt);
    case 'market': return providers.market.bars('SYN-A', range, cutoffAt);
    case 'fundamentals': return providers.fundamentals.facts('SYN-A', cutoffAt);
    case 'news': return providers.news.items('SYN-A', range, cutoffAt);
    case 'social': return providers.social.items('SYN-A', range, cutoffAt);
    case 'insiders': return providers.insiders.events('SYN-A', cutoffAt);
    case 'profiles': return providers.profiles.company('SYN-A', cutoffAt);
  }
}
for (const mode of ['fixture', 'replay'] as const) describe(`${mode}: every provider passes the cutoff suite`, () => {
  it('all seven seams refuse future snapshot revisions and admit them at explicit publication', async () => {
    const late = value(await createFixtureProviders({ ...fixture.input, availableAt: '2025-07-01T12:00:00Z' }));
    const providers = mode === 'fixture' ? late.providers : value(await createReplayProviders({ manifestId: fixture.manifest.id, snapshots: late.snapshots, bindings: late.bindings }));
    for (const name of TRADING_PROVIDERS) {
      const before = await read(providers, name, '2025-06-30T21:00:00Z'); assert.equal(before.outcome, 'ok');
      assert.equal(before.value.length, 0); assert.equal(before.refused.length, 1);
      assert.deepEqual([before.refused[0].id, before.refused[0].reason, before.refused[0].issue.code], [late.bindings[name], 'TTRD1003', 'TTRD1003']);
      const after = await read(providers, name, '2025-07-01T14:00:00+02:00'); assert.equal(after.outcome, 'ok');
      assert.ok(after.value.length > 0, name); assert.equal(after.refused.length, 0);
    }
  });
  it('individual revisions stay withheld even inside an already published corpus', async () => {
    const future: Observation[] = [];
    for (const kind of ['bar', 'fundamental', 'news', 'social', 'insider', 'profile'] as const) {
      const original = fixture.input.observations.find(o => o.kind === kind && o.asset === 'SYN-A')!;
      future.push(await reidentify(original, { availableAt: '2025-07-01T12:00:00Z', revisionId: `${original.revisionId}-withheld` }));
    }
    const bundle = value(await createFixtureProviders({ ...fixture.input, observations: [...fixture.input.observations, ...future] }));
    const providers = mode === 'fixture' ? bundle.providers : value(await createReplayProviders({ manifestId: fixture.manifest.id, snapshots: bundle.snapshots, bindings: bundle.bindings }));
    for (const [i, name] of ['market', 'fundamentals', 'news', 'social', 'insiders', 'profiles'].entries()) {
      const before = await read(providers, name as TradingProviderName, '2025-06-30T21:00:00Z'); assert.equal(before.outcome, 'ok');
      assert.ok(!before.value.some(o => o.id === future[i].id));
      assert.ok(before.refused.some(r => r.id === future[i].id && r.issue.code === 'TTRD1003'));
      const after = await read(providers, name as TradingProviderName, future[i].availableAt);
      assert.ok(after.outcome === 'ok' && after.value.some(o => o.id === future[i].id));
    }
  });
});

it('replay misses are explicit unavailability with zero network calls and no fallback', async () => {
  const bundle = value(await createFixtureProviders(fixture.input)), before = globalThis.fetch;
  let calls = 0; globalThis.fetch = async () => { calls++; throw Error('Network forbidden'); };
  try {
    for (const name of TRADING_PROVIDERS) {
      const providers = value(await createReplayProviders({ manifestId: fixture.manifest.id, snapshots: bundle.snapshots.filter(s => s.provider !== name), bindings: bundle.bindings }));
      const missing = await read(providers, name, '2025-06-30T21:00:00Z');
      assert.equal(missing.outcome, 'unavailable'); assert.equal(missing.code, 'TTRD1007');
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = before; }
});

it('provider snapshots are detached before validation, deterministic and verified on replay', async () => {
  const input = structuredClone(fixture.input), pending = createFixtureProviders(input);
  input.observations[1].availableAt = '2099-01-01T00:00:00Z';
  const first = value(await pending), second = value(await createFixtureProviders(fixture.input));
  assert.deepEqual(first.snapshots, second.snapshots); assert.deepEqual(first.bindings, second.bindings);
  assert.ok(Object.isFrozen(first.snapshots[0].sessions));
  const changed: TradingProviderSnapshot = { ...first.snapshots[0], availableAt: '2025-01-01T00:00:00Z' };
  const refused = await createReplayProviders({ manifestId: fixture.manifest.id, snapshots: [changed, ...first.snapshots.slice(1)], bindings: first.bindings });
  assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TTRD1002');
  const { id: _id, revision: _revision, ...body } = first.snapshots[0];
  assert.equal((await createTradingProviderSnapshot({ ...body, availableAt: '2020-01-01T00:00:00Z' })).valid, false);
  assert.equal((await createReplayProviders({ manifestId: fixture.manifest.id, snapshots: first.snapshots, bindings: { ...first.bindings, news: first.bindings.calendar } })).valid, false);
});

it('invalid ranges return provider failures with their originating content code', async () => {
  const { providers } = value(await createFixtureProviders(fixture.input));
  const result = await providers.market.bars('SYN-A', { from: '2025-02-01T00:00:00Z', to: '2025-01-01T00:00:00Z' }, '2025-03-01T00:00:00Z');
  assert.equal(result.outcome, 'failed');
  assert.deepEqual([result.code, result.cause?.code, result.cause?.path], ['TTRD1007', 'TTRD1001', '/range']);
});
