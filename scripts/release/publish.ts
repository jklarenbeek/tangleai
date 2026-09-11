/** Publish only tested bytes; registry state makes interrupted runs resumable. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, config, readJson, writeJson, sha256, npm, assertClean, assertReleaseTag, git, compareVersions, isMain } from './common.ts';
import { checkRelease } from './check.ts';
import { readArtifacts } from './consumers.ts';
import { publicationDecision, registryVersion, type RegistryVersion } from './registry.ts';
import type { Artifact, Artifacts } from './build.ts';
import { assertVerifiedGate } from './verify.ts';

export interface PublishReceipt {
  version: string; commit: string; complete: boolean;
  packages: Array<{ name: string; version: string; integrity: string; status: 'pending' | 'present' | 'published' | 'failed' }>;
}
export async function publishSequence(artifacts: Artifacts, io: {
  lookup(pkg: Artifact): Promise<RegistryVersion | null>;
  publish(pkg: Artifact): Promise<void>;
  verify(pkg: Artifact): Promise<unknown>;
  save(receipt: PublishReceipt): void;
}) {
  // Check the whole inventory before the first irreversible operation.
  const decisions = await Promise.all(artifacts.packages.map(async pkg => publicationDecision(pkg, await io.lookup(pkg))));
  const receipt: PublishReceipt = { version: artifacts.version, commit: artifacts.commit, complete: false,
    packages: artifacts.packages.map(pkg => ({ name: pkg.name, version: pkg.version, integrity: pkg.integrity, status: 'pending' })) };
  io.save(receipt);
  for (const [index, pkg] of artifacts.packages.entries()) {
    const row = receipt.packages[index];
    try {
      if (decisions[index] === 'present') row.status = 'present';
      else { await io.publish(pkg); await io.verify(pkg); row.status = 'published'; }
      io.save(receipt);
    } catch (error) { row.status = 'failed'; io.save(receipt); throw error; }
  }
  receipt.complete = true;
  io.save(receipt);
  return receipt;
}
export async function publish(root = ROOT, options: { execute?: boolean; bootstrap?: boolean } = {}) {
  const record = checkRelease(root)!;
  assertVerifiedGate(root);
  const artifacts = readArtifacts(root);
  const cfg = config(root);
  const verified = readJson<any>(resolve(root, 'dist/release/verification.json'));
  assert.equal(verified.artifactsHash, sha256(readFileSync(resolve(root, 'dist/release/artifacts.json'))), 'The current tarballs have not passed consumer verification');
  assert.equal(verified.inputHash, artifacts.inputHash);
  assert.equal(verified.declarations, true);
  assert.equal(verified.browser, true);
  if (options.execute) {
    assertClean(root);
    const head = git(root, 'rev-parse', 'HEAD');
    assert.equal(artifacts.commit, head, 'Build and verify release artifacts at the final committed revision');
    assertReleaseTag(root, record.version, head);
    if (options.bootstrap) {
      assert.equal(record.initial, true);
      assert.equal(record.version, cfg.initialVersion, 'Local bootstrap is only permitted for the initial version');
      assert.notEqual(process.env.GITHUB_ACTIONS, 'true', 'Bootstrap uses the authenticated local maintainer');
    } else {
      assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Normal publication runs in GitHub Actions with OIDC');
      assert.equal(process.env.GITHUB_REPOSITORY, cfg.repository);
      assert.equal(process.env.GITHUB_SHA, head);
      assert.ok(['refs/heads/main', `refs/tags/v${record.version}`].includes(process.env.GITHUB_REF ?? ''), 'Publication requires main or the exact release tag');
      assert.ok(process.env.ACTIONS_ID_TOKEN_REQUEST_URL, 'The publication job requires id-token: write');
    }
  }
  for (const pkg of artifacts.packages) {
    const latest = await registryVersion(cfg.registry, pkg.name, 'latest');
    if (latest) assert.ok(compareVersions(latest.version, pkg.version) <= 0, `${pkg.name}: refusing to move latest backwards`);
  }
  if (!options.execute) {
    const decisions = await Promise.all(artifacts.packages.map(async pkg => ({ name: pkg.name, version: pkg.version,
      action: publicationDecision(pkg, await registryVersion(cfg.registry, pkg.name, pkg.version)) })));
    console.log(JSON.stringify({ dryRun: true, version: record.version, packages: decisions }, null, 2));
    return;
  }
  return publishSequence(artifacts, {
    lookup: pkg => registryVersion(cfg.registry, pkg.name, pkg.version),
    publish: async pkg => {
      // Scope lifecycle hooks and registry settings cannot change this artifact.
      npm(['publish', resolve(root, 'dist/release', pkg.filename), '--ignore-scripts', '--access=public', '--tag=latest', '--registry', cfg.registry], { root, authenticated: true });
    },
    // Upload the complete suite before waiting for scans, which may take minutes.
    // The subsequent registry gate verifies visibility, bytes and installed consumers.
    verify: async pkg => {
      const accepted = await registryVersion(cfg.registry, pkg.name, pkg.version);
      if (accepted) publicationDecision(pkg, accepted);
    },
    save: receipt => writeJson(resolve(root, 'dist/release/publish-receipt.json'), receipt),
  });
}
if (isMain(import.meta.url)) {
  assert.ok(process.argv.slice(2).every(arg => ['--execute', '--bootstrap'].includes(arg)), 'Unknown publication option');
  assert.ok(!process.argv.includes('--bootstrap') || process.argv.includes('--execute'), '--bootstrap requires --execute');
  await publish(ROOT, { execute: process.argv.includes('--execute'), bootstrap: process.argv.includes('--bootstrap') });
}
