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
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { createExternalEffects } from '@jarenjs/flow';
import { openTangleDb, createEvolveEffectStore } from '@tangleai/store';
import {
  createProcessRunner, validateGitArgs, createWorktreeHost, createEffectExecutor,
  createEffectDriver, createEvolveClassifier, createTranscript, authorizeEffect,
  neverWriteSet, type ProcessRunner, type WorktreeHost, type Transcript,
} from '@tangleai/evolve/host';
import { DEFAULT_EVOLVE_BUDGETS, ok, refuseOne } from '@tangleai/evolve';
import type { EvolveRepository } from '@tangleai/evolve/contracts';
import { loadEvolveFixture, materializeEvolveFixture as materializeRegisteredFixture } from '../../../benchmark/lib/evolve-fixture.ts';

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

// ---------------------------------------------------------------------------
// the registered fixture repository, wired for gate, measurement and settling
// ---------------------------------------------------------------------------

/**
 * The real ranking fixture — the same bytes the instrument registers —
 * materialized as a git repository with a worktree root beside it, and the
 * host stack wired on top. Using the registered repository rather than a
 * hand-rolled one is deliberate: a gate test that passes against a toy gate
 * proves nothing about the gate the measurement will actually run.
 */
export interface EvolveRepositoryFixture {
  base: string;
  repositoryRoot: string;
  worktreeRoot: string;
  baseRevision: string;
  runner: ProcessRunner;
  host: WorktreeHost;
  store: ReturnType<typeof createEvolveEffectStore>;
  driver: ReturnType<typeof createEffectDriver>;
  transcript: Transcript;
  db: Awaited<ReturnType<typeof openTangleDb>>;
  repository: EvolveRepository;
  /** The registered gate and instrument argv, read from the manifest. */
  gateArgs: string[];
  instrumentArgs: string[];
  truth: number;
}

/** Accept exactly one argv, by value. A registered command has no variants. */
export const exactArgs = (expected: readonly string[]) => (argv: string[]) =>
  (argv.length === expected.length && argv.every((one, index) => one === expected[index])
    ? ok(true as const)
    : refuseOne<true>('TEVO1006', '/args', 'Only the registered argv is accepted.'));

export async function withEvolveRepository<T>(
  body: (fixture: EvolveRepositoryFixture) => Promise<T>,
  options: { legMs?: number, stdoutBytes?: number } = {},
): Promise<T> {
  const root = process.cwd();
  const loaded = await loadEvolveFixture(root);
  const base = await mkdtemp(join(tmpdir(), 'tangle-evolve-repo-'));
  const repositoryRoot = join(base, 'repo');
  const worktreeRoot = join(base, 'worktrees');
  await mkdir(repositoryRoot, { recursive: true });
  await mkdir(worktreeRoot, { recursive: true });

  const materialized = await materializeRegisteredFixture(root, repositoryRoot);
  const gateArgs = [...loaded.manifest.policy.gate.command.slice(1)];
  const instrumentArgs = [...loaded.manifest.policy.instrument.command.slice(1)];

  const runner = createProcessRunner({
    allow: {
      git: { file: 'git', args: validateGitArgs, cwd: 'worktree' },
      // The gate and the instrument are selected by NAME; the argv is the
      // registered one and nothing else can be substituted for it.
      gate: { file: loaded.manifest.policy.gate.command[0], args: exactArgs(gateArgs), cwd: 'worktree' },
      instrument: { file: loaded.manifest.policy.instrument.command[0], args: exactArgs(instrumentArgs), cwd: 'worktree' },
      // The same instrument against the base is a different NAME, so it
      // resolves to a different root and cannot be confused for the other.
      'instrument-base': { file: loaded.manifest.policy.instrument.command[0], args: exactArgs(instrumentArgs), cwd: 'base' },
    },
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
    limits: {
      legMs: options.legMs ?? loaded.manifest.budgets.gateTimeoutMs,
      stdoutBytes: options.stdoutBytes ?? loaded.manifest.budgets.stdoutBytes,
      stderrBytes: loaded.manifest.budgets.stderrBytes,
    },
    roots: { worktree: base, repository: base, base: base },
  });

  const repository = {
    ...FIXTURE_REPOSITORY('evolve-fixture-rank/v1'),
    id: 'f'.repeat(64),
    budgets: { ...DEFAULT_EVOLVE_BUDGETS, ...loaded.manifest.budgets },
  } as EvolveRepository;

  const host = createWorktreeHost({ runner, repositoryRoot, worktreeRoot, repository });
  const db = await openTangleDb({
    path: join(base, 'effects.sqlite'),
    jobs: { now: () => 1767225600000, random: () => 0.5 },
  });
  const store = createEvolveEffectStore(db, { maxLegs: loaded.manifest.budgets.samples });
  const transcript = createTranscript();
  const never = neverWriteSet({ protectedRefs: repository.protectedRefs, operatorBranch: 'main', checkedOut: [] });
  const external = createExternalEffects({
    store,
    executor: createEffectExecutor({ runner, host }),
    authorize: (plan: never) => authorizeEffect(plan, {
      never, allowedCommands: ['git', 'gate', 'instrument', 'instrument-base'],
    }),
    classify: createEvolveClassifier({
      transcript,
      metric: { name: loaded.manifest.policy.truth.metric },
    }) as never,
  });
  const driver = createEffectDriver({
    jobs: db.jobs as never, effects: store as never, external: external as never, owner: 'evolve-test',
  });

  try {
    return await body({
      base, repositoryRoot, worktreeRoot, baseRevision: materialized.baseRevision,
      runner, host, store, driver, transcript, db, repository,
      gateArgs, instrumentArgs, truth: loaded.manifest.policy.truth.value,
    });
  }
  finally {
    await db.close().catch(() => undefined);
    await rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

/** Put a proposal's candidate source into a worktree and commit it. */
export async function stageProposal(
  fixture: EvolveRepositoryFixture, experimentId: string, proposalId: string,
): Promise<{ path: string, revision: string }> {
  const document = JSON.parse(await readFile(
    join(process.cwd(), 'benchmark/fixtures/evolve/proposals', proposalId + '.json'), 'utf8')) as {
      patch: Array<{ op: string, path: string, value?: string }>,
    };
  const created = await fixture.host.create({ experimentId, baseRevision: fixture.baseRevision });
  if (!created.ok) throw new Error('create: ' + JSON.stringify(created.issues));

  const plan: Record<string, string | null> = {};
  for (const operation of document.patch) {
    const name = operation.path.replace(/^\/files\//, '').replaceAll('~1', '/').replaceAll('~0', '~');
    plan[name] = operation.op === 'remove' ? null : (operation.value ?? '');
  }
  const written = await fixture.host.writeFiles(created.value.path, plan);
  if (!written.ok) throw new Error('writeFiles: ' + JSON.stringify(written.issues));
  const committed = await fixture.host.commit(created.value.path, { experimentId, message: 'candidate' });
  if (!committed.ok) throw new Error('commit: ' + JSON.stringify(committed.issues));
  return { path: created.value.path, revision: committed.value.revision };
}
