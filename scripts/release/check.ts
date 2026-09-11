/** Refuse a release whose version, dependency graph or reviewed inputs drifted. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, validateManifests, readJson, git, inputHash, compareVersions, versionTuple, nextVersion, isMain, type ReleaseRecord } from './common.ts';

export function checkRelease(root = ROOT, options: { base?: string; structure?: boolean } = {}) {
  const { cfg, main, names } = validateManifests(root);
  if (options.structure) return;
  const path = resolve(root, `releases/${main.version}.json`);
  assert.ok(existsSync(path), 'No release record for this version; run npm run release:prepare');
  const record = readJson<ReleaseRecord>(path);
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.version, main.version);
  assert.equal(versionTuple(record.version)[0], cfg.major);
  assert.match(record.baseCommit, /^[a-f0-9]{40}$/);
  if (record.preparationCommit) assert.match(record.preparationCommit, /^[a-f0-9]{40}$/);
  assert.ok(compareVersions(record.version, record.baseVersion) > 0, 'Release version did not increase');
  const base = JSON.parse(git(root, 'show', `${record.baseCommit}:package.json`));
  assert.equal(record.baseVersion, base.version, 'Release base version does not match its commit');
  git(root, 'merge-base', '--is-ancestor', record.baseCommit, 'HEAD');
  if (record.initial) {
    assert.equal(record.baseCommit, cfg.initialBase);
    assert.equal(record.version, cfg.initialVersion);
    assert.equal(record.baseVersion, '0.1.0');
  }
  assert.deepEqual(record.packages, names.map(name => ({ name, version: main.version })), 'Release package inventory drifted');
  assert.ok(record.changesets.length > 0 && record.changesets.every(c => c.summary.trim() && c.releases.length > 0), 'A release requires recorded intent');
  for (const change of record.changesets)
    for (const release of change.releases) {
      assert.ok(names.includes(release.name), 'Release intent references a private or unknown package');
      assert.ok(['patch', 'minor'].includes(release.type), 'Major releases are disabled');
    }
  if (!record.initial) {
    const impact = record.changesets.some(c => c.releases.some(r => r.type === 'minor')) ? 'minor' : 'patch';
    assert.equal(record.version, nextVersion(record.baseVersion, impact), 'The version does not match the recorded Changesets impact');
  }
  assert.deepEqual(readdirSync(resolve(root, '.changeset')).filter(p => p.endsWith('.md') && p !== 'README.md'), [], 'Unconsumed changesets remain; prepare the release before committing');
  assert.equal(record.inputHash, inputHash(root), 'Release inputs changed after preparation; review and run release:prepare -- --refresh before committing');
  if (options.base) {
    assert.match(options.base, /^[a-f0-9]{40}$/, 'The CI base must be a full commit SHA');
    const previous = JSON.parse(git(root, 'show', `${options.base}:package.json`));
    assert.ok(compareVersions(main.version, previous.version) > 0, 'This push did not advance the suite version');
  }
  return record;
}
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : undefined;
  assert.ok(args.every((a, i) => ['--base', '--structure'].includes(a) || args[i - 1] === '--base'), 'Unknown release check argument');
  if (args.includes('--base')) assert.ok(base, '--base requires a commit SHA');
  checkRelease(ROOT, { base, structure: args.includes('--structure') });
  console.log('Release versions, dependency references, lockfile and preparation verified.');
}
