import { it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ROOT, config, manifestPaths, readJson, writeJson, validateManifests, inputHash, git, assertReleaseTag, SECTIONS, type ReleaseRecord } from '../../scripts/release/common.ts';
import { prepare, synchronizeVersions } from '../../scripts/release/prepare.ts';
import { checkRelease } from '../../scripts/release/check.ts';
import { distributionManifest } from '../../scripts/release/build.ts';
import { publicationDecision, type RegistryVersion } from '../../scripts/release/registry.ts';
import { publishSequence, type PublishReceipt } from '../../scripts/release/publish.ts';
import { verifyBuildIdentity } from '../../scripts/release/verify-site.ts';
import type { Artifacts, Artifact } from '../../scripts/release/build.ts';

function commit(root: string) {
  git(root, 'add', '--all');
  git(root, '-c', 'user.name=Release fixture', '-c', 'user.email=release@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture');
  return git(root, 'rev-parse', 'HEAD');
}
function lock(root: string) {
  const packages: Record<string, unknown> = {};
  for (const dir of manifestPaths(root)) {
    const pkg = readJson(resolve(root, dir, 'package.json'));
    packages[dir] = { name: pkg.name, version: pkg.version, ...Object.fromEntries(SECTIONS.filter(key => pkg[key]).map(key => [key, pkg[key]])) };
    if (dir) packages[`node_modules/${pkg.name}`] = { resolved: dir, link: true };
  }
  writeJson(resolve(root, 'package-lock.json'), { name: 'tangleai', version: readJson(resolve(root, 'package.json')).version, lockfileVersion: 3, packages });
}
function fixture(t: TestContext, version = '0.19.0') {
  const root = mkdtempSync(resolve(tmpdir(), 'tangle-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  // Keep the user's ignore patterns and line-ending choices out of the fixture.
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'config', 'core.excludesFile', resolve(root, '.git/empty-ignore'));
  writeFileSync(resolve(root, '.git/empty-ignore'), '');
  for (const dir of manifestPaths()) {
    const pkg = readJson(resolve(ROOT, dir, 'package.json'));
    for (const section of SECTIONS) {
      if (pkg[section]) pkg[section] = Object.fromEntries(Object.entries(pkg[section]!).filter(([name]) => name.startsWith('@tangleai/')));
    }
    delete pkg.scripts;
    writeJson(resolve(root, dir, 'package.json'), pkg);
  }
  writeJson(resolve(root, 'release.config.json'), config());
  const changesets = readJson<any>(resolve(ROOT, '.changeset/config.json'));
  changesets.changelog = false;
  writeJson(resolve(root, '.changeset/config.json'), changesets);
  writeFileSync(resolve(root, '.gitignore'), 'node_modules/\n');
  mkdirSync(resolve(root, 'packages/core/src'), { recursive: true });
  writeFileSync(resolve(root, 'packages/core/src/index.ts'), 'export const value = 1;\n');
  synchronizeVersions(root, version);
  lock(root);
  const base = commit(root);
  return { root, base };
}
function prepared(t: TestContext) {
  const { root, base } = fixture(t);
  synchronizeVersions(root, '0.20.0');
  lock(root);
  const record: ReleaseRecord = { schemaVersion: 1, version: '0.20.0', baseVersion: '0.19.0', baseCommit: base,
    initial: false, inputHash: inputHash(root), changesets: [{ id: 'fixture', summary: 'Add a public capability.', releases: [{ name: '@tangleai/core', type: 'minor' }] }],
    packages: config(root).packages.map(dir => ({ name: readJson(resolve(root, dir, 'package.json')).name, version: '0.20.0' })),
  };
  writeJson(resolve(root, 'releases/0.20.0.json'), record);
  return { root, base, record };
}

it('accepts one prepared version but rejects a subsequent push without a bump', t => {
  const { root, base } = prepared(t);
  assert.equal(checkRelease(root, { base })?.version, '0.20.0');
  const released = commit(root);
  assert.throws(() => checkRelease(root, { base: released }), /did not advance/);
});
it('rejects source changes after preparation', t => {
  const { root } = prepared(t);
  writeFileSync(resolve(root, 'packages/core/src/index.ts'), 'export const value = 2;\n');
  assert.throws(() => checkRelease(root), /inputs changed/);
});
it('refuses a tag on the wrong commit and a lightweight release tag', t => {
  const { root, base } = prepared(t);
  const head = commit(root);
  git(root, '-c', 'user.name=Release fixture', '-c', 'user.email=release@example.test', 'tag', '-a', 'v0.20.0', base, '-m', 'Fixture release');
  assert.throws(() => assertReleaseTag(root, '0.20.0', head), /tested commit/);
  git(root, 'tag', '-d', 'v0.20.0');
  git(root, 'tag', 'v0.20.0', head);
  assert.throws(() => assertReleaseTag(root, '0.20.0', head), /annotated/);
});
it('refuses a version that understates a recorded minor change', t => {
  const { root, record } = prepared(t);
  record.baseVersion = '0.19.0';
  record.version = '0.19.1';
  synchronizeVersions(root, record.version);
  lock(root);
  record.packages = record.packages.map(pkg => ({ ...pkg, version: record.version }));
  record.inputHash = inputHash(root);
  writeJson(resolve(root, 'releases/0.19.1.json'), record);
  assert.throws(() => checkRelease(root), /Changesets impact/);
});
it('rejects a mixed suite, stale private references and an out-of-sync lockfile', t => {
  const { root } = prepared(t);
  const path = resolve(root, 'packages/memory/package.json');
  const original = readJson(path);
  writeJson(path, { ...original, version: '0.20.1' });
  assert.throws(() => validateManifests(root), /suite version mismatch/);
  writeJson(path, original);
  const app = resolve(root, 'apps/desktop/package.json');
  const desktop = readJson(app);
  desktop.dependencies!['@tangleai/core'] = '0.19.0';
  writeJson(app, desktop);
  assert.throws(() => validateManifests(root), /stale dependencies/);
  synchronizeVersions(root, '0.20.0');
  const data = readJson<any>(resolve(root, 'package-lock.json'));
  data.packages['packages/core'].version = '0.19.0';
  writeJson(resolve(root, 'package-lock.json'), data);
  assert.throws(() => validateManifests(root), /stale lockfile version/);
});
it('refuses major one and accidental publication of a private app', t => {
  const { root } = prepared(t);
  synchronizeVersions(root, '1.0.0');
  assert.throws(() => validateManifests(root), /Major releases are disabled/);
  synchronizeVersions(root, '0.20.0');
  const path = resolve(root, 'apps/pages/package.json');
  const pkg = readJson(path);
  writeJson(path, { ...pkg, private: false });
  assert.throws(() => validateManifests(root), /publication allowlist/);
});
it('prepares a real Changesets patch across the fixed group and retry does not bump twice', async t => {
  const { root } = fixture(t, '0.20.0');
  writeFileSync(resolve(root, '.changeset/fix.md'), '---\n"@tangleai/search": patch\n---\n\nFix search transport handling.\n');
  await prepare(root);
  assert.equal(readJson(resolve(root, 'package.json')).version, '0.20.1');
  validateManifests(root);
  const before = readFileSync(resolve(root, 'releases/0.20.1.json'), 'utf8');
  await prepare(root);
  assert.equal(readFileSync(resolve(root, 'releases/0.20.1.json'), 'utf8'), before);
  assert.ok(!existsSync(resolve(root, '.changeset/fix.md')));
});
it('combines patch and minor intent into one minor release', async t => {
  const { root } = fixture(t, '0.20.0');
  writeFileSync(resolve(root, '.changeset/fix.md'), '---\n"@tangleai/search": patch\n---\n\nFix search.\n');
  writeFileSync(resolve(root, '.changeset/feature.md'), '---\n"@tangleai/memory": minor\n---\n\nAdd memory capability.\n');
  await prepare(root);
  assert.equal(checkRelease(root)?.version, '0.21.0');
});
it('bases a release on main so draft commits can be squash merged', async t => {
  const { root, base } = fixture(t, '0.20.0');
  git(root, 'update-ref', 'refs/remotes/origin/main', base);
  writeFileSync(resolve(root, 'packages/core/src/index.ts'), 'export const value = 2;\n');
  const draft = commit(root);
  writeFileSync(resolve(root, '.changeset/fix.md'), '---\n"@tangleai/core": patch\n---\n\nFix the draft behavior.\n');
  await prepare(root);
  const record = checkRelease(root)!;
  assert.equal(record.baseCommit, base);
  assert.equal(record.preparationCommit, draft);
});
it('refreshes a fix on an unmerged release branch but refuses an accepted release', async t => {
  const { root, base } = prepared(t);
  git(root, 'update-ref', 'refs/remotes/origin/main', base);
  commit(root);
  writeFileSync(resolve(root, 'packages/core/src/index.ts'), 'export const value = 2;\n');
  await prepare(root, { refresh: true });
  assert.equal(checkRelease(root, { base })?.version, '0.20.0');
  const accepted = commit(root);
  git(root, 'update-ref', 'refs/remotes/origin/main', accepted);
  await assert.rejects(prepare(root, { refresh: true }), /accepted on main/);
});
it('restores versions, changesets and lockfile when preparation fails after versioning', async t => {
  const { root } = fixture(t, '0.20.0');
  writeFileSync(resolve(root, '.changeset/fix.md'), '---\n"@tangleai/search": patch\n---\n\nFix search.\n');
  const before = inputHash(root);
  await assert.rejects(prepare(root, {}, { install: () => { throw new Error('simulated lock synchronization failure'); } }), /simulated lock/);
  assert.equal(inputHash(root), before);
  assert.equal(readJson(resolve(root, 'package.json')).version, '0.20.0');
  assert.ok(existsSync(resolve(root, '.changeset/fix.md')));
  assert.ok(!existsSync(resolve(root, 'releases/0.20.1.json')));
});
it('rejects major changeset intent before any version write', async t => {
  const { root } = fixture(t, '0.20.0');
  writeFileSync(resolve(root, '.changeset/break.md'), '---\n"@tangleai/core": major\n---\n\nRemove an API.\n');
  const before = inputHash(root);
  await assert.rejects(prepare(root), /Major releases are disabled/);
  assert.equal(inputHash(root), before);
});
it('publication manifests preserve subpaths and schemas while removing source lifecycle hooks', () => {
  const result = distributionManifest(readJson(resolve(ROOT, 'packages/config/package.json')));
  assert.equal(result.scripts, undefined);
  assert.deepEqual(result.exports?.['./contracts'], { types: './src/contracts.gen.d.ts', import: './src/contracts.gen.js', default: './src/contracts.gen.js' });
  assert.equal(result.exports?.['./schemas/run-identity'], './schemas/run-identity.schema.json');
  assert.throws(() => distributionManifest({ name: '@tangleai/test', version: '0.20.0', exports: { '.': '../secret.ts' } }), /match/);
});

function artifacts(): Artifacts {
  return { schemaVersion: 1, version: '0.20.0', commit: 'a'.repeat(40), inputHash: 'b'.repeat(64), packages: ['core', 'memory'].map(name => ({
    name: `@tangleai/${name}`, version: '0.20.0', filename: `tangleai-${name}-0.20.0.tgz`, integrity: `sha512-${name}`, exports: { '.': { import: './src/index.js', types: './src/index.d.ts' } },
  })) };
}
const metadata = (pkg: Artifact): RegistryVersion => ({ name: pkg.name, version: pkg.version, exports: pkg.exports, dist: { integrity: pkg.integrity } });
it('preflights every package and refuses an existing version with different bytes before publishing anything', async () => {
  const built = artifacts();
  let writes = 0;
  await assert.rejects(publishSequence(built, {
    lookup: async pkg => pkg.name.endsWith('memory') ? { ...metadata(pkg), dist: { integrity: 'sha512-other' } } : null,
    publish: async () => { writes++; }, verify: async () => {}, save: () => {},
  }), /different bytes/);
  assert.equal(writes, 0);
});
it('resumes a partial publication without republishing the accepted package', async () => {
  const built = artifacts(), registry = new Map<string, RegistryVersion>();
  const calls: string[] = [], receipts: PublishReceipt[] = [];
  let fail = true;
  const io = {
    lookup: async (pkg: Artifact) => registry.get(pkg.name) ?? null,
    publish: async (pkg: Artifact) => {
      calls.push(pkg.name);
      if (pkg.name.endsWith('memory') && fail) throw new Error('network interrupted');
      registry.set(pkg.name, metadata(pkg));
    },
    verify: async (pkg: Artifact) => publicationDecision(pkg, registry.get(pkg.name) ?? null),
    save: (receipt: PublishReceipt) => { receipts.push(structuredClone(receipt)); },
  };
  await assert.rejects(publishSequence(built, io), /network interrupted/);
  assert.equal(receipts.at(-1)?.complete, false);
  assert.equal(receipts.at(-1)?.packages[1].status, 'failed');
  fail = false;
  const done = await publishSequence(built, io);
  assert.equal(done.complete, true);
  assert.deepEqual(calls, ['@tangleai/core', '@tangleai/memory', '@tangleai/memory']);
  assert.equal(done.packages[0].status, 'present');
});
it('a website with the right version but wrong commit or incomplete package set is refused', () => {
  const expected = { version: '0.20.0', commit: 'a'.repeat(40), packages: { '@tangleai/core': '0.20.0' } };
  verifyBuildIdentity(structuredClone(expected), expected);
  assert.throws(() => verifyBuildIdentity({ ...expected, commit: 'b'.repeat(40) }, expected), /Live website/);
  assert.throws(() => verifyBuildIdentity({ ...expected, packages: {} }, expected), /Live website/);
});
