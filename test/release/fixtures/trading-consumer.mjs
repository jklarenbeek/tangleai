import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openTangleDb, createTradingStore, createMasStore, createMasSegmentDriver } from '@tangleai/store';
import schema from '@tangleai/trading/schemas/trading' with { type: 'json' };
import { tradingConsumerFixture, exerciseTradingConsumer, qualifyTradingBrowser } from './trading-browser.mjs';
assert.match(import.meta.resolve('@tangleai/trading'), /\.js$/); assert.ok(schema.$defs.tradingCommit);
const directory = process.env.TANGLE_FIXTURE_DIRECTORY; assert.ok(directory);
const before = globalThis.fetch; globalThis.fetch = () => { throw Error('Trading consumer forbids network'); };
let db;
try {
  const fixture = await tradingConsumerFixture(), expected = { writes: 9, replayWrites: 0, quantity: 10, refused: 1, missing: 1 };
  assert.deepEqual(await qualifyTradingBrowser(), expected);
  const path = join(directory, 'trading.db'); db = await openTangleDb({ path, jobs: { now: () => 1000000, random: () => 0.5 } });
  const driver = createMasSegmentDriver(db, createMasStore(db), { owner: 'packed-trading', leaseMs: 60000 });
  assert.equal(await driver.drive('0'.repeat(64), async () => { throw Error('Empty packed queue cannot dispatch'); }, new AbortController().signal), false);
  assert.deepEqual(await exerciseTradingConsumer(createTradingStore(db), fixture), expected);
  await db.close(); db = await openTangleDb({ path });
  const replay = await createTradingStore(db).commitDecision(fixture.plan); assert.ok(replay.valid); assert.equal(replay.value.writes, 0);
  assert.deepEqual(await createTradingStore(db).readDecision(fixture.plan.key), fixture.plan.decision);
  console.log(JSON.stringify({ tradingInstalled: true, ...expected, reopened: true }));
} finally { if (db) await db.close(); globalThis.fetch = before; }
