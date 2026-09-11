/** Public registry verification never sends account credentials. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, config, writeJson, isMain } from './common.ts';
import { readArtifacts, testConsumers } from './consumers.ts';
import type { Artifact } from './build.ts';

export interface RegistryVersion { name: string; version: string; dist: { integrity?: string }; exports?: Artifact['exports']; }
export async function registryVersion(registry: string, name: string, version: string): Promise<RegistryVersion | null> {
  const url = new URL(`${encodeURIComponent(name)}/${encodeURIComponent(version)}`, registry);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } });
      if (response.status === 404) return null;
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await delay(1000 * (attempt + 1)); continue; }
      assert.ok(response.ok, `${name}@${version}: registry HTTP ${response.status}`);
      return await response.json() as RegistryVersion;
    } catch (error) {
      if (attempt === 2 || (error instanceof assert.AssertionError)) throw error;
      await delay(1000 * (attempt + 1));
    }
  }
  throw new Error(`Registry retries exhausted for ${name}@${version}`);
}
export function publicationDecision(artifact: Artifact, existing: RegistryVersion | null) {
  if (existing === null) return 'publish' as const;
  assert.equal(existing.name, artifact.name);
  assert.equal(existing.version, artifact.version);
  assert.equal(existing.dist.integrity, artifact.integrity, `${artifact.name}@${artifact.version}: an immutable version exists with different bytes`);
  assert.deepEqual(existing.exports, artifact.exports, `${artifact.name}: registry exports differ`);
  return 'present' as const;
}
export async function waitForVersion(registry: string, pkg: Artifact) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const found = await registryVersion(registry, pkg.name, pkg.version);
    if (found) { publicationDecision(pkg, found); return found; }
    if (attempt < 11) await delay(2500);
  }
  throw new Error(`${pkg.name}@${pkg.version} did not become visible within the registry verification window`);
}
export async function verifyRegistry(root = ROOT) {
  const artifacts = readArtifacts(root);
  const cfg = config(root);
  for (const pkg of artifacts.packages) {
    await waitForVersion(cfg.registry, pkg);
    const latest = await registryVersion(cfg.registry, pkg.name, 'latest');
    assert.ok(latest, `${pkg.name}: latest is missing`);
    publicationDecision(pkg, latest);
  }
  const consumers = await testConsumers(root, { registry: true });
  const receipt = { schemaVersion: 1, version: artifacts.version, commit: artifacts.commit,
    inputHash: artifacts.inputHash, complete: true, packages: artifacts.packages.map(({ name, version, integrity }) => ({ name, version, integrity })), consumers };
  writeJson(resolve(root, 'dist/release/registry-verification.json'), receipt);
  return receipt;
}
if (isMain(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'Registry verification takes no arguments');
  await verifyRegistry();
}
