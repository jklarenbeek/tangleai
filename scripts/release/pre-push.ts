/** Git supplies the exact refs being pushed on stdin. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ROOT, git, assertClean, isMain } from './common.ts';
import { checkRelease } from './check.ts';
import { assertVerifiedGate } from './verify.ts';
import { pushPolicy } from './push-policy.ts';

export function checkPush(root: string, input: string) {
  assertClean(root);
  for (const line of input.trim().split('\n').filter(Boolean)) {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
    if (/^0+$/.test(localSha)) continue;
    const head = git(root, 'rev-parse', 'HEAD');
    assert.equal(git(root, 'rev-parse', `${localSha}^{commit}`), head, 'Only the current verified commit may be pushed through closeout');
    if (remoteRef.startsWith('refs/tags/')) {
      assertVerifiedGate(root);
      const record = checkRelease(root)!;
      assert.equal(remoteRef, `refs/tags/v${record.version}`);
      assert.equal(git(root, 'cat-file', '-t', localRef), 'tag', 'Release tags must be annotated');
      git(root, 'merge-base', '--is-ancestor', head, 'origin/main');
    } else {
      const { base, documentationOnly } = pushPolicy(root, remoteRef, remoteSha, head);
      if (documentationOnly) {
        console.log(`Documentation-only push to ${remoteRef}: release gate not required.`);
        continue;
      }
      assertVerifiedGate(root);
      checkRelease(root, { base });
    }
  }
}
if (isMain(import.meta.url)) checkPush(ROOT, readFileSync(0, 'utf8'));
