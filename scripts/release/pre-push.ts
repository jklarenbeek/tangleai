/** Git supplies the exact refs being pushed on stdin. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT, git, assertClean } from './common.ts';
import { checkRelease } from './check.ts';
import { assertVerifiedGate } from './verify.ts';

assertClean();
for (const line of readFileSync(0, 'utf8').trim().split('\n').filter(Boolean)) {
  const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
  if (/^0+$/.test(localSha)) continue;
  assertVerifiedGate();
  const head = git(ROOT, 'rev-parse', 'HEAD');
  assert.equal(git(ROOT, 'rev-parse', `${localSha}^{commit}`), head, 'Only the current verified commit may be pushed through closeout');
  if (remoteRef.startsWith('refs/tags/')) {
    const record = checkRelease()!;
    assert.equal(remoteRef, `refs/tags/v${record.version}`);
    assert.equal(git(ROOT, 'cat-file', '-t', localRef), 'tag', 'Release tags must be annotated');
    git(ROOT, 'merge-base', '--is-ancestor', head, 'origin/main');
  } else {
    let base = remoteSha;
    if (/^0+$/.test(base) || remoteRef !== 'refs/heads/main') base = git(ROOT, 'rev-parse', 'origin/main');
    checkRelease(ROOT, { base });
  }
}
