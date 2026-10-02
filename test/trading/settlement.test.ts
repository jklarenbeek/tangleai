import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createTradingRecord, createMemoryTradingStore, runStrategy, TRADING_TABLES, applyCorporateActions } from '@tangleai/trading';
import type { TradingCommit, TradingCommitMarker, TradingStore } from '@tangleai/trading';
import { strategyFixture } from './strategy-fixture.ts';
import { openExecutionHarness } from './execution-harness.ts';
import { reidentify, value } from './fixtures.ts';

async function planFor(store: TradingStore, marker: TradingCommitMarker): Promise<TradingCommit> {
  const decision = await store.get('decisions', marker.decisionId), portfolio = await store.get('portfolios', marker.portfolioId);
  assert.ok(decision?.kind === 'decision' && portfolio);
  return { mode: marker.mode, key: marker.key, expectedPortfolioId: marker.expectedPortfolioId, decision, portfolio,
    intent: marker.intentId ? (await store.get('orders', marker.intentId))! : null, fills: await Promise.all(marker.fillIds.map(async id => (await store.get('fills', id))!)),
    ledgerEntries: await Promise.all(marker.ledgerEntryIds.map(async id => (await store.get('ledger', id))!)), actionIds: marker.actionIds, markBarIds: marker.markBarIds };
}

for (const action of ['split', 'dividend'] as const) for (const mode of ['memory', 'sqlite-memory', 'sqlite-file'] as const)
  it(`${mode}: ${action} settlement survives every write probe, cannot repeat and verifies original evidence on replay`, async () => {
    const data = await strategyFixture('oracle', { sessions: 3 }), session = data.sessions[2]; data.observations = [];
    const entitlement = value(await createTradingRecord('corporate-action', { manifestId: data.manifest.id, sourceKey: `test-${action}`, sourceId: 'fixture', revisionId: 'fixture-r1', contentHash: '0'.repeat(64),
      asset: data.manifest.assets[0], sessionId: session.key, eventAt: session.openAt, availableAt: session.openAt, action, ratio: action === 'split' ? 2 : null, cashPerShare: action === 'dividend' ? 0.5 : null }));
    data.actions = [entitlement];
    const clean = createMemoryTradingStore(), expected = value(await runStrategy({ ...data, store: clean }));
    const marker = (await clean.list('decisions', { kind: 'decision-commit' })).find((m): m is TradingCommitMarker => m.kind === 'decision-commit' && m.mode === 'settlement')!;
    const plan = await planFor(clean, marker), previous = await clean.get('portfolios', marker.expectedPortfolioId); assert.ok(previous);
    assert.equal(previous.positions[0].quantity, 100);
    assert.equal(plan.portfolio.positions[0].quantity, action === 'split' ? 200 : 100);
    assert.equal(plan.portfolio.cash - previous.cash, action === 'dividend' ? 50 : 0);
    assert.equal(plan.ledgerEntries.length, action === 'dividend' ? 2 : 0);
    const before = await Promise.all(TRADING_TABLES.map(table => clean.list(table)));
    assert.equal(value(await clean.commitDecision(plan)).writes, 0, 'later closes must not invalidate original replay');
    const latest = (await clean.latestPortfolio(data.manifest.id))!;
    const repeated = value(await applyCorporateActions({ manifest: data.manifest, portfolio: latest, session, actions: [entitlement] }));
    const revisedKey = { ...plan.key, stage: 'different-settlement' };
    const duplicate = await clean.commitDecision({ ...plan, key: revisedKey, expectedPortfolioId: latest.id,
      decision: await reidentify(plan.decision, { key: revisedKey }), portfolio: repeated.portfolio, ledgerEntries: repeated.ledgerEntries });
    assert.equal(duplicate.valid, false);
    assert.deepEqual(await Promise.all(TRADING_TABLES.map(table => clean.list(table))), before);
    const preceding = (await clean.list('decisions', { kind: 'decision-commit' })).filter((m): m is TradingCommitMarker => m.kind === 'decision-commit' && m.portfolioSequence < marker.portfolioSequence);
    const settlementStart = 1 + preceding.reduce((sum, m) => sum + m.fillIds.length + m.ledgerEntryIds.length + 4, 0);
    const steps = ['decision', 'intent', ...plan.ledgerEntries.map(() => 'ledger'), 'portfolio', 'commit'];
    for (const [offset, expectedStep] of steps.entries()) {
      let calls = 0, crashed = false;
      const h = await openExecutionHarness(mode, { applyProbe: step => {
        if (++calls === settlementStart + offset && !crashed) {
          assert.equal(step, expectedStep); crashed = true; throw Error('corporate settlement crash');
        }
      } });
      try {
        await assert.rejects(runStrategy({ ...data, store: h.store }), /corporate settlement crash/); assert.ok(crashed);
        await h.reopen(); const recovered = value(await runStrategy({ ...data, store: h.store }));
        assert.deepEqual({ ...recovered, writes: 0 }, { ...expected, writes: 0 });
        for (const table of TRADING_TABLES) assert.deepEqual(await h.store.list(table), await clean.list(table), table);
      } finally { await h.close(); }
    }
  });

it('a revised ex-date cannot settle the same economic action a second time', async () => {
  const data = await strategyFixture('oracle', { sessions: 4 }); data.observations = [];
  const firstSession = data.sessions[2], next = data.sessions[3];
  const action = value(await createTradingRecord('corporate-action', { manifestId: data.manifest.id, sourceKey: 'cash-entitlement', sourceId: 'fixture', revisionId: 'r1', contentHash: '0'.repeat(64),
    asset: data.manifest.assets[0], sessionId: firstSession.key, eventAt: firstSession.openAt, availableAt: firstSession.openAt, action: 'dividend', ratio: null, cashPerShare: 0.5 }));
  data.actions = [action];
  const complete = createMemoryTradingStore(), run = value(await runStrategy({ ...data, store: complete })), store = createMemoryTradingStore();
  value(await store.put('manifests', data.manifest));
  for (const session of data.sessions) value(await store.put('sessions', session));
  for (const observation of [...data.bars, action]) value(await store.put('observations', observation));
  value(await store.initializePortfolio(run.portfolios[0]));
  const previous = run.portfolios[3];
  const prefix = (await complete.list('decisions', { kind: 'decision-commit' })).filter((m): m is TradingCommitMarker => m.kind === 'decision-commit' && m.portfolioSequence <= previous.sequence).sort((a, b) => a.portfolioSequence - b.portfolioSequence);
  for (const marker of prefix) value(await store.commitDecision(await planFor(complete, marker)));
  const revised = await reidentify(action, { revisionId: 'r2', sessionId: next.key, eventAt: next.openAt, availableAt: next.openAt });
  value(await store.put('observations', revised));
  const applied = value(await applyCorporateActions({ manifest: data.manifest, portfolio: previous, session: next, actions: [revised] }));
  const key = { manifestId: data.manifest.id, asset: action.asset, sessionId: next.key, stage: 'corporate-action' };
  const decision = value(await createTradingRecord('decision', { manifestId: data.manifest.id, key, inputRevision: previous.revision, disposition: 'hold', artifactIds: [], reason: 'Revised ex-date' }));
  const before = await Promise.all(TRADING_TABLES.map(table => store.list(table)));
  const result = await store.commitDecision({ mode: 'settlement', key, expectedPortfolioId: previous.id, decision, intent: null, fills: [],
    ledgerEntries: applied.ledgerEntries, portfolio: applied.portfolio, markBarIds: [], actionIds: [revised.id] });
  assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TTRD1006');
  assert.deepEqual(await Promise.all(TRADING_TABLES.map(table => store.list(table))), before);
});
