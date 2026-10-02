import { it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, createFixtureProviders, createReplayProviders, createMemoryTradingStore } from '@tangleai/trading';
import type { TradingProviders, TradingProviderOutcome, Observation } from '@tangleai/trading';
import { providerFixture } from './provider-fixture.ts';
import { reidentify, value } from './fixtures.ts';

const fixture = await providerFixture(), corpus = value(await createFixtureProviders(fixture.input));
const input = { manifest: fixture.manifest, asset: 'SYN-A', session: fixture.sessions.at(-1)!, portfolio: fixture.initial, providers: corpus.providers };
const ok = (observations: Observation[]): Extract<TradingProviderOutcome<Observation[]>, { outcome: 'ok' }> => ({ outcome: 'ok', value: observations, snapshotId: corpus.bindings.market!, refused: [] });

it('snapshot identity is deterministic and poison changes refusals only, with zero network', async () => {
  const clean = value(await createFixtureProviders({ ...fixture.input, observations: fixture.input.observations.filter(o => !fixture.poison.some(p => p.id === o.id)) }));
  const fetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('Network forbidden'); };
  try {
    for (const asset of fixture.manifest.assets) {
      const baseline = value(await buildSnapshot({ ...input, asset, providers: clean.providers }));
      const poisoned = value(await buildSnapshot({ ...input, asset }));
      const repeated = value(await buildSnapshot({ ...input, asset }));
      assert.deepEqual(repeated, poisoned); assert.deepEqual(poisoned.observations, baseline.observations);
      assert.deepEqual(poisoned.snapshot.observationIds, baseline.snapshot.observationIds);
      assert.deepEqual(poisoned.snapshot.providerErrors, []); assert.equal(poisoned.snapshot.staleness, 1);
      const extra = poisoned.snapshot.refused.filter(r => !baseline.snapshot.refused.some(p => p.id === r.id));
      assert.deepEqual(extra.map(r => r.id).sort(), fixture.poison.filter(p => p.asset === asset).map(p => p.id).sort());
      assert.ok(extra.every(r => r.reason === 'TTRD1003'));
      assert.notEqual(poisoned.snapshot.id, baseline.snapshot.id);
      assert.ok(poisoned.observations.every(o => Date.parse(o.availableAt) <= Date.parse(input.session.closeAt)));
      assert.ok(Object.isFrozen(poisoned.observations));
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = fetch; }
});

it('snapshot independently refuses late observations even when an injected provider admits them', async () => {
  const providers: TradingProviders = { ...corpus.providers, market: { bars: async () => ok(fixture.input.observations.filter(o => o.kind === 'bar' && o.asset === input.asset)) } };
  const built = value(await buildSnapshot({ ...input, providers }));
  assert.deepEqual(built.snapshot.providerErrors, []);
  assert.ok(built.snapshot.refused.some(r => r.id === fixture.poison[0].id));
  assert.ok(!built.snapshot.observationIds.includes(fixture.poison[0].id));
  assert.equal(built.snapshot.staleness, 1);
});

it('missing, thrown and malformed provider results remain explicit failures with no fabricated observations', async () => {
  const replay = value(await createReplayProviders({ manifestId: fixture.manifest.id, snapshots: corpus.snapshots.filter(s => s.provider !== 'market'), bindings: corpus.bindings }));
  const providers: TradingProviders = { ...replay, news: { items: async () => { throw Error('Fixture provider stopped'); } },
    social: { items: async () => ({ ...ok([]), undeclared: true }) } };
  const built = value(await buildSnapshot({ ...input, providers }));
  assert.deepEqual(built.snapshot.providerErrors.map(e => [e.code, e.path]), [
    ['TTRD1007', '/providers/market'], ['TTRD1007', '/providers/news'], ['TTRD1007', '/providers/social'],
  ]);
  assert.equal(built.snapshot.staleness, null);
  assert.ok(built.observations.every(o => !['bar', 'corporate-action', 'news', 'social'].includes(o.kind)));
  assert.ok(built.snapshot.providerErrors[1].cause?.detail.includes('Provider call threw'));
});

it('foreign, rehashed future-session, tampered and contradictory provider content cannot become citations', async () => {
  const bar = fixture.observations[0], foreign = fixture.observations.find(o => o.asset !== input.asset)!;
  const cases: Array<TradingProviderOutcome<Observation[]>> = [ok([foreign]), ok([{ ...bar, close: bar.kind === 'bar' ? bar.close + 1 : 0 } as Observation]),
    { ...ok([bar]), refused: [{ id: bar.id, reason: 'TTRD1003', issue: { code: 'TTRD1003', path: '', detail: 'Withheld' } }] }];
  for (const response of cases) {
    const built = value(await buildSnapshot({ ...input, providers: { ...corpus.providers, market: { bars: async () => response } } }));
    assert.ok(built.snapshot.providerErrors.some(e => e.path === '/providers/market'));
    assert.ok(!built.snapshot.observationIds.includes(bar.id)); assert.ok(!built.snapshot.observationIds.includes(foreign.id));
  }
  const futureSession = await reidentify(bar, { sessionId: fixture.sessions.at(-1)!.key } as Partial<typeof bar>);
  const refused = await buildSnapshot({ ...input, session: fixture.sessions[1], providers: { ...corpus.providers, market: { bars: async () => ok([futureSession]) } } });
  assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TTRD1003');
});

it('calendar failures stop before any observation reads and future portfolios are refused', async () => {
  let calls = 0;
  const late = value(await createFixtureProviders({ ...fixture.input, availableAt: '2025-07-01T00:00:00Z' }));
  const providers: TradingProviders = { ...late.providers, market: { bars: async () => { calls++; return ok([]); } } };
  const unavailable = await buildSnapshot({ ...input, providers });
  assert.equal(unavailable.valid, false); if (!unavailable.valid) assert.equal(unavailable.issues[0].code, 'TTRD1003');
  assert.equal(calls, 0);
  const missing = await buildSnapshot({ ...input, providers: { ...providers, calendar: { sessions: async () => ({ outcome: 'unavailable', code: 'TTRD1007', reason: 'No calendar' }) } } });
  assert.equal(missing.valid, false); if (!missing.valid) assert.equal(missing.issues[0].code, 'TTRD1007');
  const future = await reidentify(fixture.initial, { asOfSessionId: input.session.key });
  assert.equal((await buildSnapshot({ ...input, session: fixture.sessions[1], portfolio: future })).valid, false);
  assert.equal(calls, 0);
});

it('inputs are detached before asynchronous providers and staleness uses bar sessions, not publication order', async () => {
  const old = await reidentify(fixture.observations[0], { availableAt: input.session.openAt, revisionId: 'late-valid-restatement' });
  const revised = value(await createFixtureProviders({ ...fixture.input, observations: [...fixture.input.observations, old] }));
  const session = structuredClone(input.session), pending = buildSnapshot({ ...input, session, providers: revised.providers });
  session.closeAt = '2099-01-01T00:00:00Z';
  const built = value(await pending);
  assert.equal(built.snapshot.cutoffAt, input.session.closeAt); assert.equal(built.snapshot.staleness, 1);
  assert.ok(built.snapshot.observationIds.includes(old.id));
});

it('a daily bar cannot claim the session close value at its opening time', async () => {
  const session = fixture.sessions[1];
  const bar = await reidentify(fixture.observations[0], { sessionId: session.key, eventAt: session.openAt, availableAt: session.openAt } as Partial<Observation>);
  const providers: TradingProviders = { ...corpus.providers, market: { bars: async () => ok([bar]) } };
  const outcome = await buildSnapshot({ ...input, session, providers });
  assert.equal(outcome.valid, false); if (!outcome.valid) assert.equal(outcome.issues[0].code, 'TTRD1003');
});

it('admitted snapshot bundles persist without poison data and replay writes nothing', async () => {
  const built = value(await buildSnapshot(input)), store = createMemoryTradingStore();
  value(await store.put('manifests', fixture.manifest)); value(await store.initializePortfolio(fixture.initial));
  for (const session of built.sessions) value(await store.put('sessions', session));
  for (const observation of built.observations) value(await store.put('observations', observation));
  assert.equal(value(await store.put('snapshots', built.snapshot)).writes, 1);
  assert.equal(value(await store.put('snapshots', built.snapshot)).writes, 0);
  assert.deepEqual(await store.get('snapshots', built.snapshot.id), built.snapshot);
  assert.ok((await store.list('observations')).every(o => !fixture.poison.some(p => p.id === o.id)));
  const forged = await reidentify(built.snapshot, { staleness: 0 });
  assert.equal((await store.put('snapshots', forged)).valid, false);
});
