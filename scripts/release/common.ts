/** Shared release invariants. No command shells or ambient publication targets. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
export interface Manifest {
  name: string; version: string; private?: boolean; type?: string;
  main?: string; types?: string; exports?: Record<string, string | Record<string, string>>;
  scripts?: Record<string, string>; packageManager?: string;
  dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
  publishConfig?: { access?: string; registry?: string }; files?: string[];
  [key: string]: unknown;
}
export interface ReleaseConfig {
  schemaVersion: number; initialVersion: string; initialBase: string; major: number;
  registry: string; repository: string; bun: string; packages: string[]; privateWorkspaces: string[];
}
export interface ReleaseRecord {
  schemaVersion: 1; version: string; baseVersion: string; baseCommit: string;
  preparationCommit?: string;
  initial: boolean; inputHash: string;
  changesets: Array<{ id: string; summary: string; releases: Array<{ name: string; type: string }> }>;
  packages: Array<{ name: string; version: string }>;
}
export const readJson = <T = Manifest>(path: string): T => JSON.parse(readFileSync(path, 'utf8'));
export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
export const config = (root = ROOT) => readJson<ReleaseConfig>(resolve(root, 'release.config.json'));
export const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const integrity = (value: Uint8Array) => 'sha512-' + createHash('sha512').update(value).digest('base64');
export function versionTuple(version: string): [number, number, number] {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Release versions must be numeric SemVer, without a v prefix');
  const parts = version.split('.').map(Number);
  assert.ok(parts.every(Number.isSafeInteger), 'Version components must be safe integers');
  return parts as [number, number, number];
}
export function compareVersions(a: string, b: string) {
  const left = versionTuple(a), right = versionTuple(b);
  return Math.sign(left[0] - right[0] || left[1] - right[1] || left[2] - right[2]);
}
export function nextVersion(version: string, impact: 'patch' | 'minor') {
  const [major, minor, patch] = versionTuple(version);
  return impact === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}
export function manifestPaths(root = ROOT) {
  const dirs: string[] = [];
  for (const parent of ['packages', 'components', 'apps']) {
    if (!existsSync(resolve(root, parent))) continue;
    for (const entry of readdirSync(resolve(root, parent), { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(resolve(root, parent, entry.name, 'package.json'))) dirs.push(`${parent}/${entry.name}`);
    }
  }
  return ['', ...dirs.sort(), 'benchmark'];
}
export function validateManifests(root = ROOT, options: { lock?: boolean } = {}) {
  const cfg = config(root);
  const main = readJson(resolve(root, 'package.json'));
  assert.equal(versionTuple(main.version)[0], cfg.major, `Major releases are disabled; expected major ${cfg.major}`);
  assert.equal(main.private, true, 'The repository root must remain private');
  const dirs = manifestPaths(root);
  const packages = dirs.map(dir => ({ dir, manifest: readJson(resolve(root, dir, 'package.json')) }));
  assert.deepEqual(packages.filter(p => !p.manifest.private).map(p => p.dir).sort(), [...cfg.packages].sort(), 'Public workspaces must exactly match the publication allowlist');
  assert.deepEqual(packages.filter(p => p.dir && p.manifest.private).map(p => p.dir).sort(), [...cfg.privateWorkspaces].sort(), 'Private workspace inventory changed');
  const names = cfg.packages.map(dir => packages.find(p => p.dir === dir)!.manifest.name);
  assert.equal(new Set(names).size, names.length, 'Duplicate public package names');
  const changesets = readJson<any>(resolve(root, '.changeset/config.json'));
  assert.deepEqual(changesets.fixed, [names], 'Changesets must use the exact ordered public fixed group');
  assert.deepEqual(changesets.linked, []);
  assert.deepEqual(changesets.ignore, []);
  assert.equal(changesets.commit, false);
  assert.equal(changesets.access, 'public');
  assert.deepEqual(changesets.privatePackages, { version: false, tag: false });
  const lock = options.lock === false ? null : readJson<any>(resolve(root, 'package-lock.json'));
  if (lock) assert.equal(lock.version, main.version, 'Root lockfile version is stale');
  for (const { dir, manifest } of packages) {
    assert.equal(manifest.version, main.version, `${dir || 'root'}: suite version mismatch`);
    if (!manifest.private) {
      assert.equal(manifest.publishConfig?.access, 'public', `${dir}: explicit public access required`);
      assert.equal(manifest.publishConfig?.registry, cfg.registry, `${dir}: incorrect registry`);
    }
    for (const section of SECTIONS) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (name.startsWith('@tangleai/')) {
          assert.ok(names.includes(name), `${dir}: dependency on an unknown/private workspace ${name}`);
          const expected = manifest.private ? main.version : `^${main.version}`;
          assert.equal(range, expected, `${dir || 'root'}: stale ${section}.${name}`);
        }
      }
      if (lock) assert.deepEqual(lock.packages[dir]?.[section] ?? {}, manifest[section] ?? {}, `${dir || 'root'}: stale lockfile ${section}`);
    }
    if (lock) assert.equal(lock.packages[dir]?.version, main.version, `${dir || 'root'}: stale lockfile version`);
    if (lock && dir) {
      assert.equal(lock.packages[`node_modules/${manifest.name}`]?.link, true, `${dir}: missing workspace lockfile link`);
      assert.equal(lock.packages[`node_modules/${manifest.name}`]?.resolved, dir, `${dir}: workspace lockfile points elsewhere`);
    }
  }
  // The allowlist is also the publication order; dependencies must precede consumers.
  const available = new Set<string>();
  for (const dir of cfg.packages) {
    const pkg = packages.find(p => p.dir === dir)!.manifest;
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const)
      for (const name of Object.keys(pkg[section] ?? {}))
        if (names.includes(name)) assert.ok(available.has(name), `${pkg.name}: publish ${name} first`);
    available.add(pkg.name);
  }
  return { cfg, main, packages, names };
}

/** Hash the reviewable tree, including untracked source and gitlink identities.
 * Release records are excluded to avoid a record hashing itself. Ignored output
 * and nested submodule content never become release inputs. */
export function inputHash(root = ROOT) {
  const paths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
  const entries: Array<[string, string, string]> = [];
  for (const path of paths) {
    if (/^releases\/[^/]+\.json$/.test(path)) continue;
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) continue;
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) {
      const index = git(root, 'ls-files', '--stage', '--', path);
      assert.match(index, /^160000 /, `${path}: unexpected directory in release inputs`);
      let commit = index.split(' ')[1];
      if (existsSync(resolve(absolute, '.git'))) {
        commit = git(absolute, 'rev-parse', 'HEAD');
        assert.equal(git(absolute, 'status', '--porcelain', '--untracked-files=no'), '', `${path}: dirty submodule`);
      }
      entries.push([path, 'gitlink', commit]);
    } else {
      assert.ok(stat.isFile(), `${path}: symlink release inputs are unsupported`);
      entries.push([path, 'file', sha256(readFileSync(absolute))]);
    }
  }
  return sha256(JSON.stringify(entries));
}
export function npmCommand(root = ROOT) {
  const cli = process.env.npm_execpath;
  assert.ok(cli && /(?:^|[\\/])npm-cli\.js$/.test(cli), 'Run release commands with npm run under the pinned npm');
  const expected = readJson(resolve(root, 'package.json')).packageManager;
  const actual = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim();
  assert.equal(`npm@${actual}`, expected, `Use ${expected} before modifying the lockfile`);
  return { file: process.execPath, prefix: [cli] };
}
export function npm(args: string[], options: { root?: string; cwd?: string; capture?: boolean; authenticated?: boolean } = {}) {
  const root = options.root ?? ROOT;
  const command = npmCommand(root);
  const env = { ...process.env };
  if (!options.authenticated) { delete env.NPM_TOKEN; delete env.NODE_AUTH_TOKEN; }
  return execFileSync(command.file, [...command.prefix, ...args], {
    cwd: options.cwd ?? root, env, encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  }) ?? '';
}
export function assertClean(root = ROOT) {
  const status = git(root, 'status', '--porcelain');
  assert.equal(status, '', `Release commands require a clean committed tree. Review and close out intended release changes, or stash unrelated edits before publishing; restore them afterward. Changed paths:\n${status}`);
}
export function assertReleaseTag(root: string, version: string, commit: string) {
  assert.equal(git(root, 'rev-parse', `refs/tags/v${version}^{commit}`), commit, 'Release tag must identify the tested commit');
  assert.equal(git(root, 'cat-file', '-t', `refs/tags/v${version}`), 'tag', 'Release tags must be annotated');
}
export function mainCommit(root = ROOT): string | undefined {
  try { return git(root, 'rev-parse', '--verify', 'refs/remotes/origin/main'); } catch { return undefined; }
}
export function assertRefreshable(root: string, record: ReleaseRecord) {
  let tag: string | undefined;
  try { tag = git(root, 'rev-parse', '--verify', `refs/tags/v${record.version}`); } catch { /* Not tagged yet. */ }
  assert.equal(tag, undefined, 'A tagged release needs a new changeset and version');
  const main = mainCommit(root);
  if (main) {
    const accepted = JSON.parse(git(root, 'show', `${main}:package.json`));
    assert.ok(compareVersions(accepted.version, record.version) < 0, 'A release accepted on main needs a new changeset and version');
  } else assert.equal(record.preparationCommit ?? record.baseCommit, git(root, 'rev-parse', 'HEAD'), 'Fetch origin/main before refreshing a locally committed release');
}
export const isMain = (url: string) => !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
export function relativePath(root: string, path: string) { return relative(root, path).split(sep).join('/'); }
