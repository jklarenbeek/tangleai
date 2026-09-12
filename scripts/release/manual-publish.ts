/** The author publishes a committed release using their local npm credentials. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, assertClean, git, isMain, npmCommand } from './common.ts';
import { checkRelease } from './check.ts';
import { readArtifacts } from './consumers.ts';
import { assertVerifiedGate, verifyRelease } from './verify.ts';
import { publish } from './publish.ts';
import { tagRelease } from './tag.ts';
import { verifyRegistry } from './registry.ts';
import type { Artifacts } from './build.ts';

interface ManualPublishIO {
  assertGate(root: string): void;
  artifacts(root: string): Artifacts;
  verify(root: string): Promise<unknown>;
  publish(root: string, options?: { execute?: boolean }): Promise<unknown>;
  tag(root: string): unknown;
  registry(root: string): Promise<unknown>;
}
export async function manualPublish(root = ROOT, options: { dryRun?: boolean } = {}, io: ManualPublishIO = {
  assertGate: assertVerifiedGate, artifacts: readArtifacts, verify: verifyRelease,
  publish, tag: tagRelease, registry: verifyRegistry,
}) {
  assert.notEqual(process.env.GITHUB_ACTIONS, 'true', 'Run npm run publish locally as the author');
  assertClean(root);
  npmCommand(root);
  assert.equal(process.versions.node, readFileSync(resolve(root, '.nvmrc'), 'utf8').trim(), 'Use the Node version in .nvmrc');
  const record = checkRelease(root)!;
  const head = git(root, 'rev-parse', 'HEAD');
  console.log(`Checking ${record.version} at ${head}${options.dryRun ? ' (dry run; no tag or upload)' : ''}.`);
  let verified = false;
  try { io.assertGate(root); verified = io.artifacts(root).commit === head; } catch { /* Rebuild stale or missing evidence. */ }
  if (!verified) await io.verify(root);
  io.assertGate(root);
  assert.equal(io.artifacts(root).commit, head, 'Verify artifacts at the final committed revision');
  assert.equal(git(root, 'rev-parse', 'HEAD'), head, 'The release commit changed during verification');
  assertClean(root);
  await io.publish(root); // Preflight every immutable registry version before tagging.
  if (options.dryRun) return;
  io.tag(root);
  await io.publish(root, { execute: true });
  await io.registry(root);
  console.log(`Published and verified ${record.version}. Git pushes and Pages deployment are separate.`);
}
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--dry-run'), 'Use npm run publish [-- --dry-run]');
  await manualPublish(ROOT, { dryRun: args.includes('--dry-run') });
}
