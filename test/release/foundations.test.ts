import { it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { readFoundationArtifacts, verifyFoundationArtifacts, artifactSpecifier, type FoundationArtifacts } from '../../scripts/jaren-artifacts.ts';
import { publish } from '../../scripts/release/publish.ts';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function fixture(t: TestContext) {
  const root = mkdtempSync(resolve(tmpdir(), 'foundation-receipt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const patch = 'reviewed source patch\n', tarball = 'immutable archive', module = 'export const value = 1;\n';
  mkdirSync(resolve(root, 'docs/migrations/jaren-ai'), { recursive: true });
  mkdirSync(resolve(root, 'dist/jaren'), { recursive: true });
  mkdirSync(resolve(root, 'node_modules/@jarenjs/core/src'), { recursive: true });
  writeFileSync(resolve(root, 'docs/migrations/jaren-ai/foundations.patch'), patch);
  writeFileSync(resolve(root, 'dist/jaren/jarenjs-core-0.83.3.tgz'), tarball);
  writeFileSync(resolve(root, 'node_modules/@jarenjs/core/src/index.js'), module);
  const packageJson = JSON.stringify({ name: '@jarenjs/core', version: '0.83.3' });
  writeFileSync(resolve(root, 'node_modules/@jarenjs/core/package.json'), packageJson);
  const manifest: FoundationArtifacts = { schemaVersion: 1, mode: 'candidate-artifacts', legacyAiAllowed: false,
    source: { commit: 'a'.repeat(40), version: '0.83.3', node: '24.20.0', npm: '11.12.1', patchSha256: hash(patch), state: 'uncommitted candidate' },
    packages: [{ name: '@jarenjs/core', version: '0.83.3', directory: 'packages/core', filename: 'jarenjs-core-0.83.3.tgz', sha256: hash(tarball),
      integrity: 'sha512-' + createHash('sha512').update(tarball).digest('base64'), edges: {}, files: { 'src/index.js': hash(module), 'package.json': hash(packageJson) } }] };
  writeFileSync(resolve(root, 'docs/migrations/jaren-ai/foundations.json'), JSON.stringify(manifest));
  return { root, manifest };
}
it('checks immutable archive and installed bytes without repairing either', t => {
  const { root, manifest } = fixture(t);
  assert.deepEqual(verifyFoundationArtifacts(root, true), manifest);
  assert.equal(artifactSpecifier(manifest.packages[0]!), 'file:dist/jaren/jarenjs-core-0.83.3.tgz');
  const module = resolve(root, 'node_modules/@jarenjs/core/src/index.js');
  writeFileSync(module, 'changed');
  assert.throws(() => verifyFoundationArtifacts(root, true), /installed bytes differ/);
  assert.equal(readFileSync(module, 'utf8'), 'changed');
});
it('refuses a missing or changed tarball, a changed source patch and an empty closure', t => {
  const { root, manifest } = fixture(t);
  const archive = resolve(root, 'dist/jaren/jarenjs-core-0.83.3.tgz');
  rmSync(archive);
  assert.throws(() => verifyFoundationArtifacts(root), /missing tarball/);
  writeFileSync(archive, 'different');
  assert.throws(() => verifyFoundationArtifacts(root), /SHA-256 mismatch/);
  writeFileSync(resolve(root, 'docs/migrations/jaren-ai/foundations.patch'), 'different');
  assert.throws(() => readFoundationArtifacts(root), /source patch changed/);
  manifest.source.patchSha256 = hash('different'); manifest.packages = [];
  writeFileSync(resolve(root, 'docs/migrations/jaren-ai/foundations.json'), JSON.stringify(manifest));
  assert.throws(() => readFoundationArtifacts(root), /empty foundation closure/);
});
it('publication refuses candidate-only foundations before any registry or release operation', async t => {
  const { root } = fixture(t);
  await assert.rejects(publish(root), /Candidate foundations.*registry cutover/);
});
