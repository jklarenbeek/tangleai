import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTangleDb, createTemporalDbStore, backfillTemporalBatch, createDbMemoryStore } from '@tangleai/store';
import { createMemoryUnit, recallByEmbedding } from '@tangleai/memory';
import type { TemporalResult } from '@tangleai/memory/temporal';
const must = <T>(r: TemporalResult<T>): T => { if (r.status !== 'success') throw Error(`${r.reason}: ${r.detail}`); return r.value; };
test('bounded backfill resumes after failure and reopen, then replays with no writes or legacy changes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'temporal-backfill-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.db'), embeddedBy = { model: 'fixture-2', dims: 2 };
  const units = Array.from({ length: 5 }, (_, i) => createMemoryUnit({ text: `legacy ${i}`, evidence: 'host', at: '2024-01-01T00:00:00Z', embedding: [1, 0], embeddedBy }));
  const options = { scope: 'legacy', subject: 'alex', key: 'backfill', embeddedBy, expectedHead: null, batchSize: 2 };
  let db = await openTangleDb({ path });
  for (const unit of units) await createDbMemoryStore(db.collection('memories')).put(unit);
  const before = recallByEmbedding(units, [1, 0]);
  const first = must(await backfillTemporalBatch(db, units, options));
  assert.equal(first.cursor, 2); assert.equal(first.complete, false); assert.equal(first.stagedWrites, 3);
  assert.equal(must(await createTemporalDbStore(db).head('legacy')), null);
  const interrupted = await backfillTemporalBatch(db, units, { ...options, applyProbe: step => { if (step === 'put:occurrences') throw Error('interrupted'); } });
  assert.equal(interrupted.status, 'refused'); await db.close(); db = await openTangleDb({ path });
  try {
    let result = must(await backfillTemporalBatch(db, units, options));
    assert.equal(result.cursor, 4);
    while (!result.complete) { assert.equal(must(await createTemporalDbStore(db).head('legacy')), null); result = must(await backfillTemporalBatch(db, units, options)); }
    assert.equal(result.cursor, 11); assert.equal(result.unknownValidity, 5); assert.equal(result.receipt!.head.revision, 1);
    const snapshot = must(await createTemporalDbStore(db).snapshot('legacy'));
    assert.equal(snapshot.sources.length, 5); assert.equal(snapshot.claims.length, 5);
    assert.ok(snapshot.claims.every(c => c.time.kind === 'unknown'));
    const replay = must(await backfillTemporalBatch(db, units, options));
    assert.equal(replay.stagedWrites, 0); assert.equal(replay.receipt!.writes, 0); assert.equal(replay.receipt!.activations, 0);
    assert.equal((await backfillTemporalBatch(db, units.slice(1), options)).status, 'refused');
    const retained = await createDbMemoryStore(db.collection('memories')).list();
    assert.deepEqual([...retained].sort((a, b) => a.id.localeCompare(b.id)), [...units].sort((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual(recallByEmbedding(retained, [1, 0]), before);
  } finally { await db.close(); }
});
