import assert from 'node:assert/strict';
import { it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRunLog, openTangleDb } from '@tangleai/store';

const now = () => '2026-10-03T00:00:00.000Z';
const nodeFrame = { kind: 'node' as const, body: { node: 'discovery', status: 'ok', ms: 0 } };

it('recreated run logs cannot overwrite completed runs at a fixed clock', async () => {
  const db = await openTangleDb();
  try {
    const first = createRunLog(db, { now });
    const a = await first.startRun('research');
    assert.equal((await first.appendFrame(a.id, nodeFrame)).ok, true);
    assert.equal((await first.finishRun(a.id, 'ok', { projectId: 'first' })).ok, true);
    const before = await first.getRun(a.id);
    const frames = await first.frames(a.id);
    const second = createRunLog(db, { now });
    const b = await second.startRun('research');
    assert.notEqual(b.id, a.id);
    assert.equal((await second.listRuns()).length, 2);
    assert.deepEqual(await second.getRun(a.id), before);
    assert.deepEqual(await second.frames(a.id), frames);
    assert.deepEqual(await second.frames(b.id), []);
  } finally { await db.close(); }
});

it('concurrent log instances and a reopened database retain distinct run addresses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tangle-run-identities-'));
  const path = join(dir, 'runs.db');
  try {
    const db = await openTangleDb({ path });
    let ids: string[];
    try {
      const runs = await Promise.all(Array.from({ length: 12 }, () => createRunLog(db, { now }).startRun('research')));
      ids = runs.map(run => run.id);
      assert.equal(new Set(ids).size, runs.length);
      assert.equal((await createRunLog(db).listRuns()).length, runs.length);
    } finally { await db.close(); }
    const reopened = await openTangleDb({ path });
    try {
      const log = createRunLog(reopened, { now });
      const next = await log.startRun('research');
      assert.equal(ids.includes(next.id), false);
      assert.equal((await log.listRuns()).length, ids.length + 1);
      for (const id of ids) assert.equal((await log.getRun(id))?.run.id, id);
    } finally { await reopened.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('the native run-log writer joins its caller transaction and refuses an expired handle', async () => {
  const db = await openTangleDb();
  try {
    const reader = createRunLog(db, { now });
    const run = await reader.startRun('research');
    await assert.rejects(db.transaction(async tx => {
      const log = createRunLog(tx, { now });
      assert.equal((await log.appendFrame(run.id, nodeFrame)).ok, true);
      await tx.collection('settings').put({ key: 'research-transaction', value: 'rolled-back' });
      throw new Error('forced transaction rollback');
    }, { mode: 'immediate' }), /forced transaction rollback/);
    assert.deepEqual(await reader.frames(run.id), []);
    assert.equal(await db.collection('settings').get('research-transaction'), undefined);
    const expired = await db.transaction(async tx => {
      const log = createRunLog(tx, { now });
      const appended = await log.appendFrame(run.id, nodeFrame);
      assert.equal(appended.ok, true);
      if (appended.ok) assert.equal(appended.frame.seq, 1);
      await tx.collection('settings').put({ key: 'research-transaction', value: 'committed' });
      return log;
    }, { mode: 'immediate' });
    assert.equal((await reader.frames(run.id)).length, 1);
    assert.deepEqual(await db.collection('settings').get('research-transaction'), { key: 'research-transaction', value: 'committed' });
    const closed = (cause: unknown) => typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'JD2070';
    await assert.rejects(expired.appendFrame(run.id, nodeFrame), closed);
    await assert.rejects(expired.frames(run.id), closed);
    assert.equal((await reader.frames(run.id)).length, 1);
  } finally { await db.close(); }
});

it('run creation snapshots its config identity before transactional admission yields', async () => {
  const db = await openTangleDb();
  try {
    const log = createRunLog(db, { now });
    const options = { identityId: 'a'.repeat(64) };
    const pending = log.startRun('research', options);
    options.identityId = 'b'.repeat(64);
    const run = await pending;
    assert.equal(run.identityId, 'a'.repeat(64));
    assert.equal((await log.getRun(run.id))?.run.identityId, 'a'.repeat(64));
  } finally { await db.close(); }
});
