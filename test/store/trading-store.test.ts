import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTangleDb, createTradingStore } from '@tangleai/store';
import { qualifyTradingStore } from '../trading/store-harness.ts';
import { tradingFixture, decisionFixture, loadFixture, value } from '../trading/fixtures.ts';

for (const mode of ['memory', 'file'] as const) qualifyTradingStore(`the ${mode} SQLite trading store`, async options => {
  const directory = await mkdtemp(join(tmpdir(), 'trading-store-'));
  const path = mode === 'memory' ? ':memory:' : join(directory, 'trading.db');
  let db = await openTangleDb({ path });
  return {
    store: createTradingStore(db, options),
    ...(mode === 'file' ? { async reopen() { await db.close(); db = await openTangleDb({ path }); return createTradingStore(db, options); } } : {}),
    async close() { await db.close(); await rm(directory, { recursive: true, force: true }); },
  };
});

it('a replay detects a missing retained fill instead of reporting a successful no-op', async () => {
  const db = await openTangleDb();
  try {
    const store = createTradingStore(db), fixture = await tradingFixture(), plan = await decisionFixture(fixture);
    await loadFixture(store, fixture); value(await store.commitDecision(plan));
    await db.collection('trading_fills').delete(plan.fills[0].id);
    const refused = await store.commitDecision(plan); assert.equal(refused.valid, false);
    if (!refused.valid) assert.equal(refused.issues[0].code, 'TTRD1006');
    assert.equal(await store.get('fills', plan.fills[0].id), undefined);
  } finally { await db.close(); }
});

it('replay also verifies the manifest, predecessor and decision-session context', async () => {
  const fixture = await tradingFixture(), plan = await decisionFixture(fixture);
  for (const fault of ['manifest', 'predecessor', 'session', 'execution-bar'] as const) {
    const db = await openTangleDb();
    try {
      const store = createTradingStore(db); await loadFixture(store, fixture); value(await store.commitDecision(plan));
      if (fault === 'manifest') await db.collection('trading_manifests').delete(fixture.manifest.id);
      if (fault === 'predecessor') await db.collection('trading_portfolios').put({ ...fixture.initial, cash: 1 });
      if (fault === 'session') await db.collection('trading_sessions').delete(fixture.sessions[0].id);
      if (fault === 'execution-bar') await db.collection('trading_observations').delete(plan.fills[0].sourceBarId);
      assert.equal((await store.commitDecision(plan)).valid, false, fault);
    } finally { await db.close(); }
  }
});
