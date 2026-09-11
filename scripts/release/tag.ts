/** Tags are created only after the accepted release commit passes its gates. */
import assert from 'node:assert/strict';
import { ROOT, git, assertClean } from './common.ts';
import { checkRelease } from './check.ts';

assertClean();
const record = checkRelease()!;
const tag = `v${record.version}`;
const head = git(ROOT, 'rev-parse', 'HEAD');
let existing: string | undefined;
try { existing = git(ROOT, 'rev-parse', '--verify', `refs/tags/${tag}^{commit}`); } catch { /* A new tag is expected. */ }
if (existing) {
  assert.equal(existing, head, 'An existing release tag identifies a different commit');
  assert.equal(git(ROOT, 'cat-file', '-t', `refs/tags/${tag}`), 'tag', 'Release tags must be annotated');
} else git(ROOT, '-c', 'user.name=Joham', '-c', 'user.email=jklarenbeek@gmail.com', 'tag', '-a', tag, '-m', `Tangle ${record.version}`);
console.log(tag);
