/**
 * A settle that crashed, at every side of the workspace's removal, is
 * finished by `reconcileCleanups`, on the real git host and on both stores
 * (the database one reopened after the crash). The cleanup receipt is
 * written before the swap and fenced to the workspace instance, so recovery
 * never deletes a workspace recreated at the same path and never reapplies a
 * completed cleanup; terminal status alone is not evidence of cleanup.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { settleExperiment, reconcileCleanups, CLEANUP_DONE, CLEANUP_INTENT } from '@tangleai/evolve/host';
import { createMemoryEvolveStore, sealRecord, type EvolveStore } from '@tangleai/evolve';
import type { EvolveExperiment } from '@tangleai/evolve/contracts';
import { createEvolveStore, openTangleDb } from '@tangleai/store';

import { withEvolveRepository, stageProposal, rawGit, type EvolveRepositoryFixture } from './fixture.ts';

const ABANDON = { decision: 'abandoned', reason: 'equal', code: 'TEVO1008' } as const;

async function heldExperiment(store: EvolveStore, fixture: EvolveRepositoryFixture, experimentId: string): Promise<EvolveExperiment> {
  const seeded = await sealRecord<EvolveExperiment>({
    schemaVersion: 1, kind: 'experiment', experimentId, repositoryId: fixture.repository.repositoryId,
    baseRevision: fixture.baseRevision, strategyId: 'S-partial-select', proposalId: experimentId,
    status: 'decided', runIdentityId: 'r1', revision: 1, history: [],
  });
  assert.ok(seeded.ok);
  assert.ok((await store.putRecord(seeded.value)).ok);
  return seeded.value;
}

const branchExists = (root: string, experimentId: string) =>
  rawGit(root, 'show-ref', '--verify', 'refs/heads/exp/' + experimentId).then(() => true).catch(() => false);

/** Each test once per store: memory, and the database store reopened between the crash and the recovery. */
async function eachStore(body: (open: () => Promise<EvolveStore>, reopen: () => Promise<EvolveStore>) => Promise<void>) {
  const memory = createMemoryEvolveStore();
  await body(async () => memory, async () => memory);
  const dir = await mkdtemp(join(tmpdir(), 'tangle-evolve-cleanup-'));
  const opened: { close(): Promise<void> | void }[] = [];
  const open = async () => { const db = await openTangleDb({ path: join(dir, 'evolve.sqlite') }); opened.push(db); return createEvolveStore(db); };
  try {
    let first: EvolveStore | null = null;
    await body(async () => (first = await open()), async () => { await opened.at(-1)?.close(); return open(); });
    void first;
  } finally {
    for (const db of opened) await Promise.resolve(db.close()).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}

describe('recovering a settle that crashed', () => {
  it('before the swap: the receipt is not live, and settling again finishes the work', async () => {
    await eachStore(async (open, reopen) => withEvolveRepository(async (fixture) => {
      const store = await open();
      const experiment = await heldExperiment(store, fixture, 'e-before');
      const staged = await stageProposal(fixture, 'e-before', 'noop-comment');
      // the crash: the intent is written, the swap never lands
      const crashing = { ...store, transitionExperiment: async () => { throw new Error('crash before the swap'); } } as EvolveStore;
      await assert.rejects(settleExperiment({ host: fixture.host, store: crashing, experiment, decision: ABANDON, worktreePath: staged.path }), /crash before the swap/);
      const after = await reopen();
      assert.ok((await after.getKey(CLEANUP_INTENT, 'e-before')).ok);
      const recovered = await reconcileCleanups({ store: after, host: fixture.host });
      assert.deepEqual(recovered.ok && recovered.value, { examined: 1, completed: 0, refused: [] }, 'the experiment never swapped: nothing is removed');
      assert.equal(await branchExists(fixture.repositoryRoot, 'e-before'), true);
      const again = await settleExperiment({ host: fixture.host, store: after, experiment: (await after.getExperiment('e-before') as any).value, decision: ABANDON, worktreePath: staged.path });
      assert.equal(again.ok, true, JSON.stringify(again));
      assert.equal(await branchExists(fixture.repositoryRoot, 'e-before'), false);
    }));
  });

  it('after the swap, before removal: recovery removes this workspace and its branch, once', async () => {
    await eachStore(async (open, reopen) => withEvolveRepository(async (fixture) => {
      const store = await open();
      const experiment = await heldExperiment(store, fixture, 'e-after');
      const staged = await stageProposal(fixture, 'e-after', 'noop-comment');
      const crashing = { ...fixture.host, remove: async () => { throw new Error('crash before removal'); } };
      await assert.rejects(settleExperiment({ host: crashing, store, experiment, decision: ABANDON, worktreePath: staged.path }), /crash before removal/);
      const after = await reopen();
      assert.equal((await after.getExperiment('e-after') as any).value.status, 'abandoned', 'terminal, but not yet clean');
      assert.equal((await after.getKey(CLEANUP_DONE, 'e-after') as any).value, null);
      const recovered = await reconcileCleanups({ store: after, host: fixture.host });
      assert.deepEqual(recovered.ok && recovered.value, { examined: 1, completed: 1, refused: [] });
      assert.equal((await fixture.host.instance(staged.path) as any).value.exists, false);
      assert.equal(await branchExists(fixture.repositoryRoot, 'e-after'), false);
      const twice = await reconcileCleanups({ store: after, host: fixture.host });
      assert.deepEqual(twice.ok && twice.value, { examined: 0, completed: 0, refused: [] }, 'a completed cleanup is never reapplied');
    }));
  });

  it('between git steps, and after removal: the steps left are finished, and none is repeated', async () => {
    await eachStore(async (open, reopen) => withEvolveRepository(async (fixture) => {
      const store = await open();
      for (const id of ['e-between', 'e-removed']) {
        const experiment = await heldExperiment(store, fixture, id);
        const staged = await stageProposal(fixture, id, 'noop-comment');
        const crashing = {
          ...fixture.host,
          // e-between: the worktree went, the crash came before prune and branch -D;
          // e-removed: all three steps ran, the crash came before the receipt's completion
          remove: async (path: string, options: any) => {
            if (id === 'e-between') { await rawGit(fixture.repositoryRoot, 'worktree', 'remove', '--force', path); throw new Error('crash between steps'); }
            await fixture.host.remove(path, options); throw new Error('crash after removal');
          },
        };
        await assert.rejects(settleExperiment({ host: crashing, store, experiment, decision: ABANDON, worktreePath: staged.path }), /crash/);
      }
      assert.equal(await branchExists(fixture.repositoryRoot, 'e-between'), true, 'the branch outlived the crash');
      const after = await reopen();
      const recovered = await reconcileCleanups({ store: after, host: fixture.host });
      assert.deepEqual(recovered.ok && recovered.value, { examined: 2, completed: 2, refused: [] });
      assert.equal(await branchExists(fixture.repositoryRoot, 'e-between'), false);
      assert.equal(await branchExists(fixture.repositoryRoot, 'e-removed'), false);
    }));
  });

  it('refuses a workspace recreated at the same path, and leaves it as it is', async () => {
    await eachStore(async (open, reopen) => withEvolveRepository(async (fixture) => {
      const store = await open();
      const experiment = await heldExperiment(store, fixture, 'e-again');
      const staged = await stageProposal(fixture, 'e-again', 'noop-comment');
      const crashing = { ...fixture.host, remove: async () => { throw new Error('crash before removal'); } };
      await assert.rejects(settleExperiment({ host: crashing, store, experiment, decision: ABANDON, worktreePath: staged.path }), /crash/);
      // a person cleaned up by hand, and the same path was made again: another instance
      await fixture.host.remove(staged.path, { deleteBranch: true, experimentId: 'e-again' });
      const recreated = await fixture.host.create({ experimentId: 'e-again', baseRevision: fixture.baseRevision });
      assert.ok(recreated.ok);
      const after = await reopen();
      const recovered = await reconcileCleanups({ store: after, host: fixture.host });
      assert.deepEqual(recovered.ok && recovered.value, { examined: 1, completed: 0, refused: [{ experimentId: 'e-again', reason: 'recreated' }] });
      assert.equal((await fixture.host.instance(staged.path) as any).value.exists, true, 'the recreated workspace is untouched');
      assert.equal(await branchExists(fixture.repositoryRoot, 'e-again'), true);
    }));
  });
});
