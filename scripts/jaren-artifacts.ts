/** Reconstruct and verify candidate Jaren tarballs before dependency installation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ARTIFACT_MANIFEST = 'docs/migrations/jaren-ai/foundations.json';
const PATCH = 'docs/migrations/jaren-ai/foundations.patch';
export interface FoundationArtifact {
  name: string; version: string; directory: string; filename: string;
  sha256: string; integrity: string; files: Record<string, string>;
  edges: Record<string, Record<string, string>>;
}
export interface FoundationArtifacts {
  schemaVersion: 1; mode: 'candidate-artifacts'; legacyAiAllowed: boolean;
  source: { commit: string; version: string; node: string; npm: string; patchSha256: string; state: 'uncommitted candidate' | 'committed' };
  packages: FoundationArtifact[];
}
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8'));
const write = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); };
const command = (cmd: string, args: string[], cwd: string) => execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const git = (cwd: string, ...args: string[]) => command('git', args, cwd).trim();
const npm = (cwd: string, ...args: string[]) => command(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, cwd);
const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
const edges = (pkg: Record<string, unknown>) => Object.fromEntries(SECTIONS.filter(section => pkg[section] !== undefined).map(section => [section, pkg[section] as Record<string, string>]));
const safePath = (path: string) => typeof path === 'string' && path.length > 0 && !path.includes('\\') && !path.includes(':') && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
export function readFoundationArtifacts(root = ROOT): FoundationArtifacts | null {
  const path = resolve(root, ARTIFACT_MANIFEST);
  if (!existsSync(path)) return null;
  const result = read<FoundationArtifacts>(path);
  assert.equal(result.schemaVersion, 1); assert.equal(result.mode, 'candidate-artifacts');
  assert.equal(result.legacyAiAllowed, false, 'Legacy AI cannot enter the cutover closure');
  assert.match(result.source.commit, /^[a-f0-9]{40}$/);
  assert.ok(result.source.state === 'uncommitted candidate' || result.source.state === 'committed', 'Unknown foundation source state');
  for (const pin of [result.source.version, result.source.node, result.source.npm]) assert.match(pin, /^\d+\.\d+\.\d+$/);
  const patch = readFileSync(resolve(root, PATCH));
  assert.equal(hash(patch), result.source.patchSha256, 'Candidate Jaren source patch changed');
  if (result.source.state === 'committed') assert.equal(patch.length, 0, 'Committed foundation source cannot include a patch');
  assert.ok(result.packages.length > 0, 'An empty foundation closure is not qualified');
  assert.equal(new Set(result.packages.map(p => p.name)).size, result.packages.length);
  for (const pkg of result.packages) {
    assert.match(pkg.name, /^@jarenjs\/[a-z-]+$/);
    assert.notEqual(pkg.name, '@jarenjs/ai', 'Legacy AI cannot enter the cutover closure');
    assert.equal(pkg.filename, `jarenjs-${pkg.name.slice('@jarenjs/'.length)}-${pkg.version}.tgz`);
    assert.match(pkg.directory, /^(packages|components)\/[a-z-]+$/);
    assert.equal(pkg.version, result.source.version);
    assert.match(pkg.sha256, /^[a-f0-9]{64}$/);
    assert.match(pkg.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);
    assert.ok(Object.keys(pkg.files).length > 0);
    assert.ok(Object.hasOwn(pkg.files, 'package.json'), `${pkg.name}: missing package manifest`);
    for (const [file, digest] of Object.entries(pkg.files)) {
      assert.ok(safePath(file), `${pkg.name}: unsafe artifact member ${file}`);
      assert.match(digest, /^[a-f0-9]{64}$/);
    }
    assert.ok(pkg.edges && typeof pkg.edges === 'object' && !Array.isArray(pkg.edges));
    for (const [section, dependencies] of Object.entries(pkg.edges)) {
      assert.ok((SECTIONS as readonly string[]).includes(section), `${pkg.name}: unknown dependency section`);
      for (const [name, range] of Object.entries(dependencies)) {
        assert.ok(name.startsWith('@jarenjs/') && name !== '@jarenjs/ai', `${pkg.name}: non-foundation or legacy dependency ${name}`);
        assert.ok(result.packages.some(other => other.name === name), `${pkg.name}: unrecorded dependency ${name}`);
        assert.equal(range, `^${result.source.version}`, `${pkg.name}: dependency version drift`);
      }
    }
  }
  return result;
}
export const artifactPath = (root: string, pkg: FoundationArtifact) => resolve(root, 'dist/jaren', pkg.filename);
export const artifactSpecifier = (pkg: FoundationArtifact) => `file:dist/jaren/${pkg.filename}`;
/** Source checks apply to repository/bootstrap inputs, not external packed consumers. */
export function verifyFoundationSourcePin(root: string, manifest: FoundationArtifacts) {
  assert.match(git(root, 'ls-files', '--stage', 'vendor/jarenjs'), new RegExp(`^160000 ${manifest.source.commit} 0\\s+vendor/jarenjs$`), 'Candidate source gitlink pin drift');
  assert.ok(existsSync(resolve(root, 'vendor/jarenjs/package.json')), 'Initialize the pinned Jaren source submodule before bootstrap');
  assert.equal(git(resolve(root, 'vendor/jarenjs'), 'rev-parse', 'HEAD'), manifest.source.commit, 'Candidate source checkout pin drift');
  assert.equal(read<{version:string}>(resolve(root, 'vendor/jarenjs/package.json')).version, manifest.source.version, 'Candidate source version drift');
  assert.equal(git(resolve(root, 'vendor/jarenjs'), 'status', '--porcelain', '--untracked-files=no'), '', 'Candidate source base must be clean; changes belong in its recorded patch');
}
function installedFiles(directory: string, prefix = ''): string[] {
  return readdirSync(resolve(directory, prefix)).flatMap(name => {
    const path = prefix ? `${prefix}/${name}` : name;
    const stat = lstatSync(resolve(directory, path));
    assert.ok(!stat.isSymbolicLink(), `Installed foundation member cannot be a source link: ${path}`);
    return stat.isDirectory() ? installedFiles(directory, path) : [path];
  }).sort();
}
function installedFoundations(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes:true })) {
    if (!entry.isDirectory()) continue;
    const path = resolve(directory, entry.name);
    if (entry.name === '@jarenjs') for (const pkg of readdirSync(path)) found.push(resolve(path, pkg));
    else if (entry.name.startsWith('@')) {
      for (const pkg of readdirSync(path, { withFileTypes:true })) if (pkg.isDirectory()) found.push(...installedFoundations(resolve(path, pkg.name, 'node_modules')));
    } else found.push(...installedFoundations(resolve(path, 'node_modules')));
  }
  return found.sort();
}
function verifyArchives(root: string, manifest: FoundationArtifacts, requireAll = true) {
  const archiveDirectory = resolve(root, 'dist/jaren');
  if (existsSync(archiveDirectory)) {
    const expected = new Set(manifest.packages.map(pkg => pkg.filename));
    for (const filename of readdirSync(archiveDirectory)) assert.ok(expected.has(filename), `Unrecorded foundation archive: ${filename}`);
  }
  for (const pkg of manifest.packages) {
    const path = artifactPath(root, pkg);
    if (!requireAll && !existsSync(path)) continue;
    assert.ok(existsSync(path), `${pkg.name}: missing tarball; run jaren:bootstrap before npm ci`);
    const bytes = readFileSync(path);
    assert.equal(hash(bytes), pkg.sha256, `${pkg.name}: tarball SHA-256 mismatch`);
    assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), pkg.integrity, `${pkg.name}: tarball integrity mismatch`);
  }
}
export function verifyFoundationArtifacts(root = ROOT, installed = false) {
  const manifest = readFoundationArtifacts(root);
  assert.ok(manifest, 'Candidate foundation manifest is missing');
  verifyArchives(root, manifest);
  if (installed) assert.deepEqual(installedFoundations(resolve(root, 'node_modules')), manifest.packages.map(pkg => resolve(root, 'node_modules', pkg.name)).sort(), 'Installed foundation closure inventory differs');
  for (const pkg of manifest.packages) {
    if (installed) {
      const directory = resolve(root, 'node_modules', pkg.name);
      assert.equal(realpathSync(directory), directory, `${pkg.name}: installed package cannot be a source link`);
      assert.deepEqual(installedFiles(directory), Object.keys(pkg.files).sort(), `${pkg.name}: installed file inventory differs`);
      for (const [name, expected] of Object.entries(pkg.files))
        assert.equal(hash(readFileSync(resolve(directory, name))), expected, `${pkg.name}/${name}: installed bytes differ from qualified artifact`);
      assert.deepEqual(edges(read<Record<string, unknown>>(resolve(directory, 'package.json'))), pkg.edges, `${pkg.name}: installed dependency edges differ`);
    }
  }
  return manifest;
}
function pack(source: string, root: string): FoundationArtifact[] {
  mkdirSync(resolve(root, 'dist/jaren'), { recursive: true });
  const packages: FoundationArtifact[] = [];
  for (const parent of ['packages', 'components']) for (const entry of readdirSync(resolve(source, parent), { withFileTypes: true })) {
    const directory = `${parent}/${entry.name}`;
    if (!entry.isDirectory() || !existsSync(resolve(source, directory, 'package.json'))) continue;
    const pkg = read<{ name: string; version: string; private?: boolean }>(resolve(source, directory, 'package.json'));
    if (pkg.private) continue;
    const [packed] = JSON.parse(npm(resolve(source, directory), 'pack', '--json', '--ignore-scripts', '--pack-destination', resolve(root, 'dist/jaren'))) as Array<{ filename: string; integrity: string; files: Array<{path: string}> }>;
    const path = resolve(root, 'dist/jaren', packed!.filename), extracted = mkdtempSync(resolve(tmpdir(), 'tangle-foundation-unpack-'));
    try {
      command('tar', ['-xf', path, '-C', extracted], root);
      packages.push({ name: pkg.name, version: pkg.version, directory, filename: packed!.filename,
        sha256: hash(readFileSync(path)), integrity: packed!.integrity, edges:edges(pkg),
        files: Object.fromEntries(packed!.files.map(f => [f.path, hash(readFileSync(resolve(extracted, 'package', f.path)))])) });
    } finally { rmSync(extracted, { recursive: true, force: true }); }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}
/** Capture only when the operator deliberately selects a new candidate source tree. */
export function captureFoundations(source: string, root = ROOT) {
  source = realpathSync(source);
  const node = readFileSync(resolve(source, '.nvmrc'), 'utf8').trim();
  assert.equal(process.versions.node, node, 'Capture Jaren using its pinned Node runtime');
  const pkg = read<{ version: string; packageManager: string }>(resolve(source, 'package.json'));
  assert.equal(npm(source, '--version').trim(), pkg.packageManager.replace(/^npm@/, ''), 'Use the Jaren npm pin');
  // Declaration emitters do not remove outputs for deleted source modules.
  npm(source, 'run', 'clean');
  npm(source, 'run', 'build');
  let patch = command('git', ['diff', '--binary', '--no-ext-diff', 'HEAD'], source);
  for (const path of git(source, 'ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) {
    try { patch += command('git', ['diff', '--no-index', '--binary', '--', '/dev/null', path], source); }
    catch (error) {
      const failure = error as { status?: number; stdout?: string };
      assert.equal(failure.status, 1, `Cannot capture ${path}`);
      patch += failure.stdout;
    }
  }
  mkdirSync(resolve(root, dirname(PATCH)), { recursive: true });
  writeFileSync(resolve(root, PATCH), patch);
  const packages = pack(source, root);
  const manifest: FoundationArtifacts = { schemaVersion: 1, mode: 'candidate-artifacts',
    legacyAiAllowed: false,
    source: { commit: git(source, 'rev-parse', 'HEAD'), version: pkg.version, node,
      npm: pkg.packageManager.replace(/^npm@/, ''), patchSha256: hash(patch), state: patch.length === 0 ? 'committed' : 'uncommitted candidate' }, packages };
  write(resolve(root, ARTIFACT_MANIFEST), manifest);
  verifyFoundationArtifacts(root);
  console.log(`Captured ${packages.length} candidate Jaren tarballs; source ${manifest.source.commit}, patch ${manifest.source.patchSha256}.`);
  return manifest;
}
/** Reconstruct missing artifacts from the pinned source plus its recorded patch. */
export function bootstrapFoundations(root = ROOT) {
  const manifest = readFoundationArtifacts(root);
  assert.ok(manifest, 'No candidate foundation mode is configured');
  verifyFoundationSourcePin(root, manifest);
  verifyArchives(root, manifest, false);
  if (manifest.packages.every(p => existsSync(artifactPath(root, p)))) {
    verifyFoundationArtifacts(root); console.log('Foundation artifacts already match; no writes.'); return;
  }
  assert.equal(process.versions.node, manifest.source.node, 'Bootstrap Jaren using its recorded Node runtime');
  assert.equal(npm(root, '--version').trim(), manifest.source.npm, 'Bootstrap Jaren using its recorded npm runtime');
  const temporary = mkdtempSync(resolve(tmpdir(), 'tangle-foundation-source-'));
  try {
    const source = resolve(temporary, 'source');
    command('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', resolve(root, 'vendor/jarenjs'), source], root);
    git(source, 'config', 'core.autocrlf', 'false');
    git(source, 'checkout', '--quiet', '--detach', manifest.source.commit);
    if (manifest.source.state === 'uncommitted candidate') {
      git(source, 'apply', '--check', resolve(root, PATCH));
      git(source, 'apply', resolve(root, PATCH));
    }
    npm(source, 'ci', '--ignore-scripts', '--no-audit', '--no-fund');
    npm(source, 'run', 'clean');
    npm(source, 'run', 'build');
    const rebuilt = pack(source, temporary);
    for (const expected of manifest.packages) {
      const actual = rebuilt.find(p => p.name === expected.name);
      assert.ok(actual, `${expected.name}: missing from reconstructed foundation closure`);
      const changed = [...new Set([...Object.keys(expected.files), ...Object.keys(actual.files)])]
        .filter(file => expected.files[file] !== actual.files[file]);
      assert.equal(changed.length, 0, `${expected.name}: reconstructed files differ: ${changed.join(', ')}`);
      assert.equal(actual.sha256, expected.sha256, `${expected.name}: reconstructed tarball bytes differ`);
    }
    assert.deepEqual(rebuilt, manifest.packages, 'Reconstructed foundation closure differs');
    mkdirSync(resolve(root, 'dist/jaren'), { recursive: true });
    for (const pkg of rebuilt) cpSync(artifactPath(temporary, pkg), artifactPath(root, pkg));
    verifyFoundationArtifacts(root);
    console.log(`Reconstructed ${rebuilt.length} immutable foundation tarballs from recorded source.`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, source, ...extra] = process.argv.slice(2);
  assert.equal(extra.length, 0);
  if (action === '--capture') { assert.ok(source); captureFoundations(source); }
  else if (action === '--bootstrap') { assert.equal(source, undefined); bootstrapFoundations(); }
  else if (action === '--verify') { assert.ok(source === undefined || source === '--installed'); verifyFoundationArtifacts(ROOT, source === '--installed'); }
  else throw new Error('Use --capture <source>, --bootstrap, or --verify [--installed]');
}
