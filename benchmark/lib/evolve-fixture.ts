/**
 * The experiment fixture repository — one materializer, one loader.
 *
 * A repository experiment needs a repository, and pointing one at this
 * checkout would make every measurement cost the full gate and depend on
 * whatever the operator has in flight. So the target is a tiny ranking
 * project committed here as plain files and turned into a git repository
 * in a temporary directory at run time. Nothing under the fixture tree is
 * ever a repository itself: a nested `.git` would be carried by clones,
 * rewritten by tools and impossible to review.
 *
 * Materialization is hermetic and therefore reproducible. System and
 * global git configuration are switched off, the exclude file is silenced,
 * author and committer identity and date are fixed, and signing is
 * disabled — so the commit the fixture produces is a constant this
 * registration can pin, on any host and in any clone. Every git call is an
 * argv array through `execFile` with a bound timeout, a bound buffer and an
 * explicit environment allow-list; nothing reaches a shell.
 *
 * The loader reads only committed bytes: it recomputes every repository
 * file digest, the strategy library revision and each proposal's canonical
 * revision, and refuses the load when one moved. Confirming the base
 * revision costs a materialization and belongs to the instrument, not to
 * the loader.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { canonicalSha256 } from '@jarenjs/json/canonical';

import { createReportValidator, describeErrors } from './validate.ts';
import evolveSchema from '../schemas/evolve.schema.json' with { type: 'json' };
import runIdentitySchema from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };
import type { Manifest as EvolveManifest, Proposal as EvolveProposal, Strategy as EvolveStrategy } from './evolve.types.ts';

export const FIXTURE_DIR = 'benchmark/fixtures/evolve';
export const REPO_DIR = `${FIXTURE_DIR}/repo`;
export const MANIFEST_PATH = `${FIXTURE_DIR}/manifest.json`;
export const STRATEGIES_PATH = `${FIXTURE_DIR}/strategies.json`;
export const PROPOSALS_DIR = `${FIXTURE_DIR}/proposals`;

/** Fixed authorship, so the fixture's base commit is a registered constant. */
export const FIXTURE_IDENTITY = {
  name: 'evolve-fixture',
  email: 'fixture@tangleai.invalid',
  /** Kept out of every record: `baseRevision` already pins it. */
  date: '2026-09-13T00:00:00Z',
  message: 'Register the ranking fixture',
} as const;

/** Bounds every git call the fixture makes. */
export const GIT_LIMITS = { timeoutMs: 20_000, maxBufferBytes: 4 * 1024 * 1024 } as const;

export interface GitResult { stdout: string, stderr: string }

/** The one seam a caller may replace; the default is a bounded `execFile`. */
export type GitSpawn = (args: readonly string[], cwd: string) => Promise<GitResult>;

const execute = promisify(execFile);

/**
 * An explicit allow-list, never `process.env`: system and global
 * configuration, the user's exclude file and any credential helper are all
 * out of reach, so two hosts produce the same commit.
 */
function gitEnvironment(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: home,
    XDG_CONFIG_HOME: home,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: FIXTURE_IDENTITY.name,
    GIT_AUTHOR_EMAIL: FIXTURE_IDENTITY.email,
    GIT_AUTHOR_DATE: FIXTURE_IDENTITY.date,
    GIT_COMMITTER_NAME: FIXTURE_IDENTITY.name,
    GIT_COMMITTER_EMAIL: FIXTURE_IDENTITY.email,
    GIT_COMMITTER_DATE: FIXTURE_IDENTITY.date,
  };
}

/** Settings a host cannot be trusted to leave alone, forced per invocation. */
const GIT_OVERRIDES = [
  '-c', 'commit.gpgsign=false',
  '-c', 'core.autocrlf=false',
  '-c', 'core.excludesFile=/dev/null',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'protocol.version=2',
];

function defaultSpawn(home: string): GitSpawn {
  return async (args, cwd) => execute('git', [...GIT_OVERRIDES, ...args], {
    cwd,
    timeout: GIT_LIMITS.timeoutMs,
    maxBuffer: GIT_LIMITS.maxBufferBytes,
    env: gitEnvironment(home),
    encoding: 'utf8',
  });
}

export interface MaterializedFixture {
  /** The temporary working tree holding the fixture repository. */
  path: string;
  /** The constant commit the registration pins. */
  baseRevision: string;
  /** How many git processes materialization spawned — an honest count. */
  runs: number;
}

export interface MaterializeOptions {
  spawn?: GitSpawn;
}

/**
 * Copy the committed fixture tree into `destination` and make it a git
 * repository with one commit. `destination` must already exist and be
 * empty; the caller owns it and removes it.
 */
export async function materializeEvolveFixture(
  root: string,
  destination: string,
  options: MaterializeOptions = {},
): Promise<MaterializedFixture> {
  const git = options.spawn ?? defaultSpawn(destination);
  await cp(join(root, REPO_DIR), destination, { recursive: true });
  let runs = 0;
  const run = async (...args: string[]): Promise<GitResult> => {
    runs += 1;
    return git(args, destination);
  };
  // git init -b main, git add -A, git commit, git rev-parse HEAD: the four
  // processes materialization costs, and the only place this repository
  // builds a repository of its own.
  await run('init', '-b', 'main', '--quiet');
  await run('add', '-A', '--');
  await run('commit', '--quiet', '--no-verify', '-m', FIXTURE_IDENTITY.message);
  const head = await run('rev-parse', 'HEAD');
  const baseRevision = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(baseRevision)) {
    throw new Error(`the fixture repository produced no usable base revision (got '${baseRevision}')`);
  }
  return { path: destination, baseRevision, runs };
}

/**
 * Materialize into a fresh temporary directory and remove it afterwards.
 * The parent owns the directory until the callback settles; cleanup
 * retries bounded, because a failure to remove one is a real failure.
 */
export async function withMaterializedFixture<T>(
  root: string,
  body: (fixture: MaterializedFixture) => Promise<T>,
  options: MaterializeOptions = {},
): Promise<T> {
  const destination = await mkdtemp(join(tmpdir(), 'evolve-fixture-'));
  try {
    return await body(await materializeEvolveFixture(root, destination, options));
  } finally {
    await rm(destination, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

/** Every file of the committed fixture tree, path-ordered, with its digest. */
export async function fixtureRepoFiles(root: string): Promise<Array<{ path: string, sha256: string }>> {
  const base = join(root, REPO_DIR);
  const files: Array<{ path: string, sha256: string }> = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await walk(join(directory, entry.name), path);
      else if (entry.isFile()) {
        files.push({ path, sha256: createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex') });
      } else throw new TypeError(`the fixture tree holds a non-file entry at ${path}`);
    }
  };
  await walk(base, '');
  // Code-point order, because this list is a hash input.
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export interface LoadedEvolveFixture {
  manifest: EvolveManifest;
  manifestRevision: string;
  policyRevision: string;
  strategies: EvolveStrategy[];
  strategiesRevision: string;
  /** In registration order. */
  proposals: Array<{ document: EvolveProposal, revision: string }>;
}

const manifestValidator = createReportValidator(
  { $ref: 'https://tangleai.dev/schemas/evolve#/$defs/manifest' },
  [evolveSchema as object, runIdentitySchema as object],
);
const proposalValidator = createReportValidator(
  { $ref: 'https://tangleai.dev/schemas/evolve#/$defs/proposal' },
  [evolveSchema as object, runIdentitySchema as object],
);

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;

/**
 * Read the registration and prove every committed byte still hashes to the
 * identity the manifest claims for it.
 */
export async function loadEvolveFixture(root = process.cwd()): Promise<LoadedEvolveFixture> {
  const manifest = await readJson(join(root, MANIFEST_PATH)) as EvolveManifest;
  const outcome = manifestValidator(manifest);
  if (!outcome.valid) {
    throw new Error(`the experiment fixture manifest does not validate: ${describeErrors(outcome, 5).join('; ')}`);
  }

  const files = await fixtureRepoFiles(root);
  const registered = new Map(manifest.files.map((file) => [file.path, file.sha256]));
  if (files.length !== manifest.files.length) {
    throw new Error(`the fixture repository holds ${files.length} files, the manifest registers ${manifest.files.length}`);
  }
  for (const file of files) {
    if (registered.get(file.path) !== file.sha256) {
      throw new Error(`the fixture repository file ${file.path} does not recompute to its registered revision`);
    }
  }

  const strategies = await readJson(join(root, STRATEGIES_PATH)) as EvolveStrategy[];
  const strategiesRevision = await canonicalSha256(strategies);
  if (strategiesRevision !== manifest.strategiesRevision) {
    throw new Error('the strategy library does not recompute to its registered revision');
  }
  const known = new Set(strategies.map((strategy) => strategy.id));

  const proposals: LoadedEvolveFixture['proposals'] = [];
  for (const entry of manifest.proposals) {
    const document = await readJson(join(root, entry.path)) as EvolveProposal;
    const valid = proposalValidator(document);
    if (!valid.valid) {
      throw new Error(`proposal ${entry.id} does not validate: ${describeErrors(valid, 5).join('; ')}`);
    }
    if (document.id !== entry.id) {
      throw new Error(`the proposal at ${entry.path} declares id '${document.id}', the manifest says '${entry.id}'`);
    }
    const revision = await canonicalSha256(document);
    if (revision !== entry.revision) {
      throw new Error(`proposal ${entry.id} does not recompute to its registered revision`);
    }
    if (!known.has(document.strategyId)) {
      throw new Error(`proposal ${entry.id} names strategy '${document.strategyId}', which the library does not hold`);
    }
    proposals.push({ document, revision });
  }

  return {
    manifest,
    manifestRevision: await canonicalSha256(manifest),
    policyRevision: await canonicalSha256(manifest.policy),
    strategies,
    strategiesRevision,
    proposals,
  };
}
