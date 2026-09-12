import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeProcessDriver } from '@jarenjs/db/node-process';
import type { NodeProcessDriver } from '@jarenjs/db/node-process';
import { openTangleDb } from '@tangleai/store';
import { runSupervisedStoreExample } from '../../examples/supervised-store.ts';

const bun = process.versions.bun !== undefined;
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
async function open(driver: NodeProcessDriver, path: string) {
  const owner = await driver.open(path, { timeout: 50, queueTimeout: 1_000 });
  const db = await openTangleDb({ path, driver: { ...driver, open: async () => owner } });
  return { owner, db };
}

if (bun) {
  it('the supervised entry imports on Bun and refuses unsupported execution explicitly', async () => {
    const driver = nodeProcessDriver();
    await assert.rejects(() => driver.open(), code('JD0003'));
    assert.equal(driver.metrics().owners, 0);
  });
} else {
  it('the supervised host preserves both outcome domains and reopens with zero-effect replay', { timeout: 60_000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-process-outcomes-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const result = await runSupervisedStoreExample(join(dir, 'state.db'));
    assert.equal(result.first.domains, 2);
    assert.ok(result.first.writes > 0);
    assert.equal(result.replay.writes, 0);
    assert.equal(result.replay.sourceReads, 0);
    assert.equal(result.owners, 0);
  });

  it('deadline fencing rolls back an open Tangle transaction before explicit reopen', { timeout: 30_000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-process-rollback-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const driver = nodeProcessDriver({ maxOwners: 1 }), path = join(dir, 'state.db');
    const { owner, db } = await open(driver, path);
    let release: (() => void) | undefined;
    t.after(async () => {
      release?.();
      const [closed] = await Promise.allSettled([db.close()]);
      if (closed.status === 'rejected') assert.ok(code('JD2090')(closed.reason));
      await owner.settled();
    });
    await db.collection('settings').put({ key: 'committed', value: 1 });
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const pending = db.transaction(async tx => {
      await tx.collection('settings').put({ key: 'uncommitted', value: 2 });
      enter();
      await blocked;
      await tx.collection('settings').put({ key: 'late', value: 3 });
    }, { mode: 'immediate' });
    const drained = Promise.allSettled([pending]);
    await entered;
    const expired = owner.supervise(() => pending, { timeoutMs: 25 });
    await assert.rejects(expired, code('JD2097'));
    const settlement = await owner.settled();
    assert.equal(settlement.safeToReplace, true);
    assert.equal(settlement.transaction, 'rolled-back');
    release!();
    assert.equal((await drained)[0].status, 'rejected');
    await assert.rejects(() => db.collection('settings').get('committed'), code('JD2090'));
    const fresh = await open(driver, path);
    try {
      assert.ok(fresh.owner.settlement().generation > settlement.generation);
      assert.deepEqual(await fresh.db.collection('settings').get('committed'), { key: 'committed', value: 1 });
      assert.equal(await fresh.db.collection('settings').get('uncommitted'), undefined);
      assert.equal(await fresh.db.collection('settings').get('late'), undefined);
      assert.equal((await fresh.db.integrityCheck()).ok, true);
    } finally { await fresh.db.close(); await fresh.owner.settled(); }
  });

  it('pre-abort and callback failure preserve a healthy owner; same-file opens cannot bypass ownership', { timeout: 30_000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'tangle-process-admission-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const driver = nodeProcessDriver({ maxOwners: 2 }), path = join(dir, 'state.db');
    const { owner, db } = await open(driver, path);
    try {
      let calls = 0;
      await assert.rejects(() => owner.supervise(() => { calls++; }, { signal: AbortSignal.abort() }), code('JD2097'));
      assert.equal(calls, 0);
      await assert.rejects(() => driver.open(path), code('JD2091'));
      const fault = new Error('host callback failure');
      await assert.rejects(() => owner.supervise(() => { throw fault; }), error => error === fault);
      await owner.supervise(() => db.collection('settings').put({ key: 'after-failure', value: true }), { timeoutMs: 5_000 });
      assert.equal(owner.settlement().status, 'healthy');
      assert.equal(driver.metrics().owners, 1);
    } finally { await db.close(); await owner.settled(); }
    assert.equal(driver.metrics().owners, 0);
  });
}
