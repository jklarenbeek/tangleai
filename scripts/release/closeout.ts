/** Closeout prepares and verifies a release before committing or pushing it. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, git, assertClean } from './common.ts';
import { prepare } from './prepare.ts';
import { checkRelease } from './check.ts';
import { assertVerifiedGate, verifyRelease } from './verify.ts';

const args = process.argv.slice(2);
const messageIndex = args.indexOf('--message');
assert.ok(messageIndex >= 0 && args[messageIndex + 1], 'Use release:closeout -- --message "Short present-tense message" [--push]');
assert.ok(args.every((arg, index) => ['--message', '--push'].includes(arg) || index === messageIndex + 1), 'Unknown closeout option');
const message = args[messageIndex + 1];
assert.ok(message.length <= 72 && !/[\r\n\0]/.test(message) && !/\d+\.\d+\.\d+/.test(message), 'Use one short commit message; versions belong in tags');
await prepare();
let verified = false;
try { assertVerifiedGate(); verified = true; } catch { /* The current tree still needs its full gate. */ }
if (!verified) await verifyRelease();
else console.log('Reusing the complete gate for the unchanged release inputs and tarballs.');
git(ROOT, 'diff', '--check');
assert.equal(readFileSync(resolve(ROOT, 'apps/desktop/src/assets.gen.ts'), 'utf8').trim(), git(ROOT, 'show', 'HEAD:apps/desktop/src/assets.gen.ts'), 'Restore the desktop asset stub before committing');
const record = checkRelease()!;
let branch = git(ROOT, 'branch', '--show-current');
assert.ok(branch, 'Closeout requires a branch');
if (branch === 'main') {
  branch = `release/v${record.version}`;
  git(ROOT, 'switch', '-c', branch);
}
git(ROOT, 'add', '--all');
git(ROOT, 'diff', '--cached', '--check');
execFileSync('git', ['-c', 'user.name=Joham', '-c', 'user.email=jklarenbeek@gmail.com', 'commit', '-m', message], { cwd: ROOT, stdio: 'inherit' });
assertClean();
checkRelease();
if (args.includes('--push')) execFileSync('git', ['push', '--set-upstream', 'origin', branch], { cwd: ROOT, stdio: 'inherit' });
console.log(`Closed out ${record.version} on ${branch}. Merge its checked pull request; the main release workflow tags, publishes, verifies and deploys that commit.`);
