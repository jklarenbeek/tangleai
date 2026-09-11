import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMasAgentContext } from '@tangleai/mas';
import { createDbLedgerStorage, openTangleDb } from '@tangleai/store';

const now = () => '2026-09-11T00:00:00Z';

describe('atomic database ledger storage', () => {
  it('shares counters across independent suite ledgers and survives reopening', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-ledger-'));
    let db = await openTangleDb({ path: join(dir, 'ledger.sqlite') });
    try {
      const left = createMasAgentContext({ storage: createDbLedgerStorage(db, 'shared'), now });
      const right = createMasAgentContext({ storage: createDbLedgerStorage(db, 'shared'), now });
      const records = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        (index % 2 ? left : right).ledger.addMemory({ text: `fact ${index}`, evidence: `record ${index}` })));
      assert.ok(records.every((record) => !('error' in record)), JSON.stringify(records));
      const ids = records.map((record) => (record as { id: string }).id);
      assert.equal(new Set(ids).size, 20);
      await left.putCorpus('report', 'durable source content');
      await db.close();
      db = await openTangleDb({ path: join(dir, 'ledger.sqlite') });
      const restored = createMasAgentContext({ storage: createDbLedgerStorage(db, 'shared'), now });
      for (const id of ids) assert.ok(await restored.ledger.getMemory(id));
      assert.equal(await restored.ledger.readSlot('report'), 'durable source content');
      const isolated = createMasAgentContext({ storage: createDbLedgerStorage(db, 'shared/other'), now });
      assert.equal(await isolated.ledger.getMemory(ids[0]), null);
    } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
  });

  it('rolls back escaped, asynchronous and throwing mutations and isolates reads', async () => {
    const db = await openTangleDb();
    try {
      const storage = createDbLedgerStorage(db, 'scope');
      await storage.set('a/one', { count: 1 });
      await storage.set('b/two', { count: 2 });
      await assert.rejects(storage.mutate!('a/', () => ({ next: { 'b/escape': 3 }, result: null })), /scope/);
      await assert.rejects(storage.mutate!('a/', (() => Promise.resolve({ result: null })) as never), /synchronous/);
      await assert.rejects(storage.mutate!('a/', (rows) => { rows['a/one'] = 99; throw new Error('rollback'); }), /rollback/);
      assert.deepEqual(await storage.get('a/one'), { count: 1 });
      const read = await storage.get('a/one') as { count: number }; read.count = 77;
      assert.deepEqual(await storage.get('a/one'), { count: 1 });
      assert.equal(await storage.mutate!({ keys: ['a/one'] }, () => ({ next: {}, result: 'deleted' })), 'deleted');
      assert.deepEqual(await storage.keys(''), ['b/two']);
    } finally { await db.close(); }
  });
});
