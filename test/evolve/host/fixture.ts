/**
 * A real git repository to run the host against, and the probe that
 * proves the host never touched it.
 *
 * `operatorDigest` hashes what the operator would care about losing: the
 * staged inventory, the bytes of every tracked file, the branch HEAD
 * points at, and the object every protected ref resolves to. Taking it
 * before and after a suite and comparing is a stronger statement than any
 * individual assertion about what the host did — it says nothing got out,
 * including whatever nobody thought to check.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { createProcessRunner, validateGitArgs, type ProcessRunner } from '@tangleai/evolve/host';
import { DEFAULT_EVOLVE_BUDGETS } from '@tangleai/evolve';
import type { EvolveRepository } from '@tangleai/evolve/contracts';

const exec = promisify(execFile);

/** Raw git, for setting the fixture up — outside the host's vocabulary on purpose. */
export const rawGit = (cwd: string, ...args: string[]) =>
  exec('git', args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } });

export interface EvolveFixture {
  repositoryRoot: string;
  worktreeRoot: string;
  baseRevision: string;
  runner: ProcessRunner;
  repository: EvolveRepository;
}

export const FIXTURE_REPOSITORY = (repositoryId: string): Omit<EvolveRepository, 'id'> => ({
  schemaVersion: 1,
  kind: 'repository',
  repositoryId,
  vcs: 'git',
  protectedRefs: ['main', 'master'],
  policy: {
    immutablePaths: ['test'],
    generated: ['src/generated'],
    gate: { command: 'npm', args: ['run', 'check'] },
    instrument: { command: 'node', args: ['bench.mjs'], metric: { name: 'score', direction: 'higher', schema: { type: 'object' } } },
    thresholdsPath: 'bench/truth.json',
  },
  allow: { commands: ['git'] },
  budgets: DEFAULT_EVOLVE_BUDGETS,
});

/** A repository with one commit on `main`, plus a worktree root beside it. */
export async function materializeEvolveFixture(): Promise<EvolveFixture> {
  const base = await mkdtemp(join(tmpdir(), 'tangle-evolve-fx-'));
  const repositoryRoot = join(base, 'repo');
  const worktreeRoot = join(base, 'worktrees');
  await mkdir(repositoryRoot, { recursive: true });
  await mkdir(worktreeRoot, { recursive: true });

  await rawGit(repositoryRoot, 'init', '--quiet', '--initial-branch', 'main');
  await rawGit(repositoryRoot, 'config', 'user.name', 'Fixture');
  await rawGit(repositoryRoot, 'config', 'user.email', 'fixture@example.invalid');
  await rawGit(repositoryRoot, 'config', 'commit.gpgsign', 'false');

  await mkdir(join(repositoryRoot, 'src'), { recursive: true });
  await writeFile(join(repositoryRoot, 'src', 'rank.js'),
    'export function rank(rows) { return rows.slice().sort((a, b) => b.score - a.score); }\n');
  await writeFile(join(repositoryRoot, 'README.md'), 'fixture repository\n');
  await rawGit(repositoryRoot, 'add', '-A');
  await rawGit(repositoryRoot, 'commit', '--quiet', '-m', 'initial');
  const { stdout } = await rawGit(repositoryRoot, 'rev-parse', 'HEAD');
  const baseRevision = stdout.trim();

  const runner = createProcessRunner({
    allow: { git: { file: 'git', args: validateGitArgs, cwd: 'worktree' } },
    env: {
      allow: ['PATH', 'HOME'],
      set: {
        GIT_AUTHOR_NAME: 'Evolve', GIT_AUTHOR_EMAIL: 'evolve@example.invalid',
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_NAME: 'Evolve', GIT_COMMITTER_EMAIL: 'evolve@example.invalid',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
        GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', CI: '1',
      },
    },
    limits: { legMs: 30000, stdoutBytes: 4 * 1024 * 1024, stderrBytes: 256 * 1024 },
    // Both roots are the base directory, so the runner accepts the
    // repository and every worktree beneath it without widening further.
    roots: { worktree: base, repository: base, base },
  });

  return {
    repositoryRoot,
    worktreeRoot,
    baseRevision,
    runner,
    repository: { ...FIXTURE_REPOSITORY('fixture'), id: 'f'.repeat(64) } as EvolveRepository,
  };
}

/**
 * Everything about the operator's repository that must not change: the
 * staged inventory, every tracked file's bytes, HEAD's branch, and what
 * each protected ref points at.
 */
export async function operatorDigest(repositoryRoot: string, protectedRefs: readonly string[]): Promise<string> {
  const hash = createHash('sha256');

  const { stdout: inventory } = await rawGit(repositoryRoot, 'ls-files', '-s', '-z');
  hash.update('inventory\0' + inventory);

  const { stdout: names } = await rawGit(repositoryRoot, 'ls-files', '-z');
  for (const name of names.split('\0').filter(Boolean).sort()) {
    const bytes = await readFile(join(repositoryRoot, name)).catch(() => Buffer.alloc(0));
    hash.update('file\0' + name + '\0');
    hash.update(bytes);
  }

  const { stdout: head } = await rawGit(repositoryRoot, 'symbolic-ref', 'HEAD');
  hash.update('head\0' + head.trim());

  for (const ref of [...protectedRefs].sort()) {
    const resolved = await rawGit(repositoryRoot, 'show-ref', '--verify', 'refs/heads/' + ref)
      .then(result => result.stdout.trim())
      .catch(() => 'absent');
    hash.update('ref\0' + ref + '\0' + resolved);
  }

  return hash.digest('hex');
}
