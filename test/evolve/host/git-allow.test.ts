/**
 * The git vocabulary, probed for what it cannot say.
 *
 * The absent-verb table is the heart of this file. Each entry is a real
 * command someone could reach for, and every one refuses — not because a
 * rule forbids it, but because no validator recognises it. If a later
 * edit adds a verb, the corresponding line here starts passing for the
 * wrong reason, which is why the refusals are asserted by code rather
 * than by "it threw something".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateGitArgs, neverWriteSet, refuseProtectedRef, isExperimentBranch, isPinnedRevision } from '@tangleai/evolve/host';

const SHA = 'a'.repeat(40);
const refused = (argv: string[]) => {
  const result = validateGitArgs(argv);
  assert.equal(result.ok, false, 'git ' + argv.join(' ') + ' should not be sayable');
  return (result as { issues: Array<{ code: string, path: string }> }).issues[0];
};
const accepted = (argv: string[]) => {
  const result = validateGitArgs(argv);
  assert.equal(result.ok, true, 'git ' + argv.join(' ') + ' should be accepted: ' + JSON.stringify(result));
};

describe('the git vocabulary', () => {
  it('accepts exactly the read and experiment-branch forms it declares', () => {
    accepted(['rev-parse', 'HEAD']);
    accepted(['status', '--porcelain']);
    accepted(['status', '--porcelain=v2']);
    accepted(['symbolic-ref', 'HEAD']);
    accepted(['symbolic-ref', '--short', 'HEAD']);
    accepted(['show-ref', '--verify', 'refs/heads/main']);
    accepted(['worktree', 'list', '--porcelain']);
    accepted(['worktree', 'prune']);
    accepted(['worktree', 'add', '-b', 'exp/e1', '/tmp/wt', SHA]);
    accepted(['worktree', 'remove', '--force', '/tmp/wt']);
    accepted(['branch', '-D', 'exp/e1']);
    accepted(['add', '-A']);
    accepted(['diff', '--cached', '--name-status', '-M', '-z']);
    accepted(['diff', '--cached', '--binary']);
    accepted(['ls-files', '-s', '-z']);
    accepted(['commit', '-m', 'experiment']);
  });

  it('cannot say any verb that writes somewhere a person did not', () => {
    for (const argv of [
      ['push', 'origin', 'main'],
      ['push', '--force', 'origin', 'exp/e1'],
      ['merge', 'exp/e1'],
      ['switch', 'main'],
      ['checkout', 'main'],
      ['checkout', '-b', 'exp/e1'],
      ['reset', '--hard', SHA],
      ['rebase', 'main'],
      ['remote', 'add', 'evil', 'https://example.invalid/x.git'],
      ['config', '--global', 'user.email', 'x@y.z'],
      ['fetch', 'origin'],
      ['clone', 'https://example.invalid/x.git'],
      ['tag', 'v9.9.9'],
      ['cherry-pick', SHA],
      ['stash'],
      ['clean', '-fdx'],
      ['update-ref', 'refs/heads/main', SHA],
      ['symbolic-ref', 'HEAD', 'refs/heads/main'],
    ]) {
      assert.equal(refused(argv).code, 'TEVO1006');
    }
  });

  it('cannot say a global option that would run something else, or somewhere else', () => {
    for (const argv of [
      ['-c', 'core.hooksPath=/tmp/evil', 'status', '--porcelain'],
      ['-C', '/etc', 'status', '--porcelain'],
      ['--exec-path=/tmp/evil', 'status', '--porcelain'],
      ['--git-dir=/tmp/other/.git', 'status', '--porcelain'],
      ['--work-tree=/', 'add', '-A'],
      ['status', '--porcelain', '-c', 'core.pager=sh'],
    ]) {
      assert.equal(refused(argv).code, 'TEVO1006', argv.join(' '));
    }
  });

  it('accepts no ref but an experiment branch or a pinned commit', () => {
    for (const ref of ['main', 'master', 'refs/heads/main', 'HEAD', 'HEAD~1', '@{-1}',
      'origin/main', 'exp/../main', 'exp/E1', 'exp/', 'EXP/e1', SHA.slice(0, 7)]) {
      assert.equal(isExperimentBranch(ref), false, ref + ' must not read as an experiment branch');
      assert.equal(refused(['branch', '-D', ref]).code, 'TEVO1006');
      assert.equal(refused(['worktree', 'add', '-b', ref, '/tmp/wt', SHA]).code, 'TEVO1006');
    }
    assert.equal(isExperimentBranch('exp/e1'), true);
    assert.equal(isExperimentBranch('exp/a-long-one-9'), true);
  });

  it('starts a worktree only at a full commit object name', () => {
    assert.equal(isPinnedRevision(SHA), true);
    for (const rev of ['HEAD', 'main', SHA.slice(0, 7), SHA + 'a', 'A'.repeat(40)]) {
      assert.equal(isPinnedRevision(rev), false);
      assert.equal(refused(['worktree', 'add', '-b', 'exp/e1', '/tmp/wt', rev]).code, 'TEVO1006');
    }
  });

  it('refuses a recognised verb carrying one extra argument', () => {
    assert.equal(refused(['add', '-A', '.']).code, 'TEVO1006');
    assert.equal(refused(['status', '--porcelain', '--ignored']).code, 'TEVO1006');
    assert.equal(refused(['commit', '-m', 'one', '--amend']).code, 'TEVO1006');
    assert.equal(refused(['commit', '-m', '']).code, 'TEVO1006');
    assert.equal(refused([]).code, 'TEVO1006');
  });

  it('names a protected ref the same whichever way it is spelled', () => {
    const never = neverWriteSet({
      protectedRefs: ['main', 'master'],
      operatorBranch: 'refs/heads/feature',
      checkedOut: ['release'],
    });
    for (const ref of ['main', 'refs/heads/main', 'master', 'refs/heads/master',
      'feature', 'refs/heads/feature', 'release', 'refs/heads/release']) {
      assert.equal(never.has(ref), true, ref + ' must be in the never-write set');
      const result = refuseProtectedRef(['branch', '-D', ref], never);
      assert.equal(result.ok, false);
      assert.equal((result as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1003');
    }
    assert.equal(refuseProtectedRef(['branch', '-D', 'exp/e1'], never).ok, true);
  });
});
