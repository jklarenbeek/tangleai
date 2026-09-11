/** Public registry verification never sends account credentials. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, config, writeJson, isMain } from './common.ts';
import { readArtifacts, testConsumers } from './consumers.ts';
import type { Artifact } from './build.ts';

export interface RegistryVersion { name: string; version: string; dist: { integrity?: string }; exports?: Artifact['exports']; }
async function registryDocument(url: URL, label: string, accept = 'application/json'): Promise<any | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept } });
      if (response.status === 404) return null;
      if ((response.status === 429 || response.status >= 500) && attempt < 2) { await delay(1000 * (attempt + 1)); continue; }
      assert.ok(response.ok, `${label}: registry HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 2 || (error instanceof assert.AssertionError)) throw error;
      await delay(1000 * (attempt + 1));
    }
  }
  throw new Error(`Registry retries exhausted for ${label}`);
}
export async function registryVersion(registry: string, name: string, version: string): Promise<RegistryVersion | null> {
  return registryDocument(new URL(`${encodeURIComponent(name)}/${encodeURIComponent(version)}`, registry), `${name}@${version}`);
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
interface PackageIndex {
  name: string;
  versions?: Record<string, RegistryVersion>;
  'dist-tags'?: Record<string, string>;
}
/** npm scanning can expose accepted version metadata before install indexes. */
export async function waitForInstallable(registry: string, packages: Artifact[], options: { timeoutMs?: number; intervalMs?: number } = {}, io = {
  read: (pkg: Artifact, abbreviated: boolean): Promise<PackageIndex | null> => registryDocument(
    new URL(encodeURIComponent(pkg.name), registry), pkg.name,
    abbreviated ? 'application/vnd.npm.install-v1+json' : 'application/json'),
  now: () => Date.now(),
  sleep: async (ms: number) => { await delay(ms); },
  report: (names: string[]) => { console.log(`Waiting for npm package availability: ${names.join(', ')}`); },
}) {
  const deadline = io.now() + (options.timeoutMs ?? 20 * 60_000);
  let pending = packages;
  let attempt = 0;
  while (pending.length) {
    const ready = await Promise.all(pending.map(async pkg => {
      const [full, abbreviated] = await Promise.all([io.read(pkg, false), io.read(pkg, true)]);
      for (const index of [full, abbreviated]) {
        if (!index) continue;
        assert.equal(index.name, pkg.name);
        const version = index.versions?.[pkg.version];
        if (version) {
          assert.equal(version.name, pkg.name);
          assert.equal(version.version, pkg.version);
          assert.equal(version.dist.integrity, pkg.integrity, `${pkg.name}: install index has different bytes`);
        }
      }
      const version = full?.versions?.[pkg.version];
      if (version) publicationDecision(pkg, version);
      return !!version && !!abbreviated?.versions?.[pkg.version]
        && full?.['dist-tags']?.latest === pkg.version && abbreviated?.['dist-tags']?.latest === pkg.version;
    }));
    pending = pending.filter((_, index) => !ready[index]);
    if (!pending.length) return;
    const remaining = deadline - io.now();
    assert.ok(remaining > 0, `npm packages are still unavailable after the verification window: ${pending.map(pkg => pkg.name).join(', ')}. Retry this release after npm scanning or review completes.`);
    if (attempt++ % 4 === 0) io.report(pending.map(pkg => pkg.name));
    await io.sleep(Math.min(options.intervalMs ?? 15_000, remaining));
  }
}
export async function verifyRegistry(root = ROOT) {
  const artifacts = readArtifacts(root);
  const cfg = config(root);
  await waitForInstallable(cfg.registry, artifacts.packages);
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
