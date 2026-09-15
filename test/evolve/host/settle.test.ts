/**
 * Settling, and the asymmetry that makes a kept experiment safe.
 *
 * A keep does NOT land anything. The worktree goes and the branch stays,
 * unmerged, with a review bundle addressed to a person — so the strongest
 * assertion in this file is the negative one: after a keep, `main` is
 * still exactly where it was, and nothing was merged, pushed or checked
 * out. The campaign never lands its own work, and the test says so about
 * the protected refs directly rather than trusting that no merge verb
 * exists to call.
 *
 * The losing paths are the common ones and they leave nothing behind: the
 * worktree and the branch both go, and the decision record is the whole
 * trace. `uncertain` is the exception in the other direction — an effect
 * nobody can account for is not a licence to tidy up.
 *
 * The second-settle test pins the ordering inside the module: the
 * compare-and-swap happens BEFORE the removal, so a repeated settle loses
 * the swap and never reaches a `worktree remove`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { settleExperiment, dispositionOf } from '@tangleai/evolve/host';
import { createMemoryEvolveStore, sealRecord } from '@tangleai/evolve';
import type { EvolveExperiment } from '@tangleai/evolve/contracts';
import type { EvolveStore } from '@tangleai/evolve';

import { withEvolveRepository, stageProposal, rawGit, operatorDigest, type EvolveRepositoryFixture } from './fixture.ts';

const BUNDLE = {
  gateResultIds: ['g1'],
  measurementId: 'm1',
  decisionId: 'd1',
  runIdentityId: 'r1',
  effectRecordIds: ['e1/gate'],
};

/** An experiment held at `decided`, which is where a settle starts from. */
async function heldExperiment(
  store: EvolveStore, fixture: EvolveRepositoryFixture, experimentId: string,
): Promise<EvolveExperiment> {
  const seeded = await sealRecord<EvolveExperiment>({
    schemaVersion: 1,
    kind: 'experiment',
    experimentId,
    repositoryId: fixture.repository.repositoryId,
    baseRevision: fixture.baseRevision,
    strategyId: 'S-partial-select',
    proposalId: experimentId,
    status: 'decided',
    runIdentityId: 'r1',
    revision: 1,
    history: [],
  });
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  const written = await store.putRecord((seeded as { value: EvolveExperiment }).value);
  assert.equal(written.ok, true);
  return (seeded as { value: EvolveExperiment }).value;
}

const branchExists = async (repositoryRoot: string, branch: string): Promise<boolean> =>
  rawGit(repositoryRoot, 'show-ref', '--verify', 'refs/heads/' + branch).then(() => true).catch(() => false);

describe('the disposition table', () => {
  it('keeps the branch only for a keep, and touches nothing when uncertain', () => {
    assert.deepEqual(dispositionOf('kept'), { removeWorktree: true, deleteBranch: false, command: 'record' });
    assert.deepEqual(dispositionOf('abandoned'), { removeWorktree: true, deleteBranch: true, command: 'abandon' });
    assert.deepEqual(dispositionOf('refused'), { removeWorktree: true, deleteBranch: true, command: 'refuse' });
    assert.deepEqual(dispositionOf('uncertain'), { removeWorktree: false, deleteBranch: false, command: 'uncertain' });
  });
});

describe('settling a kept experiment', () => {
  it('removes the worktree, leaves the branch, and merges nothing', async () => {
    await withEvolveRepository(async (fixture) => {
      const store = createMemoryEvolveStore();
      const experiment = await heldExperiment(store, fixture, 'e-keep');
      const staged = await stageProposal(fixture, 'e-keep', 'improve-partial-select');

      const { stdout: mainBefore } = await rawGit(fixture.repositoryRoot, 'rev-parse', 'main');

      const settled = await settleExperiment({
        host: fixture.host, store, experiment,
        decision: { decision: 'kept', reason: 'improved', code: null },
        worktreePath: staged.path,
        bundle: BUNDLE,
      });
      assert.equal(settled.ok, true, JSON.stringify(settled));
      const value = (settled as {
        value: {
          worktreeRemoved: boolean, branchDeleted: boolean,
          reviewBundle: { branch: string, headRevision: string, diffBytes: number, diffDigest: string } | null,
          experiment: { status: string },
        },
      }).value;

      assert.equal(value.worktreeRemoved, true);
      assert.equal(value.branchDeleted, false, 'the branch IS the deliverable');
      assert.equal(await branchExists(fixture.repositoryRoot, 'exp/e-keep'), true,
        'a kept experiment survives as an unmerged branch');
      assert.equal(value.experiment.status, 'recorded');

      // Nothing landed. This is the assertion the whole design exists for.
      const { stdout: mainAfter } = await rawGit(fixture.repositoryRoot, 'rev-parse', 'main');
      assert.equal(mainAfter.trim(), mainBefore.trim(), 'main never moves');
      assert.equal(mainAfter.trim(), fixture.baseRevision);

      const bundle = value.reviewBundle;
      assert.ok(bundle !== null, 'a keep writes its review bundle');
      assert.equal(bundle.branch, 'exp/e-keep');
      assert.equal(bundle.headRevision, staged.revision, 'the bundle names the candidate revision');
      assert.ok(bundle.diffBytes > 0, 'and carries the diff it is asking someone to read');
      assert.match(bundle.diffDigest, /^[a-f0-9]{64}$/);
    });
  });

  it('writes the bundle where it can be read back by id', async () => {
    await withEvolveRepository(async (fixture) => {
      const store = createMemoryEvolveStore();
      const experiment = await heldExperiment(store, fixture, 'e-bundle');
      const staged = await stageProposal(fixture, 'e-bundle', 'improve-partial-select');

      const settled = await settleExperiment({
        host: fixture.host, store, experiment,
        decision: { decision: 'kept', reason: 'improved', code: null },
        worktreePath: staged.path, bundle: BUNDLE,
      });
      const bundle = (settled as { value: { reviewBundle: { id: string } } }).value.reviewBundle;
      const held = await store.getRecord(bundle.id);
      assert.equal(held.ok, true);
      assert.equal((held as { value: { kind: string } }).value.kind, 'review-bundle');
    });
  });

  it('refuses to settle a keep with no evidence to bundle', async () => {
    await withEvolveRepository(async (fixture) => {
      const store = createMemoryEvolveStore();
      const experiment = await heldExperiment(store, fixture, 'e-nobundle');
      const settled = await settleExperiment({
        host: fixture.host, store, experiment,
        decision: { decision: 'kept', reason: 'improved', code: null },
      });
      assert.equal(settled.ok, false);
      assert.equal((settled as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1010');
    });
  });
});

describe('settling a loss', () => {
  for (const [decision, reason, command] of [
    ['abandoned', 'regression', 'abandon'],
    ['refused', 'goalpost', 'refuse'],
  ] as const) {
    it('removes both the worktree and the branch when ' + decision, async () => {
      await withEvolveRepository(async (fixture) => {
        const store = createMemoryEvolveStore();
        const experiment = await heldExperiment(store, fixture, 'e-' + command);
        const staged = await stageProposal(fixture, 'e-' + command, 'noop-comment');
        assert.equal(await branchExists(fixture.repositoryRoot, 'exp/e-' + command), true);

        const settled = await settleExperiment({
          host: fixture.host, store, experiment,
          decision: { decision, reason, code: 'TEVO1008' },
          worktreePath: staged.path,
        });
        assert.equal(settled.ok, true, JSON.stringify(settled));
        const value = (settled as {
          value: { branchDeleted: boolean, reviewBundle: unknown, experiment: { status: string } },
        }).value;
        assert.equal(value.branchDeleted, true);
        assert.equal(value.reviewBundle, null, 'a loss produces no report to read');
        assert.equal(value.experiment.status, decision);
        assert.equal(await branchExists(fixture.repositoryRoot, 'exp/e-' + command), false,
          'a loss that leaves debris is a loss nobody will clean up');
      });
    });
  }

  it('deletes the branch the experiment owns, not one derived from where the worktree sat', async () => {
    await withEvolveRepository(async (fixture) => {
      const store = createMemoryEvolveStore();
      const experiment = await heldExperiment(store, fixture, 'e-named');
      const staged = await stageProposal(fixture, 'e-named', 'noop-comment');
      // A second experiment whose branch must survive its neighbour's settle.
      await stageProposal(fixture, 'e-bystander', 'noop-comment');

      const settled = await settleExperiment({
        host: fixture.host, store, experiment,
        decision: { decision: 'abandoned', reason: 'equal', code: 'TEVO1008' },
        worktreePath: staged.path,
      });
      assert.equal(settled.ok, true, JSON.stringify(settled));
      assert.equal(await branchExists(fixture.repositoryRoot, 'exp/e-named'), false);
      assert.equal(await branchExists(fixture.repositoryRoot, 'exp/e-bystander'), true,
        'settling one experiment never reaches another’s branch');
    });
  });
});

describe('settling an uncertain experiment', () => {
  it('leaves the worktree and the branch exactly as they are', async () => {
    await withEvolveRepository(async (fixture) => {
      const store = createMemoryEvolveStore();
      const experiment = await heldExperiment(store, fixture, 'e-uncertain');
      const staged = await stageProposal(fixture, 'e-uncertain', 'noop-comment');
      const digest = await fixture.host.trackedDigest(staged.path);

      const settled = await settleExperiment({
        host: fixture.host, store, experiment,
        decision: { decision: 'uncertain', reason: 'uncertain-effect', code: 'TEVO1009' },
        worktreePath: staged.path,
      });
      assert.equal(settled.ok, true, JSON.stringify(settled));
      const value = (settled as {
        value: { worktreeRemoved: boolean, branchDeleted: boolean, experiment: { status: string } },
      }).value;
      assert.equal(value.worktreeRemoved, false, 'uncertainty is not a licence to tidy up');
      assert.equal(value.branchDeleted, false);
      assert.equal(value.experiment.status, 'uncertain');
      assert.equal(await branchExists(fixture.repositoryRoot, 'exp/e-uncertain'), true);
      assert.deepEqual(await fixture.host.trackedDigest(staged.path), digest,
        'the workspace is exactly as the operator will find it');
    });
  });
});

describe('settling twice', () => {
  it('refuses the second as a stale transition and removes nothing twice', async () => {
    await withEvolveRepository(async (fixture) => {
      const store = createMemoryEvolveStore();
      const experiment = await heldExperiment(store, fixture, 'e-twice');
      const staged = await stageProposal(fixture, 'e-twice', 'noop-comment');
      const decision = { decision: 'abandoned', reason: 'equal', code: 'TEVO1008' } as const;

      const first = await settleExperiment({ host: fixture.host, store, experiment, decision, worktreePath: staged.path });
      assert.equal(first.ok, true, JSON.stringify(first));

      // The same stale handle again: the swap is lost before any removal.
      const second = await settleExperiment({ host: fixture.host, store, experiment, decision, worktreePath: staged.path });
      assert.equal(second.ok, false, 'a settled experiment does not settle again');
      const issue = (second as { issues: Array<{ code: string, path: string }> }).issues[0];
      assert.equal(issue.code, 'TEVO1010');
      assert.equal(issue.path, '/revision', 'and it is the fence that refuses, not the filesystem');
    });
  });

  it('refuses a settle from a terminal status before touching anything', async () => {
    await withEvolveRepository(async (fixture) => {
      const store = createMemoryEvolveStore();
      const experiment = await heldExperiment(store, fixture, 'e-terminal');
      const staged = await stageProposal(fixture, 'e-terminal', 'noop-comment');

      const terminal = { ...experiment, status: 'abandoned' as const };
      const settled = await settleExperiment({
        host: fixture.host, store, experiment: terminal,
        decision: { decision: 'abandoned', reason: 'equal', code: 'TEVO1008' },
        worktreePath: staged.path,
      });
      assert.equal(settled.ok, false);
      assert.equal((settled as { issues: Array<{ code: string, path: string }> }).issues[0].path, '/status');
      assert.equal(await branchExists(fixture.repositoryRoot, 'exp/e-terminal'), true,
        'nothing was removed on the way to refusing');
    });
  });
});

describe('what settling never reaches', () => {
  it('leaves the operator repository byte-identical across every disposition', async () => {
    await withEvolveRepository(async (fixture) => {
      const store = createMemoryEvolveStore();
      const before = await operatorDigest(fixture.repositoryRoot, fixture.repository.protectedRefs);

      for (const [id, decision, reason] of [
        ['e-a', 'abandoned', 'equal'],
        ['e-r', 'refused', 'goalpost'],
      ] as const) {
        const experiment = await heldExperiment(store, fixture, id);
        const staged = await stageProposal(fixture, id, 'noop-comment');
        const settled = await settleExperiment({
          host: fixture.host, store, experiment,
          decision: { decision, reason, code: 'TEVO1008' },
          worktreePath: staged.path,
        });
        assert.equal(settled.ok, true, JSON.stringify(settled));
      }

      const after = await operatorDigest(fixture.repositoryRoot, fixture.repository.protectedRefs);
      assert.equal(after, before,
        'every tracked byte, HEAD and every protected ref are where they were');
    });
  });
});
