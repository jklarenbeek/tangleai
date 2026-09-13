import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTangleDb, createTemporalDbStore } from '@tangleai/store';
import { prepareTemporal, temporalValue, createTemporalSessionIndex } from '@tangleai/memory/temporal';
import { temporalTestBundle, preparationInput, extractionReply, chatResponse, TEMPORAL_TEST_MODEL } from '../fixtures/temporal-provider.ts';
test('real SQLite reopen replays preparation with no purchase and rebuilds observation indexes once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'temporal-provider-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.db'), bundle = await temporalTestBundle(), input = preparationInput(bundle); let calls = 0;
  const fetch: typeof globalThis.fetch = async () => { calls++; return chatResponse(extractionReply(bundle)); };
  let db = await openTangleDb({ path }), store = createTemporalDbStore(db);
  temporalValue(await prepareTemporal(input, { store, fetch, model: TEMPORAL_TEST_MODEL }));
  const cache = createTemporalSessionIndex(store); temporalValue(await cache.get(input.scope)); temporalValue(await cache.get(input.scope)); assert.equal(cache.stats().constructions, 1);
  const before = temporalValue(await store.snapshot(input.scope)); await db.close();
  db = await openTangleDb({ path }); store = createTemporalDbStore(db);
  try {
    const replay = temporalValue(await prepareTemporal(input, { store, fetch, model: TEMPORAL_TEST_MODEL }));
    assert.equal(calls, 1); assert.equal(replay.writes, 0); assert.equal(store.stats().writes, 0);
    assert.deepEqual(temporalValue(await store.snapshot(input.scope)), before);
    const reopened = createTemporalSessionIndex(store); temporalValue(await reopened.get(input.scope)); temporalValue(await reopened.get(input.scope)); assert.equal(reopened.stats().constructions, 1);
    let failing = true; const guarded = createTemporalDbStore(db, { applyProbe: step => { if (failing && step === 'put:heads') throw Error('activation failed'); } });
    const result = await prepareTemporal({ ...input, key: 'new', policyIdentity: 'new', expectedHead: before.head }, { store: guarded, fetch, model: TEMPORAL_TEST_MODEL }); failing = false;
    assert.equal(result.status !== 'success' && result.reason, 'storage-failure');
    assert.deepEqual(temporalValue(await store.snapshot(input.scope)), before);
    assert.equal(temporalValue(await store.operation(input.scope, 'new'))!.phase, 'failed');
  } finally { await db.close(); }
});
