/**
 * The worktree lifecycle: create, read, write, commit, diff, remove.
 *
 * Every git call goes through the runner and the vocabulary, so this
 * module cannot reach a verb the allow-list does not contain. What it adds
 * on top is the ownership discipline the vocabulary alone cannot express:
 *
 *  - the worktree root must resolve OUTSIDE the repository, so an
 *    experiment's files can never be mistaken for the operator's;
 *  - a commit is refused unless HEAD really is the experiment's own
 *    branch, checked at the moment of committing rather than assumed from
 *    how the worktree was made;
 *  - a write is realpath-checked per file, so a path that traverses out of
 *    the worktree — by `..`, by symlink, or by both — is refused rather
 *    than resolved;
 *  - a removal that fails is `TEVO1009`, not a shrug: an experiment whose
 *    workspace may still exist is uncertain, and uncertainty stops for a
 *    person.
 */

import { mkdir, readFile, writeFile, realpath, lstat, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep, relative } from 'node:path';

import { refuseOne, ok, type EvolveOutcome } from '../errors.ts';
import type { EvolveBase, EvolveRepository } from '../contracts.gen.ts';
import { sealRecord, evolveRevision } from '../identity.ts';
import { neverWriteSet, isExperimentBranch } from './git-allow.ts';
import type { ProcessRunner, RunResult } from './runner.ts';

export interface WorktreeHostOptions {
  runner: ProcessRunner;
  repositoryRoot: string;
  worktreeRoot: string;
  repository: EvolveRepository;
}

export interface ChangedPath {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  renamedFrom?: string;
}

export interface WorktreeStatus {
  changed: ChangedPath[];
  symlinks: string[];
  bytes: number;
}

export interface WorktreeHost {
  inspect(): Promise<EvolveOutcome<EvolveBase>>;
  create(options: { experimentId: string, baseRevision: string }): Promise<EvolveOutcome<{ path: string, branch: string }>>;
  status(path: string): Promise<EvolveOutcome<WorktreeStatus>>;
  fileMap(path: string): Promise<EvolveOutcome<{ files: Record<string, string> }>>;
  writeFiles(path: string, plan: Record<string, string | null>): Promise<EvolveOutcome<{ written: string[] }>>;
  commit(path: string, options: { experimentId: string, message: string }): Promise<EvolveOutcome<{ revision: string }>>;
  diff(path: string): Promise<EvolveOutcome<{ digest: string, bytes: number, text: string }>>;
  workspaceBytes(path: string): Promise<number>;
  remove(path: string, options: { deleteBranch: boolean }): Promise<EvolveOutcome<true>>;
}

const branchFor = (experimentId: string): string => 'exp/' + experimentId;

function contains(root: string, child: string): boolean {
  if (root === child) return true;
  return child.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** A git run that must have succeeded to mean anything. */
function green(result: EvolveOutcome<RunResult>, what: string): EvolveOutcome<RunResult> {
  if (!result.ok) return result;
  if (result.value.exitCode !== 0) {
    return refuseOne<RunResult>('TEVO1003', '/git',
      what + ' failed with exit ' + String(result.value.exitCode) + ': ' + result.value.stderr.slice(0, 400));
  }
  return result;
}

export function createWorktreeHost(options: WorktreeHostOptions): WorktreeHost {
  const { runner, repositoryRoot, worktreeRoot, repository } = options;

  const git = (args: string[], cwd: string) => runner.run({ name: 'git', args, cwd });

  async function currentBranch(cwd: string): Promise<EvolveOutcome<string>> {
    const result = green(await git(['symbolic-ref', '--short', 'HEAD'], cwd), 'symbolic-ref');
    if (!result.ok) return result as EvolveOutcome<string>;
    return ok(result.value.stdout.trim());
  }

  return {
    async inspect(): Promise<EvolveOutcome<EvolveBase>> {
      // The experiment's workspace must not live inside the operator's
      // repository. Checked first, because everything after it assumes so.
      let resolvedRepo: string;
      try {
        resolvedRepo = await realpath(resolve(repositoryRoot));
      }
      catch {
        return refuseOne<EvolveBase>('TEVO1003', '/repositoryRoot', 'The repository root does not resolve.');
      }
      const resolvedWorktreeRoot = await realpath(resolve(worktreeRoot)).catch(() => resolve(worktreeRoot));
      if (contains(resolvedRepo, resolvedWorktreeRoot)) {
        return refuseOne<EvolveBase>('TEVO1003', '/worktreeRoot',
          'The worktree root is inside the repository; an experiment must not write there.');
      }

      const status = green(await git(['status', '--porcelain'], resolvedRepo), 'status');
      if (!status.ok) return status as EvolveOutcome<EvolveBase>;
      if (status.value.stdout.trim().length > 0) {
        return refuseOne<EvolveBase>('TEVO1003', '/clean',
          'The operator tree is dirty; an experiment needs a base nobody is editing.');
      }

      const head = green(await git(['rev-parse', 'HEAD'], resolvedRepo), 'rev-parse');
      if (!head.ok) return head as EvolveOutcome<EvolveBase>;
      const revision = head.value.stdout.trim();

      const branch = await currentBranch(resolvedRepo);
      if (!branch.ok) return branch as EvolveOutcome<EvolveBase>;

      const listed = green(await git(['worktree', 'list', '--porcelain'], resolvedRepo), 'worktree list');
      if (!listed.ok) return listed as EvolveOutcome<EvolveBase>;
      const checkedOut = listed.value.stdout.split('\n')
        .filter(line => line.startsWith('branch '))
        .map(line => line.slice('branch '.length).trim())
        .map(ref => (ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref))
        .filter(ref => ref.length > 0);

      return sealRecord<EvolveBase>({
        schemaVersion: 1,
        kind: 'base',
        repositoryId: repository.repositoryId,
        revision,
        clean: true,
        operatorBranch: branch.value,
        checkedOut: [...new Set(checkedOut)].sort(),
      });
    },

    async create({ experimentId, baseRevision }): Promise<EvolveOutcome<{ path: string, branch: string }>> {
      const branch = branchFor(experimentId);
      if (!isExperimentBranch(branch)) {
        return refuseOne('TEVO1003', '/experimentId', 'An experiment id must form a valid experiment branch.');
      }
      const resolvedRepo = await realpath(resolve(repositoryRoot));
      const path = join(resolve(worktreeRoot), experimentId);
      if (contains(resolvedRepo, resolve(path))) {
        return refuseOne('TEVO1003', '/worktreeRoot', 'An experiment worktree may not live inside the repository.');
      }

      // An existing branch is refused rather than reused: reusing one would
      // silently inherit whatever a previous run left on it.
      const existing = await git(['show-ref', '--verify', 'refs/heads/' + branch], resolvedRepo);
      if (existing.ok && existing.value.exitCode === 0) {
        return refuseOne('TEVO1003', '/branch', 'The branch ' + branch + ' already exists.');
      }

      await mkdir(resolve(worktreeRoot), { recursive: true });
      const added = green(await git(['worktree', 'add', '-b', branch, path, baseRevision], resolvedRepo), 'worktree add');
      if (!added.ok) return added as EvolveOutcome<{ path: string, branch: string }>;
      return ok({ path, branch });
    },

    async status(path: string): Promise<EvolveOutcome<WorktreeStatus>> {
      const staged = green(await git(['add', '-A'], path), 'add');
      if (!staged.ok) return staged as EvolveOutcome<WorktreeStatus>;
      const listed = green(await git(['diff', '--cached', '--name-status', '-M', '-z'], path), 'diff --name-status');
      if (!listed.ok) return listed as EvolveOutcome<WorktreeStatus>;

      const fields = listed.value.stdout.split('\0').filter(part => part.length > 0);
      const changed: ChangedPath[] = [];
      for (let index = 0; index < fields.length;) {
        const code = fields[index++];
        const letter = code[0] as ChangedPath['status'];
        if (letter === 'R') {
          const from = fields[index++];
          const to = fields[index++];
          changed.push({ path: to, status: 'R', renamedFrom: from });
        }
        else {
          changed.push({ path: fields[index++], status: letter });
        }
      }

      // A symlink among the changed paths is REPORTED, never followed:
      // the surface policy decides what it means, not this module.
      const symlinks: string[] = [];
      for (const entry of changed) {
        if (entry.status === 'D') continue;
        const info = await lstat(join(path, entry.path)).catch(() => null);
        if (info?.isSymbolicLink()) symlinks.push(entry.path);
      }

      return ok({ changed, symlinks, bytes: await this.workspaceBytes(path) });
    },

    async fileMap(path: string): Promise<EvolveOutcome<{ files: Record<string, string> }>> {
      const listed = green(await git(['ls-files', '-s', '-z'], path), 'ls-files');
      if (!listed.ok) return listed as EvolveOutcome<{ files: Record<string, string> }>;
      const files: Record<string, string> = {};
      for (const entry of listed.value.stdout.split('\0')) {
        if (entry.length === 0) continue;
        const tab = entry.indexOf('\t');
        if (tab < 0) continue;
        const mode = entry.slice(0, 6);
        const name = entry.slice(tab + 1);
        // Symlinks (120000) and gitlinks (160000) carry no text to patch.
        if (mode !== '100644' && mode !== '100755') continue;
        const bytes = await readFile(join(path, name)).catch(() => null);
        if (bytes === null) continue;
        if (bytes.includes(0)) {
          return refuseOne('TEVO1001', '/files/' + name, 'A binary file has no text to patch.');
        }
        files[name] = bytes.toString('utf8');
      }
      return ok({ files });
    },

    async writeFiles(path: string, plan: Record<string, string | null>): Promise<EvolveOutcome<{ written: string[] }>> {
      const root = await realpath(resolve(path));
      const written: string[] = [];
      for (const [name, content] of Object.entries(plan)) {
        const target = resolve(root, name);
        // Check the containment of the path itself, and — when the parent
        // already exists — of its resolved parent, so a symlinked directory
        // cannot carry the write out of the worktree.
        if (!contains(root, target)) {
          return refuseOne('TEVO1004', '/files/' + name, 'A write must stay inside the worktree.');
        }
        const parent = dirname(target);
        const resolvedParent = await realpath(parent).catch(() => null);
        if (resolvedParent !== null && !contains(root, resolvedParent)) {
          return refuseOne('TEVO1004', '/files/' + name, 'The containing directory leaves the worktree.');
        }
        const held = await lstat(target).catch(() => null);
        if (held?.isSymbolicLink()) {
          return refuseOne('TEVO1004', '/files/' + name, 'A tracked symlink is never a write target.');
        }
        if (content === null) {
          await rm(target, { force: true });
        }
        else {
          await mkdir(parent, { recursive: true });
          await writeFile(target, content, 'utf8');
        }
        written.push(name);
      }
      return ok({ written: written.sort() });
    },

    async commit(path: string, { experimentId, message }): Promise<EvolveOutcome<{ revision: string }>> {
      const branch = branchFor(experimentId);
      const never = neverWriteSet({
        protectedRefs: repository.protectedRefs,
        operatorBranch: '',
        checkedOut: [],
      });
      if (never.has(branch)) {
        return refuseOne('TEVO1003', '/branch', 'A protected ref is never a commit target.');
      }

      // HEAD is read here rather than trusted from `create`: between the
      // two, something else may have moved it.
      const head = await currentBranch(path);
      if (!head.ok) return head as EvolveOutcome<{ revision: string }>;
      if (head.value !== branch) {
        return refuseOne('TEVO1003', '/branch',
          'This worktree is on ' + head.value + ', not ' + branch + '; refusing to commit.');
      }

      const staged = green(await git(['add', '-A'], path), 'add');
      if (!staged.ok) return staged as EvolveOutcome<{ revision: string }>;
      const committed = green(await git(['commit', '-m', message], path), 'commit');
      if (!committed.ok) return committed as EvolveOutcome<{ revision: string }>;
      const revision = green(await git(['rev-parse', 'HEAD'], path), 'rev-parse');
      if (!revision.ok) return revision as EvolveOutcome<{ revision: string }>;
      return ok({ revision: revision.value.stdout.trim() });
    },

    async diff(path: string): Promise<EvolveOutcome<{ digest: string, bytes: number, text: string }>> {
      const staged = green(await git(['add', '-A'], path), 'add');
      if (!staged.ok) return staged as EvolveOutcome<{ digest: string, bytes: number, text: string }>;
      const result = green(await git(['diff', '--cached', '--binary'], path), 'diff');
      if (!result.ok) return result as EvolveOutcome<{ digest: string, bytes: number, text: string }>;
      const text = result.value.stdout;
      return ok({ digest: await evolveRevision({ diff: text }), bytes: Buffer.byteLength(text, 'utf8'), text });
    },

    async workspaceBytes(path: string): Promise<number> {
      let total = 0;
      const walk = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (entry.name === '.git') continue;
          const full = join(dir, entry.name);
          // A symlink is counted as itself and never followed, so a link
          // into a large tree cannot inflate — or hang — this walk.
          if (entry.isSymbolicLink()) { total += 1; continue; }
          if (entry.isDirectory()) { await walk(full); continue; }
          const info = await lstat(full).catch(() => null);
          if (info) total += info.size;
        }
      };
      await walk(resolve(path));
      return total;
    },

    async remove(path: string, { deleteBranch }): Promise<EvolveOutcome<true>> {
      const resolvedRepo = await realpath(resolve(repositoryRoot));
      const removed = await git(['worktree', 'remove', '--force', path], resolvedRepo);
      if (!removed.ok || removed.value.exitCode !== 0) {
        // A workspace that may still exist is uncertain, not failed: the
        // difference is whether a person needs to look.
        return refuseOne<true>('TEVO1009', '/worktree',
          'Removing the worktree did not succeed; the workspace may still exist.');
      }
      const pruned = await git(['worktree', 'prune'], resolvedRepo);
      if (!pruned.ok || pruned.value.exitCode !== 0) {
        return refuseOne<true>('TEVO1009', '/worktree', 'Pruning worktree metadata did not succeed.');
      }
      if (deleteBranch) {
        const branch = relative(resolve(worktreeRoot), resolve(path));
        const deleted = await git(['branch', '-D', branchFor(branch)], resolvedRepo);
        if (!deleted.ok || deleted.value.exitCode !== 0) {
          return refuseOne<true>('TEVO1009', '/branch', 'Deleting the experiment branch did not succeed.');
        }
      }
      return ok(true as const);
    },
  };
}
