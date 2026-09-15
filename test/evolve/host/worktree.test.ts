/**
 * The worktree lifecycle against a real git repository.
 *
 * The suite is wrapped by a digest of the operator's repository, taken
 * before the first test and compared after the last. Every individual
 * assertion below could pass while something still leaked — a stray
 * commit on `main`, a moved HEAD, an edited file — and that final
 * comparison is what rules it out.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm, mkdir, writeFile, symlink, readFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import { createWorktreeHost, type WorktreeHost } from '@tangleai/evolve/host';
import { materializeEvolveFixture, operatorDigest, rawGit, type EvolveFixture } from './fixture.ts';

describe('the worktree host', () => {
  let fixture: EvolveFixture;
  let host: WorktreeHost;
  let before_: string;

  before(async () => {
    fixture = await materializeEvolveFixture();
    before_ = await operatorDigest(fixture.repositoryRoot, fixture.repository.protectedRefs);
    host = createWorktreeHost({
      runner: fixture.runner,
      repositoryRoot: fixture.repositoryRoot,
      worktreeRoot: fixture.worktreeRoot,
      repository: fixture.repository,
    });
  });

  after(async () => {
    const after_ = await operatorDigest(fixture.repositoryRoot, fixture.repository.protectedRefs);
    assert.equal(after_, before_, 'the operator repository must be byte-identical afterwards');
    await rm(dirname(fixture.repositoryRoot), { recursive: true, force: true });
  });

  it('inspects a clean base and records what is checked out', async () => {
    const inspected = await host.inspect();
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    const base = (inspected as { value: { revision: string, operatorBranch: string, clean: boolean, checkedOut: string[], id: string } }).value;
    assert.equal(base.revision, fixture.baseRevision);
    assert.equal(base.operatorBranch, 'main');
    assert.equal(base.clean, true);
    assert.deepEqual(base.checkedOut, ['main']);
    assert.match(base.id, /^[a-f0-9]{64}$/, 'a base is a sealed record like any other');
  });

  it('refuses a dirty operator tree, because a base nobody is editing is the point', async () => {
    await writeFile(join(fixture.repositoryRoot, 'scratch.txt'), 'uncommitted\n');
    try {
      const inspected = await host.inspect();
      assert.equal(inspected.ok, false);
      const issue = (inspected as { issues: Array<{ code: string, path: string }> }).issues[0];
      assert.equal(issue.code, 'TEVO1003');
      assert.equal(issue.path, '/clean');
    }
    finally {
      await rm(join(fixture.repositoryRoot, 'scratch.txt'), { force: true });
    }
  });

  it('refuses a worktree root inside the repository', async () => {
    const inside = createWorktreeHost({
      runner: fixture.runner,
      repositoryRoot: fixture.repositoryRoot,
      worktreeRoot: join(fixture.repositoryRoot, 'experiments'),
      repository: fixture.repository,
    });
    const inspected = await inside.inspect();
    assert.equal(inspected.ok, false);
    assert.equal((inspected as { issues: Array<{ path: string }> }).issues[0].path, '/worktreeRoot');
  });

  it('runs the whole lifecycle: create, write, status, commit, diff, remove', async () => {
    const created = await host.create({ experimentId: 'e1', baseRevision: fixture.baseRevision });
    assert.equal(created.ok, true, JSON.stringify(created));
    const { path, branch } = (created as { value: { path: string, branch: string } }).value;
    assert.equal(branch, 'exp/e1');

    // A second create for the same id refuses rather than reusing a branch
    // whose contents nobody has accounted for.
    const twice = await host.create({ experimentId: 'e1', baseRevision: fixture.baseRevision });
    assert.equal(twice.ok, false);
    assert.equal((twice as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1003');

    const mapped = await host.fileMap(path);
    assert.equal(mapped.ok, true);
    const files = (mapped as { value: { files: Record<string, string> } }).value.files;
    assert.ok(Object.hasOwn(files, 'src/rank.js'));
    assert.ok(Object.hasOwn(files, 'README.md'));

    const written = await host.writeFiles(path, {
      'src/rank.js': files['src/rank.js'].replace('b.score - a.score', 'b.score - a.score || 0'),
      'src/added.js': 'export const added = 1;\n',
      'README.md': null,
    });
    assert.equal(written.ok, true, JSON.stringify(written));
    assert.deepEqual((written as { value: { written: string[] } }).value.written,
      ['README.md', 'src/added.js', 'src/rank.js']);

    const status = await host.status(path);
    assert.equal(status.ok, true);
    const changed = (status as { value: { changed: Array<{ path: string, status: string }>, bytes: number } }).value;
    const byPath = new Map(changed.changed.map(row => [row.path, row.status]));
    assert.equal(byPath.get('src/rank.js'), 'M');
    assert.equal(byPath.get('src/added.js'), 'A');
    assert.equal(byPath.get('README.md'), 'D');
    assert.ok(changed.bytes > 0, 'the workspace has a measured size');

    const diffed = await host.diff(path);
    assert.equal(diffed.ok, true);
    const diff = (diffed as { value: { digest: string, bytes: number, text: string } }).value;
    assert.match(diff.digest, /^[a-f0-9]{64}$/);
    assert.ok(diff.bytes > 0);
    assert.match(diff.text, /src\/added\.js/);

    const committed = await host.commit(path, { experimentId: 'e1', message: 'experiment change' });
    assert.equal(committed.ok, true, JSON.stringify(committed));
    assert.match((committed as { value: { revision: string } }).value.revision, /^[a-f0-9]{40}$/);

    const removed = await host.remove(path, { deleteBranch: true, experimentId: 'e1' });
    assert.equal(removed.ok, true, JSON.stringify(removed));

    const branches = await rawGit(fixture.repositoryRoot, 'branch', '--list');
    assert.equal(branches.stdout.includes('exp/e1'), false, 'the branch is gone after a deleting removal');
    // Match the worktree's own path, not a substring: the fixture lives in a
    // randomly named temporary directory that can contain anything.
    const listed = await rawGit(fixture.repositoryRoot, 'worktree', 'list', '--porcelain');
    const paths = listed.stdout.split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length));
    assert.equal(paths.includes(path), false, 'prune left no stale entry');
    assert.equal(listed.stdout.includes('exp/e1'), false, 'and no stale branch line');
    await stat(path).then(() => assert.fail('the worktree directory should be gone'), () => undefined);
  });

  it('keeps the branch when a removal does not ask for it', async () => {
    const created = await host.create({ experimentId: 'e2', baseRevision: fixture.baseRevision });
    assert.equal(created.ok, true);
    const { path } = (created as { value: { path: string } }).value;

    assert.equal((await host.remove(path, { deleteBranch: false, experimentId: 'e1' })).ok, true);
    const branches = await rawGit(fixture.repositoryRoot, 'branch', '--list');
    assert.equal(branches.stdout.includes('exp/e2'), true, 'kept, so a review can still reach it');
    await rawGit(fixture.repositoryRoot, 'branch', '-D', 'exp/e2');
  });

  it('reports a symlink among the changed paths rather than following it', async () => {
    const created = await host.create({ experimentId: 'e3', baseRevision: fixture.baseRevision });
    assert.equal(created.ok, true);
    const { path } = (created as { value: { path: string } }).value;
    try {
      await symlink('/etc/passwd', join(path, 'sneaky.txt'));
      const status = await host.status(path);
      assert.equal(status.ok, true);
      const value = (status as { value: { symlinks: string[] } }).value;
      assert.deepEqual(value.symlinks, ['sneaky.txt'], 'reported, and the policy above decides');

      // A symlink carries no text to patch, so it is absent from the map.
      const mapped = await host.fileMap(path);
      assert.equal(mapped.ok, true);
      assert.equal(Object.hasOwn((mapped as { value: { files: Record<string, string> } }).value.files, 'sneaky.txt'), false);
    }
    finally {
      await host.remove(path, { deleteBranch: true, experimentId: 'e1' });
    }
  });

  it('refuses a write that traverses out of the worktree', async () => {
    const created = await host.create({ experimentId: 'e4', baseRevision: fixture.baseRevision });
    assert.equal(created.ok, true);
    const { path } = (created as { value: { path: string } }).value;
    try {
      for (const name of ['../escaped.txt', '../../escaped.txt', 'src/../../escaped.txt']) {
        const refused = await host.writeFiles(path, { [name]: 'nope' });
        assert.equal(refused.ok, false, name + ' must be refused');
        assert.equal((refused as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1004');
      }

      // A symlinked directory is the harder case: the path looks contained.
      await mkdir(join(path, 'linked-parent'), { recursive: true });
      await rm(join(path, 'linked-parent'), { recursive: true, force: true });
      await symlink(dirname(fixture.repositoryRoot), join(path, 'linked-parent'), 'dir');
      const throughLink = await host.writeFiles(path, { 'linked-parent/escaped.txt': 'nope' });
      assert.equal(throughLink.ok, false, 'a symlinked parent must not carry the write out');
      assert.equal((throughLink as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1004');
    }
    finally {
      await host.remove(path, { deleteBranch: true, experimentId: 'e1' });
    }
  });

  it('refuses to commit when HEAD is not the experiment branch', async () => {
    const created = await host.create({ experimentId: 'e5', baseRevision: fixture.baseRevision });
    assert.equal(created.ok, true);
    const { path } = (created as { value: { path: string } }).value;
    try {
      // HEAD is read at commit time, not trusted from create.
      const refused = await host.commit(path, { experimentId: 'e6', message: 'wrong branch' });
      assert.equal(refused.ok, false);
      const issue = (refused as { issues: Array<{ code: string, path: string }> }).issues[0];
      assert.equal(issue.code, 'TEVO1003');
      assert.equal(issue.path, '/branch');
    }
    finally {
      await host.remove(path, { deleteBranch: true, experimentId: 'e1' });
    }
  });

  it('refuses a binary file rather than pretending it has text', async () => {
    const created = await host.create({ experimentId: 'e7', baseRevision: fixture.baseRevision });
    assert.equal(created.ok, true);
    const { path } = (created as { value: { path: string } }).value;
    try {
      await writeFile(join(path, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00]));
      await rawGit(path, 'add', '-A');
      const mapped = await host.fileMap(path);
      assert.equal(mapped.ok, false);
      assert.equal((mapped as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1001');
    }
    finally {
      await host.remove(path, { deleteBranch: true, experimentId: 'e1' });
    }
  });

  it('leaves the operator file bytes untouched while an experiment edits its own copy', async () => {
    const original = await readFile(join(fixture.repositoryRoot, 'src', 'rank.js'), 'utf8');
    const created = await host.create({ experimentId: 'e8', baseRevision: fixture.baseRevision });
    assert.equal(created.ok, true);
    const { path } = (created as { value: { path: string } }).value;
    try {
      await host.writeFiles(path, { 'src/rank.js': '// rewritten by an experiment\n' });
      await host.commit(path, { experimentId: 'e8', message: 'rewrite' });
      assert.equal(await readFile(join(fixture.repositoryRoot, 'src', 'rank.js'), 'utf8'), original);
    }
    finally {
      await host.remove(path, { deleteBranch: true, experimentId: 'e1' });
    }
  });
});
