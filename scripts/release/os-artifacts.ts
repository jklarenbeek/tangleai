/**
 * The desktop package as files in the tree, so an application that pulls this
 * repository in as a git submodule depends on it with no registry and no
 * build: `releases/os/tangleai-os-<version>.tgz` (the very tarball the release
 * build packed), `releases/os/tangle-os-module.js` (the module side as one
 * self-contained browser file, for a page on any foundation or none) and
 * `releases/os/manifest.json` (hashes, integrity, the protocol and the Jaren
 * foundation the tarball depends on). `--check` proves the tracked files equal
 * a fresh build; the files are left out of the release input hash, since they
 * are built from it.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ROOT, config, readJson, integrity, isMain, sha256 } from './common.ts';
import { PROTOCOL } from '../../components/os/src/contracts.ts';

export const OS_DIRECTORY = 'releases/os';
export const MODULE_FILE = 'tangle-os-module.js';

type OsManifest = {
  $osRelease: '0.1', version: string, protocol: number,
  package: { name: string, file: string, size: number, sha256: string, integrity: string, dependencies: Record<string, string>, exports: string[] },
  module: { file: string, size: number, sha256: string, format: 'esm', target: 'browser', exports: string[] },
  foundation: { name: 'jarenjs', version: string, commit: string },
  toolchain: { bun: string },
};

/** The module side bundled with every dependency inside: one ES module for the browser. */
function bundleModule(root: string, outfile: string, bun: string) {
  assert.equal(execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim(), bun, 'Bundle with the pinned Bun release');
  execFileSync('bun', ['build', 'components/os/src/module.ts', '--target=browser', '--format=esm', '--minify', `--outfile=${outfile}`],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], timeout: 120_000 });
}

/** The tracked files as a fresh build makes them: name → bytes. */
function fresh(root: string): Map<string, Buffer> {
  const cfg = config(root);
  const version = readJson<{ version: string }>(resolve(root, 'package.json')).version;
  const artifacts = readJson<{ version: string, packages: Array<{ name: string, filename: string, integrity: string, exports: Record<string, unknown> }> }>(resolve(root, 'dist/release/artifacts.json'));
  assert.equal(artifacts.version, version, 'Build the release first: npm run release:build');
  const os = artifacts.packages.find(p => p.name === '@tangleai/os');
  assert.ok(os, 'The release build packed no @tangleai/os');
  const tarball = readFileSync(resolve(root, 'dist/release', os.filename));
  assert.equal(integrity(tarball), os.integrity, 'The packed desktop tarball changed after the build');
  const work = mkdtempSync(resolve(tmpdir(), 'tangle-os-module-'));
  let module: Buffer;
  try { bundleModule(root, resolve(work, MODULE_FILE), cfg.bun); module = readFileSync(resolve(work, MODULE_FILE)); }
  finally { rmSync(work, { recursive: true, force: true }); }
  const pkg = readJson<{ dependencies?: Record<string, string> }>(resolve(root, 'components/os/package.json'));
  const dependencies = pkg.dependencies ?? {};
  for (const name of Object.keys(dependencies)) assert.match(name, /^@jarenjs\//, `The desktop package must depend on Jaren alone: ${name}`);
  const foundation = readJson<{ source: { version: string, commit: string } }>(resolve(root, 'docs/migrations/jaren-ai/foundations.json')).source;
  const manifest: OsManifest = {
    $osRelease: '0.1', version, protocol: PROTOCOL,
    package: { name: '@tangleai/os', file: os.filename, size: tarball.length, sha256: sha256(tarball), integrity: os.integrity, dependencies, exports: Object.keys(os.exports) },
    module: { file: MODULE_FILE, size: module.length, sha256: sha256(module), format: 'esm', target: 'browser', exports: ['OsConnectError', 'applyLocale', 'applyTheme', 'connectToOs'] },
    foundation: { name: 'jarenjs', version: foundation.version, commit: foundation.commit },
    toolchain: { bun: cfg.bun },
  };
  return new Map([[os.filename, tarball], [MODULE_FILE, module], ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]]);
}

/** Write the tracked files, removing an older version's tarball. */
export function writeOsArtifacts(root = ROOT) {
  const files = fresh(root);
  const directory = resolve(root, OS_DIRECTORY);
  mkdirSync(directory, { recursive: true });
  for (const name of readdirSync(directory)) if (!files.has(name)) rmSync(resolve(directory, name));
  for (const [name, bytes] of files) writeFileSync(resolve(directory, name), bytes);
  console.log(`Wrote ${[...files.keys()].join(', ')} to ${OS_DIRECTORY}.`);
}

/** Assert the tracked files equal a fresh build, and nothing else is there. */
export function checkOsArtifacts(root = ROOT) {
  const files = fresh(root);
  const directory = resolve(root, OS_DIRECTORY);
  assert.ok(existsSync(directory), `Run node scripts/release/os-artifacts.ts to write ${OS_DIRECTORY}`);
  assert.deepEqual(readdirSync(directory).sort(), [...files.keys()].sort(), `${OS_DIRECTORY} holds other files than the release`);
  for (const [name, bytes] of files) assert.ok(readFileSync(resolve(directory, name)).equals(bytes), `${OS_DIRECTORY}/${name} differs from a fresh build; run node scripts/release/os-artifacts.ts`);
  console.log(`Verified ${OS_DIRECTORY} against the fresh build.`);
}

/** Copy the tracked files somewhere, for a consumer fixture. */
export function copyOsArtifacts(target: string, root = ROOT) {
  for (const name of readdirSync(resolve(root, OS_DIRECTORY))) copyFileSync(resolve(root, OS_DIRECTORY, name), resolve(target, name));
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--check'), 'Use os-artifacts.ts or os-artifacts.ts --check');
  if (args[0] === '--check') checkOsArtifacts(); else writeOsArtifacts();
}
