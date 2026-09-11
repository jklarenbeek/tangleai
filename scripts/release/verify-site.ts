/** A deployment is complete only when its live identity matches the release. */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, git, validateManifests, isMain } from './common.ts';

export function verifyBuildIdentity(actual: unknown, expected: { version: string; commit: string; packages: Record<string, string>; dependencySources: { tangle: string; jarenjs: string } }) {
  assert.deepEqual(actual, expected, 'Live website does not identify the complete expected release');
}
export async function verifySite(url: string, root = ROOT) {
  const { main, names } = validateManifests(root);
  const expected = { version: main.version, commit: git(root, 'rev-parse', 'HEAD'), packages: Object.fromEntries(names.map(name => [name, main.version])), dependencySources: { tangle: 'workspace', jarenjs: 'npm' } };
  const base = new URL(url.endsWith('/') ? url : url + '/');
  assert.ok(['https:', 'http:'].includes(base.protocol));
  let failure: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const buildUrl = new URL('build.json', base);
      buildUrl.searchParams.set('release', expected.commit);
      const response = await fetch(buildUrl, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      assert.ok(response.ok, `Live build metadata HTTP ${response.status}`);
      verifyBuildIdentity(await response.json(), expected);
      for (const path of ['', 'app.js', 'styles.css', 'vendor.css']) {
        const asset = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000) });
        assert.ok(asset.ok, `${path || 'index'}: HTTP ${asset.status}`);
        assert.ok((await asset.arrayBuffer()).byteLength > 0, `${path || 'index'} is empty`);
      }
      console.log(`Verified live Tangle ${expected.version} at ${base.href}`);
      return;
    } catch (error) { failure = error; if (attempt < 11) await delay(2500); }
  }
  throw failure;
}
if (isMain(import.meta.url)) {
  assert.equal(process.argv.length, 3, 'Use release:verify-site -- https://jklarenbeek.github.io/tangleai/');
  await verifySite(process.argv[2]);
}
