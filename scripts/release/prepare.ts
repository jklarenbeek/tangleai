/** Apply Changesets before committing; restore preparation writes on failure. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { getReleasePlan } from '@changesets/get-release-plan';
import { applyReleasePlan } from '@changesets/apply-release-plan';
import { readConfig } from '@changesets/config';
import { getPackages } from '@manypkg/get-packages';
import { ROOT, SECTIONS, config, readJson, writeJson, git, npm, npmCommand, manifestPaths,
  inputHash, versionTuple, compareVersions, validateManifests, assertRefreshable, mainCommit, isMain, type ReleaseRecord } from './common.ts';

export function synchronizeVersions(root: string, version: string) {
  const names = config(root).packages.map(dir => readJson(resolve(root, dir, 'package.json')).name);
  for (const dir of manifestPaths(root)) {
    const file = resolve(root, dir, 'package.json');
    const pkg = readJson(file);
    pkg.version = version;
    for (const section of SECTIONS) {
      for (const name of Object.keys(pkg[section] ?? {})) {
        if (names.includes(name)) pkg[section]![name] = pkg.private ? version : `^${version}`;
      }
    }
    writeJson(file, pkg);
  }
}
export function restorePreparation(root: string, backup: Record<string, string | null>) {
  for (const [path, content] of Object.entries(backup)) {
    const absolute = resolve(root, path);
    if (content === null) rmSync(absolute, { force: true });
    else { mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, Buffer.from(content, 'base64')); }
  }
}
export async function prepare(root = ROOT, options: { initial?: boolean; refresh?: boolean; recover?: boolean } = {}, dependencies = {
  install: (directory: string) => { npm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { root: directory }); },
}) {
  npmCommand(root);
  const cfg = config(root);
  const backupPath = resolve(root, git(root, 'rev-parse', '--git-path', 'tangle-release-prepare.json'));
  if (options.recover) {
    assert.ok(existsSync(backupPath), 'No interrupted preparation to recover');
    restorePreparation(root, readJson<Record<string, string | null>>(backupPath));
    rmSync(backupPath);
    return;
  }
  assert.ok(!existsSync(backupPath), 'Interrupted preparation found; run npm run release:prepare -- --recover first');
  const main = readJson(resolve(root, 'package.json'));
  const currentRecordPath = resolve(root, `releases/${main.version}.json`);
  if (options.refresh) {
    assert.ok(existsSync(currentRecordPath), 'Prepare a release before refreshing its inputs');
    const record = readJson<ReleaseRecord>(currentRecordPath);
    assertRefreshable(root, record);
    validateManifests(root);
    const pending = await getReleasePlan(root);
    assert.equal(pending.changesets.length, 0, 'New changesets require a new release plan');
    record.inputHash = inputHash(root);
    record.preparationCommit = git(root, 'rev-parse', 'HEAD');
    writeJson(currentRecordPath, record);
    console.log(`Refreshed ${record.version}; its version was not bumped again.`);
    return;
  }
  const packages = await getPackages(root);
  assert.deepEqual(packages.packages.filter(p => !p.packageJson.private).map(p => p.packageJson.name).sort(),
    cfg.packages.map(dir => readJson(resolve(root, dir, 'package.json')).name).sort(), 'Public workspace allowlist mismatch');
  const configuration = await readConfig(root, packages);
  assert.ok(configuration.config, configuration.errors?.join('\n'));
  const plan = await getReleasePlan(root);
  assert.equal(plan.preState, undefined, 'This release policy supports numeric 0.x versions; prerelease mode needs an explicit policy change');
  if (plan.changesets.length === 0 && existsSync(currentRecordPath)) {
    const record = readJson<ReleaseRecord>(currentRecordPath);
    assert.equal(record.inputHash, inputHash(root), 'Release inputs changed: refresh an uncommitted preparation, or add a changeset for a new release');
    console.log(`${record.version} is already prepared; no second bump.`);
    return;
  }
  assert.ok(plan.changesets.length > 0, 'Record release intent with npm run changeset before preparing');
  assert.ok(!plan.changesets.some(c => c.releases.some(r => r.type === 'major')), 'Major releases are disabled. During 0.x, record breaking development changes as minor with migration notes.');
  let version = plan.releases[0]?.newVersion;
  assert.ok(version, 'No public package release was selected');
  if (options.initial) {
    assert.equal(git(root, 'rev-parse', 'HEAD'), cfg.initialBase, 'The initial version override is restricted to the configured starting commit');
    assert.equal(main.version, '0.1.0', 'The initial override is only valid before the first coordinated release');
    version = cfg.initialVersion;
    for (const release of plan.releases) if (release.type !== 'none') release.newVersion = version;
  }
  assert.equal(versionTuple(version)[0], cfg.major, 'The next version must retain major zero');
  assert.ok(compareVersions(version, main.version) > 0, 'The release version must increase');
  const names = cfg.packages.map(dir => readJson(resolve(root, dir, 'package.json')).name);
  const publicReleases = plan.releases.filter(r => names.includes(r.name));
  assert.deepEqual(publicReleases.map(r => r.name).sort(), [...names].sort(), 'Changesets did not release the complete public fixed group');
  assert.ok(publicReleases.every(r => r.newVersion === version), 'Changesets produced mixed suite versions');
  assert.ok(plan.releases.filter(r => !names.includes(r.name)).every(r => r.type === 'none'), 'Private packages cannot be Changesets release targets');
  const recordPath = `releases/${version}.json`;
  assert.ok(!existsSync(resolve(root, recordPath)), 'A release record already exists for the target version');
  const paths = [
    ...manifestPaths(root).flatMap(dir => [dir ? `${dir}/package.json` : 'package.json', dir ? `${dir}/CHANGELOG.md` : 'CHANGELOG.md']),
    ...readdirSync(resolve(root, '.changeset')).filter(p => p.endsWith('.md')).map(p => `.changeset/${p}`),
    'package-lock.json', recordPath,
  ];
  const backup = Object.fromEntries(paths.map(path => [path, existsSync(resolve(root, path)) ? readFileSync(resolve(root, path)).toString('base64') : null]));
  const preparationCommit = git(root, 'rev-parse', 'HEAD');
  const baseCommit = mainCommit(root) ?? preparationCommit;
  git(root, 'merge-base', '--is-ancestor', baseCommit, preparationCommit);
  assert.equal(JSON.parse(git(root, 'show', `${baseCommit}:package.json`)).version, main.version, 'Start a new release from the accepted main version; refresh fixes to an unmerged release instead');
  writeJson(backupPath, backup);
  try {
    const record: ReleaseRecord = {
      schemaVersion: 1, version, baseVersion: main.version, baseCommit, preparationCommit,
      initial: options.initial ?? false, inputHash: '', changesets: plan.changesets,
      packages: names.map(name => ({ name, version })),
    };
    await applyReleasePlan(plan, packages, configuration.config);
    synchronizeVersions(root, version);
    dependencies.install(root);
    validateManifests(root);
    const notes = plan.changesets.map(change => change.summary).join('\n\n');
    const previous = existsSync(resolve(root, 'CHANGELOG.md')) ? readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8').replace(/^# Tangle releases\n\n/, '') : '';
    writeFileSync(resolve(root, 'CHANGELOG.md'), `# Tangle releases\n\n## ${version}\n\n${notes}\n\n${previous}`.trimEnd() + '\n');
    record.inputHash = inputHash(root);
    writeJson(resolve(root, recordPath), record);
    rmSync(backupPath);
    console.log(`Prepared ${version} across eight public packages and all private workspaces. Run npm run release:verify before closeout.`);
  } catch (error) {
    restorePreparation(root, backup);
    rmSync(backupPath);
    throw error;
  }
}
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.every(a => ['--initial', '--refresh', '--recover'].includes(a)) && args.length <= 1, 'Use release:prepare with at most one of --initial, --refresh, --recover');
  await prepare(ROOT, { initial: args.includes('--initial'), refresh: args.includes('--refresh'), recover: args.includes('--recover') });
}
