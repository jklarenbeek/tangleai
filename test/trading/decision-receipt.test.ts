import { it } from 'node:test';
import assert from 'node:assert/strict';
import { openTangleDb, createTradingStore } from '@tangleai/store';
import { createTradingRecord, runBacktest, type TradingDecisionResult, type TradingStore } from '@tangleai/trading';
import { createScriptedTradingAgent } from '../../benchmark/lib/trading-agent-runner.ts';
import { checked } from '../../benchmark/lib/trading-research-runner.ts';
import { backtestFixture } from './backtest-fixture.ts';
import { tradingFixture, reidentify, value } from './fixtures.ts';
const f = await backtestFixture(2);
for (const fault of ['foreign-portfolio', 'missing-snapshot', 'missing-run', 'nested-identity', 'missing-provenance'] as const) it(`decision receipts refuse ${fault} before any result write`, async () => {
  const db = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } }), store = createTradingStore(db);
  let receipt: TradingDecisionResult | undefined;
  try {
    const agent = createScriptedTradingAgent(db, f.catalog);
    const capture: TradingStore = { ...store, put: async (table, record) => {
      if (record.kind === 'decision-result') { receipt = record; throw Error('capture-before-receipt'); }
      return store.put(table, record);
    } };
    await assert.rejects(runBacktest({ ...f.data, providers: f.providers, store: capture, decide: agent.decide }), /capture-before-receipt/);
    assert.ok(receipt); assert.equal(receipt.status, 'completed'); assert.ok(receipt.admission);
    let delta: Partial<TradingDecisionResult>;
    if (fault === 'foreign-portfolio') {
      const foreign = await tradingFixture({ seed: f.data.manifest.seed + 1 });
      value(await store.put('manifests', foreign.manifest)); value(await store.initializePortfolio(foreign.initial));
      delta = { portfolioId: foreign.initial.id, status: 'failed', snapshotId: null, runId: null, admission: null, artifactIds: [],
        errors: [{ code: 'TTRD1007', path: '/providers', detail: 'A missing provider' }] };
    } else if (fault === 'missing-snapshot') delta = { snapshotId: null };
    else if (fault === 'missing-run') delta = { runId: null };
    else if (fault === 'nested-identity') delta = { admission: { ...receipt.admission, decision: { ...receipt.admission.decision, reason: 'Unaddressed substituted decision' } } };
    else delta = { artifactIds: [] };
    const { id: _id, revision: _revision, kind, ...body } = { ...receipt, ...delta };
    const malformed = await createTradingRecord(kind, body);
    const before = await store.list('results');
    const result = malformed.valid ? await store.put('results', malformed.value) : malformed;
    assert.equal(result.valid, false, fault); assert.deepEqual(await store.list('results'), before);
    assert.equal(checked(await store.put('results', receipt)).writes, 1);
    assert.equal(checked(await store.put('results', receipt)).writes, 0);
    const changed = await reidentify(receipt, { runId: 'different-retained-run' });
    assert.equal((await store.put('results', changed)).valid, false);
  } finally { await db.close(); }
});
it('the strategy requires a retained immutable agent receipt before any broker decision', async () => {
  const { runStrategy } = await import('@tangleai/trading');
  const db = await openTangleDb(), store = createTradingStore(db);
  try {
    const result = await runStrategy({ ...f.data, store, decisions: async context => createTradingRecord('decision-result', {
      manifestId: f.data.manifest.id, key: { manifestId: f.data.manifest.id, asset: context.asset, sessionId: context.session.key, stage: 'model-decision' },
      portfolioId: context.portfolioId, snapshotId: null, runId: null, admission: null, artifactIds: [], valuationObservationIds: [],
      status: 'failed', errors: [{ code: 'TTRD1007', path: '/providers', detail: 'A missing provider' }],
      spend: { calls: 0, toolCalls: 0, tokens: 0, usd: 0, ms: 0, repairs: 0, retries: 0 },
    }) });
    assert.equal(result.valid, false);
    assert.equal((await store.list('decisions')).filter(d => d.key.stage === 'broker').length, 0);
  } finally { await db.close(); }
});
