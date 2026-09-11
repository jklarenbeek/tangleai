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
assert.equal(git(ROOT, 'branch', '--show-current'), 'main', 'Closeout commits and pushes directly from main');
if (args.includes('--push')) {
  git(ROOT, 'fetch', 'origin', 'main');
  git(ROOT, 'merge-base', '--is-ancestor', 'origin/main', 'HEAD');
}
await prepare();
let verified = false;
try { assertVerifiedGate(); verified = true; } catch { /* The current tree still needs its full gate. */ }
if (!verified) await verifyRelease();
else console.log('Reusing the complete gate for the unchanged release inputs and tarballs.');
git(ROOT, 'diff', '--check');
assert.equal(readFileSync(resolve(ROOT, 'apps/desktop/src/assets.gen.ts'), 'utf8').trim(), git(ROOT, 'show', 'HEAD:apps/desktop/src/assets.gen.ts'), 'Restore the desktop asset stub before committing');
const record = checkRelease()!;
if (args.includes('--push')) checkRelease(ROOT, { base: git(ROOT, 'rev-parse', 'origin/main') });
git(ROOT, 'add', '--all');
git(ROOT, 'diff', '--cached', '--check');
execFileSync('git', ['-c', 'user.name=Joham', '-c', 'user.email=jklarenbeek@gmail.com', 'commit', '-m', message], { cwd: ROOT, stdio: 'inherit' });
assertClean();
checkRelease();
if (args.includes('--push')) execFileSync('git', ['push', 'origin', 'main'], { cwd: ROOT, stdio: 'inherit' });
console.log(`Closed out ${record.version} on main. After a push, release CI gates tagging and npm publication; Pages deploys independently after those same checks.`);
