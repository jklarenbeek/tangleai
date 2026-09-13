import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '@jarenjs/db';
import { openTangleDb, createTemporalDbStore, createDbMemoryStore, TANGLE_DB_MODEL, pickDriver } from '@tangleai/store';
import { createMemoryUnit } from '@tangleai/memory';
import type { TemporalResult } from '@tangleai/memory/temporal';
import { TEMPORAL_FIXTURES } from '../fixtures/temporal.ts';
import { buildTemporalFixture, rebuildTemporalFixture } from '../../benchmark/lib/temporal-runtime-fixtures.ts';
const must = <T>(r: TemporalResult<T>): T => { if (r.status !== 'success') throw Error(`${r.reason}: ${r.detail}`); return r.value; };
async function bundle(id = 'T01') { const { expected: _, ...fixture } = TEMPORAL_FIXTURES.find(f => f.id === id)!; return must(await buildTemporalFixture(fixture)).bundle; }

test('SQLite immutable projection, operation receipt and ABA revision survive actual close/reopen', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'temporal-reopen-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.db'), b = await bundle();
  let db = await openTangleDb({ path }), store = createTemporalDbStore(db);
  const first = must(await store.apply(b, { key: 'first', expectedHead: null }));
  const snapshot = must(await store.snapshot(b.projection.scope));
  await db.close(); db = await openTangleDb({ path }); store = createTemporalDbStore(db);
  try {
    assert.deepEqual(must(await store.snapshot(b.projection.scope)), snapshot);
    const replay = must(await store.apply(b, { key: 'first', expectedHead: null }));
    assert.equal(replay.replayed, true); assert.equal(replay.writes, 0); assert.equal(store.stats().writes, 0);
    const changed = must(await rebuildTemporalFixture(b, { policyIdentity: 'changed' }));
    assert.equal((await store.apply(changed, { key: 'first', expectedHead: null })).status, 'refused');
    const second = must(await store.apply(changed, { key: 'second', expectedHead: first.head }));
    const third = must(await store.apply(b, { key: 'third', expectedHead: second.head }));
    assert.equal(third.head.revision, 3); assert.equal(third.head.versionId, first.head.versionId);
    const stale = await store.snapshot(b.projection.scope, first.head);
    assert.equal(stale.status !== 'success' && stale.reason, 'stale-projection');
  } finally { await db.close(); }
});

test('two overlapping writers on the same SQLite owner cannot both activate a head', async () => {
  const db = await openTangleDb();
  try {
    const a = await bundle(), b = must(await rebuildTemporalFixture(a, { policyIdentity: 'contender' }));
    const outcomes = await Promise.all([
      createTemporalDbStore(db).apply(a, { key: 'a', expectedHead: null }),
      createTemporalDbStore(db).apply(b, { key: 'b', expectedHead: null }),
    ]);
    assert.equal(outcomes.filter(r => r.status === 'success').length, 1);
    assert.equal(outcomes.find(r => r.status !== 'success')?.reason, 'stale-projection');
  } finally { await db.close(); }
});

test('SQLite failures at every staging and activation boundary roll back the complete transaction', async () => {
  for (const step of ['put:occurrences', 'put:claims', 'put:projections', 'put:heads', 'put:operations', 'commit']) {
    const db = await openTangleDb(); let failing = false;
    try {
      const store = createTemporalDbStore(db, { applyProbe: current => { if (failing && step === current) throw Error('injected'); } });
      const initial = await bundle(), head = must(await store.apply(initial, { key: 'initial', expectedHead: null })).head;
      const { expected: _, ...fixture } = TEMPORAL_FIXTURES.find(f => f.id === 'T13')!;
      const changed = must(await buildTemporalFixture({ ...fixture, claims: TEMPORAL_FIXTURES[0].claims })).bundle;
      const prior = must(await store.snapshot(initial.projection.scope));
      failing = true; const result = await store.apply(changed, { key: 'failed', expectedHead: head }); failing = false;
      assert.equal(result.status !== 'success' && result.reason, 'storage-failure', step);
      assert.deepEqual(must(await store.snapshot(initial.projection.scope)), prior, step);
      assert.equal((await db.integrityCheck()).ok, true);
    } finally { await db.close(); }
  }
});

test('the additive temporal model opens a pre-temporal database without changing ordinary memories', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'temporal-upgrade-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.db');
  const collections = Object.fromEntries(Object.entries(TANGLE_DB_MODEL.collections).filter(([name]) => !name.startsWith('temporal_')));
  const old = await openStore({ ...TANGLE_DB_MODEL, collections }, { path, driver: pickDriver() });
  const unit = createMemoryUnit({ text: 'Preserve historical memory', evidence: 'host', at: '2024-01-01T00:00:00Z' });
  await createDbMemoryStore(old.collection('memories')).put(unit); await old.close();
  const db = await openTangleDb({ path });
  try {
    assert.deepEqual(await createDbMemoryStore(db.collection('memories')).get(unit.id), unit);
    assert.equal(must(await createTemporalDbStore(db).head('empty')), null);
    must(await createTemporalDbStore(db).apply(await bundle(), { key: 'new', expectedHead: null }));
    assert.equal((await db.integrityCheck()).ok, true);
  } finally { await db.close(); }
});
