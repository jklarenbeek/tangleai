/** Bind the complete gate to its tested artifacts so closeout can reuse it. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, readJson, writeJson, sha256, npm, isMain } from './common.ts';
import { checkRelease } from './check.ts';
import { buildPackages } from './build.ts';
import { readArtifacts, testConsumers } from './consumers.ts';

export function assertVerifiedGate(root = ROOT) {
  const artifacts = readArtifacts(root);
  const gate = readJson<any>(resolve(root, 'dist/release/gate.json'));
  assert.equal(gate.schemaVersion, 1);
  assert.equal(gate.version, artifacts.version);
  assert.equal(gate.inputHash, artifacts.inputHash, 'The complete gate belongs to different source inputs');
  assert.equal(gate.artifactsHash, sha256(readFileSync(resolve(root, 'dist/release/artifacts.json'))), 'The complete gate did not verify these artifacts');
  assert.equal(gate.verificationHash, sha256(readFileSync(resolve(root, 'dist/release/verification.json'))));
  assert.equal(gate.node, 'v' + readFileSync(resolve(root, '.nvmrc'), 'utf8').trim());
  assert.equal(gate.npm, readJson(resolve(root, 'package.json')).packageManager);
}
export async function verifyRelease(root = ROOT) {
  assert.equal(process.versions.node, readFileSync(resolve(root, '.nvmrc'), 'utf8').trim(), 'Run the complete release gate on the pinned Node version');
  const record = checkRelease(root)!;
  npm(['run', 'check'], { root });
  assert.equal(checkRelease(root)!.inputHash, record.inputHash, 'Release inputs changed while the source gate was running');
  await buildPackages(root);
  await testConsumers(root);
  npm(['run', 'pages:build'], { root });
  assert.equal(checkRelease(root)!.inputHash, record.inputHash, 'Release inputs changed while the consumer gate was running');
  writeJson(resolve(root, 'dist/release/gate.json'), {
    schemaVersion: 1, version: record.version, inputHash: record.inputHash, node: process.version,
    npm: readJson(resolve(root, 'package.json')).packageManager,
    artifactsHash: sha256(readFileSync(resolve(root, 'dist/release/artifacts.json'))),
    verificationHash: sha256(readFileSync(resolve(root, 'dist/release/verification.json'))),
  });
  assertVerifiedGate(root);
  console.log(`Complete release gate recorded for ${record.version}.`);
}
if (isMain(import.meta.url)) await verifyRelease();
