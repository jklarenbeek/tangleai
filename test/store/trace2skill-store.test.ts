/**
 * The SQLite adapter answers the same skill lifecycle as the in-memory store,
 * in a shared database and in a file on disk: immutable puts stay immutable,
 * activation applies exactly once under twenty concurrent attempts, a forced
 * failure at any write stage leaves nothing, and a superseded directory and
 * its pages remain readable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTangleDb, createTrace2SkillDbStore, type TangleDb } from '@tangleai/store';
import { SCOPE, lifecycleRecords, runActivationRollback, runPartialWriteRefusal, runSkillLifecycle } from '../trace2skill/fixture.ts';

const records = await lifecycleRecords();

async function database(path?: string): Promise<TangleDb> {
  return openTangleDb(path === undefined ? {} : { path });
}

for (const label of ['in memory', 'on disk'] as const) describe(`SQLite ${label}`, () => {
  const open = async (suffix: string) => {
    if (label === 'in memory') return { db: await database(), cleanup: async () => {} };
    const directory = await mkdtemp(join(tmpdir(), 'tangle-trace2skill-'));
    return { db: await database(join(directory, `${suffix}.db`)), cleanup: () => rm(directory, { recursive: true, force: true }) };
  };

  it('passes the skill lifecycle', async () => {
    const { db, cleanup } = await open('lifecycle');
    try { await runSkillLifecycle(createTrace2SkillDbStore(db), records); }
    finally { await db.close(); await cleanup(); }
  });

  it('applies twenty concurrent activations exactly once', async () => {
    const { db, cleanup } = await open('cas');
    try {
      const store = createTrace2SkillDbStore(db);
      assert.ok((await store.putSnapshot(records.frozen)).valid);
      assert.ok((await store.markBundle(records.frozen.bundle.id, 'eligible')).valid);
      const outcomes = await Promise.all(Array.from({ length: 20 }, () =>
        store.activate(SCOPE, { versionId: null, revision: 0 }, records.frozen.bundle.id)));
      assert.equal(outcomes.filter(outcome => outcome.valid).length, 1);
      assert.equal(outcomes.filter(outcome => !outcome.valid).length, 19);
      assert.deepEqual(await store.head(SCOPE), { versionId: records.frozen.bundle.id, revision: 1 });
      const superseded = await store.getSnapshot(records.frozen.bundle.id);
      assert.ok(superseded.valid);
      assert.equal(superseded.value.files.length, records.frozen.files.length);
    }
    finally { await db.close(); await cleanup(); }
  });

  it('refuses a directory whose page conflicts without committing an earlier page', async () => {
    const { db, cleanup } = await open('partial');
    try { await runPartialWriteRefusal(createTrace2SkillDbStore(db), records); }
    finally { await db.close(); await cleanup(); }
  });

  it('leaves the prior directory active when any stage of the swap fails', async () => {
    const opened: Array<{ db: TangleDb, cleanup: () => Promise<void> }> = [];
    try {
      await runActivationRollback(async applyProbe => {
        const handle = await open(`swap-${opened.length}`);
        opened.push(handle);
        return createTrace2SkillDbStore(handle.db, { applyProbe });
      }, records);
    }
    finally { for (const handle of opened) { await handle.db.close(); await handle.cleanup(); } }
  });

  it('rolls back every write when a stage fails', async () => {
    for (const failAt of ['put:files', 'put:bundles', 'commit']) {
      const { db, cleanup } = await open(`rollback-${failAt.replace(':', '-')}`);
      try {
        let armed = true;
        const store = createTrace2SkillDbStore(db, { applyProbe: step => {
          if (armed && step === failAt) { armed = false; throw new Error(`forced ${step}`); }
        } });
        await assert.rejects(() => store.putSnapshot(records.frozen), /forced/);
        assert.equal((await store.listBy(records.frozen.bundle.id, 'files')).length, 0, failAt);
        assert.ok(!(await store.getBundle(records.frozen.bundle.id)).valid, failAt);
      }
      finally { await db.close(); await cleanup(); }
    }
  });
});
