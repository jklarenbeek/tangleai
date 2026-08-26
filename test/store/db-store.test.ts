/**
 * @tangleai/store — the SQLite-backed MemoryStore behaves exactly like
 * the in-memory one (the policies must not be able to tell), and the
 * run log round-trips runs and their events.
 *
 * Runs on the node driver (`node:sqlite`, `:memory:`); the desktop
 * binary uses the bun driver through the same `openTangleDb` seam.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { nodeDriver } from '@jarenjs/db/node';
import { openTangleDb, createDbMemoryStore, createRunLog, type TangleDb } from '@tangleai/store';
import { createMemoryUnit } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

const AT = '2026-08-24T12:00:00Z';

describe('createDbMemoryStore over node:sqlite', () => {
  let db: TangleDb;

  before(async () => {
    db = await openTangleDb({ driver: nodeDriver() });
  });
  after(async () => {
    await db.close();
  });

  it('put/get/list/delete round-trip a memory unit', async () => {
    const store = createDbMemoryStore(db.collection('memories'));
    const unit = createMemoryUnit({
      text: 'the gate is npm run check',
      evidence: 'package.json scripts',
      tags: ['gate'],
      at: AT,
      embedding: [0.1, 0.2],
      embeddedBy: { model: 'test', dims: 2 },
      confidence: 0.8,
    });
    await store.put(unit);

    const got = await store.get(unit.id);
    assert.deepEqual(got, unit);

    const all = await store.list();
    assert.equal(all.length, 1);
    assert.deepEqual(all[0], unit);

    await store.delete(unit.id);
    assert.equal(await store.get(unit.id), undefined);
    assert.deepEqual(await store.list(), []);
  });

  it('a malformed unit is rejected at the boundary, not stored', async () => {
    const store = createDbMemoryStore(db.collection('memories'));
    const bad = { id: 'x', text: 'no evidence' } as unknown as MemoryUnit;
    await assert.rejects(() => store.put(bad), /MEMORY_UNIT_SCHEMA/);
    assert.equal(await store.get('x'), undefined);
  });

  it('reads are isolated — mutating a returned unit does not touch the store', async () => {
    const store = createDbMemoryStore(db.collection('memories'));
    const unit = createMemoryUnit({ text: 'isolated', evidence: 'e', at: AT });
    await store.put(unit);
    const got = await store.get(unit.id);
    assert.ok(got);
    got.tags.push('mutated');
    const again = await store.get(unit.id);
    assert.deepEqual(again?.tags, []);
    await store.delete(unit.id);
  });
});

describe('createRunLog', () => {
  it('records a run with ordered events and lists newest-first', async () => {
    const db = await openTangleDb({ driver: nodeDriver() });
    let tick = 0;
    const now = (): string => `2026-08-24T12:00:0${tick++}Z`;
    const log = createRunLog(db, { now });

    const first = await log.startRun('ingest');
    await log.recordEvent(first.id, { id: 'embed', status: 'ok', ms: 3 });
    await log.recordEvent(first.id, { id: 'novelty', status: 'ok', ms: 1 });
    await log.finishRun(first.id, 'ok', { admitted: 2 });

    const second = await log.startRun('chat');

    const runs = await log.listRuns();
    assert.equal(runs.length, 2);
    assert.equal(runs[0].id, second.id, 'newest run first');
    assert.equal(runs[1].status, 'ok');
    assert.deepEqual(runs[1].summary, { admitted: 2 });

    const detail = await log.getRun(first.id);
    assert.ok(detail);
    assert.deepEqual(detail.events.map((e) => e.node), ['embed', 'novelty']);
    assert.deepEqual(detail.events.map((e) => e.seq), [1, 2]);

    assert.equal(await log.getRun('r-nope'), undefined);
    await db.close();
  });
});
