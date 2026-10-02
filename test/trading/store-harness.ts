import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRADING_TABLES, createTradingRecord } from '@tangleai/trading';
import type { TradingStore, TradingStoreOptions, TradingCommit } from '@tangleai/trading';
import { tradingFixture, decisionFixture, loadFixture, reidentify, value } from './fixtures.ts';

export interface TradingHarness { store: TradingStore; close(): Promise<void>; reopen?(): Promise<TradingStore>; }
export type OpenTradingHarness = (options?: TradingStoreOptions) => Promise<TradingHarness>;
const fixture = await tradingFixture(), plan = await decisionFixture(fixture);
const seed = async (store: TradingStore) => {
  value(await store.put('manifests', fixture.manifest));
  for (const session of fixture.sessions.slice(0, 2)) value(await store.put('sessions', session));
  value(await store.initializePortfolio(fixture.initial));
};
const contents = async (store: TradingStore) => Object.fromEntries(await Promise.all(TRADING_TABLES.map(async table => [table, await store.list(table)])));

export function qualifyTradingStore(name: string, open: OpenTradingHarness): void {
  describe(name, () => {
    it('store is idempotent under replay: complete fixture bytes, references and revisions survive reopen', async () => {
      const h = await open();
      try {
        assert.equal(await loadFixture(h.store, fixture), 377);
        const first = value(await h.store.commitDecision(plan)); assert.equal(first.changed, true); assert.equal(first.writes, 9);
        assert.deepEqual(await h.store.readDecision(plan.key), plan.decision);
        assert.deepEqual(await h.store.latestPortfolio(fixture.manifest.id), plan.portfolio);
        const before = await contents(h.store);
        const reopened = h.reopen ? await h.reopen() : h.store;
        assert.deepEqual(await contents(reopened), before);
        assert.equal(await loadFixture(reopened, fixture), 0);
        assert.deepEqual(value(await reopened.commitDecision(structuredClone(plan))), { ...first, changed: false, writes: 0 });
        assert.deepEqual(await contents(reopened), before);
        assert.deepEqual(await reopened.listPortfolios(fixture.manifest.id), [fixture.initial, plan.portfolio]);
        const copy = await reopened.get('portfolios', plan.portfolio.id); assert.ok(copy); copy.cash = 1;
        assert.deepEqual(await reopened.get('portfolios', plan.portfolio.id), plan.portfolio);
      } finally { await h.close(); }
    });
    it('twenty concurrent deliveries apply exactly one complete decision', async () => {
      const h = await open();
      try {
        await seed(h.store);
        const results = await Promise.all(Array.from({ length: 20 }, () => h.store.commitDecision(structuredClone(plan))));
        assert.ok(results.every(r => r.valid));
        assert.equal(results.map(value).filter(r => r.changed).length, 1);
        assert.equal(results.map(value).reduce((sum, r) => sum + r.writes, 0), 9);
        assert.equal((await h.store.list('fills')).length, 1); assert.equal((await h.store.list('ledger')).length, 4);
      } finally { await h.close(); }
    });
    for (const [index, step] of ['decision', 'intent', 'fill', 'ledger', 'ledger', 'ledger', 'ledger', 'portfolio', 'commit'].entries()) {
      it(`rollback after write ${index + 1} (${step}) leaves every table unchanged`, async () => {
        let probes = 0;
        const h = await open({ applyProbe: actual => { if (++probes === index + 1) { assert.equal(actual, step); throw new Error('forced trading rollback'); } } });
        try {
          await seed(h.store); const before = await contents(h.store);
          await assert.rejects(h.store.commitDecision(plan), /forced trading rollback/);
          assert.deepEqual(await contents(h.store), before);
          assert.equal(await h.store.readDecision(plan.key), undefined);
        } finally { await h.close(); }
      });
    }
    it('conflicting keys, stale predecessors and unbalanced or forged financial records refuse without writes', async () => {
      const h = await open();
      try {
        await seed(h.store);
        const unbalanced = { ...plan, ledgerEntries: [await reidentify(plan.ledgerEntries[0], { debit: plan.ledgerEntries[0].debit + 1 }), ...plan.ledgerEntries.slice(1)] };
        const forged = { ...plan, portfolio: await reidentify(plan.portfolio, { cash: plan.portfolio.cash + 1 }) };
        for (const input of [unbalanced, forged, { ...plan, ledgerEntries: [...plan.ledgerEntries, plan.ledgerEntries[0]] }]) {
          const before = await contents(h.store), refused = await h.store.commitDecision(input);
          assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TTRD1006');
          assert.deepEqual(await contents(h.store), before);
        }
        value(await h.store.commitDecision(plan));
        const different = { ...plan, decision: await reidentify(plan.decision, { reason: 'Different immutable decision' }) };
        const anotherKey = { ...plan.key, stage: 'second-commit' };
        const stale: TradingCommit = { ...plan, key: anotherKey, decision: await reidentify(plan.decision, { key: anotherKey }) };
        for (const input of [different, stale]) {
          const before = await contents(h.store), refused = await h.store.commitDecision(input);
          assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TTRD1006');
          assert.deepEqual(await contents(h.store), before);
        }
      } finally { await h.close(); }
    });
    it('artifact staging is immutable by stage key and bounded to the retained snapshot', async () => {
      const h = await open();
      try {
        await seed(h.store); value(await h.store.put('observations', fixture.observations[0]));
        const key = { ...plan.key, sessionId: fixture.sessions[1].key, stage: 'analyst' };
        const snapshot = value(await createTradingRecord('snapshot', { manifestId: fixture.manifest.id, asset: key.asset, sessionId: key.sessionId,
          cutoffAt: fixture.sessions[1].closeAt, observationIds: [fixture.observations[0].id], refused: [], providerErrors: [], portfolioId: fixture.initial.id, staleness: 1 }));
        value(await h.store.put('snapshots', snapshot));
        assert.equal((await h.store.put('snapshots', await reidentify(snapshot, { staleness: 0 }))).valid, false);
        const artifact = value(await createTradingRecord('analyst-report', { manifestId: fixture.manifest.id, key, role: 'market-analyst', snapshotId: snapshot.id,
          citations: snapshot.observationIds, model: { profile: 'scripted', identityId: '0'.repeat(64) }, promptRevision: '0'.repeat(64),
          spend: { calls: 1, toolCalls: 0, tokens: 10, usd: 0, retries: 0, repairs: 0, ms: 0 }, claims: [], summary: 'One available bar', signals: [], gaps: [] }));
        assert.equal(value(await h.store.stageArtifact(key, artifact)).writes, 1);
        assert.equal(value(await h.store.stageArtifact(key, artifact)).writes, 0);
        for (const altered of [await reidentify(artifact, { summary: 'Conflicting stage' }), await reidentify(artifact, { citations: ['absent-observation'] })])
          assert.equal((await h.store.stageArtifact(key, altered)).valid, false);
        assert.deepEqual(await h.store.list('artifacts'), [artifact]);
      } finally { await h.close(); }
    });
    it('snapshots refuse missing records, cross-asset evidence and observations published after the cutoff', async () => {
      const h = await open();
      try {
        await seed(h.store);
        const bar = fixture.observations[0]; value(await h.store.put('observations', bar));
        const body = { manifestId: fixture.manifest.id, asset: bar.asset, sessionId: fixture.sessions[0].key, cutoffAt: fixture.sessions[0].closeAt,
          observationIds: [bar.id], refused: [], providerErrors: [], portfolioId: fixture.initial.id, staleness: 0 };
        for (const altered of [body, { ...body, observationIds: ['absent-observation'] }, { ...body, asset: 'SYN-B' },
          { ...body, portfolioId: 'absent-portfolio' }, { ...body, sessionId: 'absent-session' }]) {
          const snapshot = value(await createTradingRecord('snapshot', altered));
          assert.equal((await h.store.put('snapshots', snapshot)).valid, false);
        }
        assert.equal((await h.store.list('snapshots')).length, 0);
      } finally { await h.close(); }
    });
  });
}
