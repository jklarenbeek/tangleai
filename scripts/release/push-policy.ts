/** Branch-only exception; publication fingerprints still cover the whole tree. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { ROOT, git, isMain } from './common.ts';
import { checkRelease } from './check.ts';

function documentationPath(path: string) {
  return path === 'README.md' || /^docs\/.+\.md$/s.test(path)
    || /^docs\/refs\/.+\.pdf$/s.test(path)
    || /^docs\/.+\.(?:png|jpe?g|gif|webp)$/s.test(path);
}

export function isDocumentationOnly(root: string, base: string, head: string) {
  if (![base, head].every(ref => /^[a-f0-9]{40}$/.test(ref))) return false;
  try {
    git(root, 'merge-base', '--is-ancestor', base, head);
    // Disable rename detection so both sides must qualify, and use raw modes
    // to reject symlinks, executable files and submodules even with doc names.
    const entries = execFileSync('git', ['diff', '--raw', '-z', '--no-renames', '--no-ext-diff', '--no-abbrev', base, head, '--'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0');
    entries.pop();
    if (!entries.length || entries.length % 2) return false;
    for (let i = 0; i < entries.length; i += 2) {
      const modes = /^:(000000|100644) (000000|100644) [a-f0-9]{40} [a-f0-9]{40} [AMD]$/.test(entries[i]);
      if (!modes || !documentationPath(entries[i + 1])) return false;
    }
    return true;
  } catch { return false; } // Missing history must never grant an exception.
}

/** Existing topic branches still compare their entire change against main. */
export function pushBase(root: string, remoteRef: string, remoteSha: string) {
  return remoteRef === 'refs/heads/main' && /^[a-f0-9]{40}$/.test(remoteSha) && !/^0+$/.test(remoteSha)
    ? remoteSha : git(root, 'rev-parse', 'origin/main');
}

export function pushPolicy(root: string, remoteRef: string, remoteSha: string, head: string) {
  const base = pushBase(root, remoteRef, remoteSha);
  let documentationOnly = remoteRef.startsWith('refs/heads/') && /^[a-f0-9]{40}$/.test(remoteSha)
    && isDocumentationOnly(root, base, head);
  if (documentationOnly && !/^0+$/.test(remoteSha) && remoteSha !== base) {
    // A topic branch must also preserve its own remote history, even though
    // its release comparison includes all changes since main.
    try { git(root, 'merge-base', '--is-ancestor', remoteSha, head); }
    catch { documentationOnly = false; }
  }
  return { base, documentationOnly };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 4 && args[0] === '--ref' && args[2] === '--base', 'Use --ref <branch ref> --base <previous SHA>');
  assert.ok(args[1].startsWith('refs/heads/'), 'Documentation exceptions apply only to branches');
  const head = git(ROOT, 'rev-parse', 'HEAD');
  const { base, documentationOnly } = pushPolicy(ROOT, args[1], args[3], head);
  if (documentationOnly) console.log('Documentation-only branch push: no version bump or release receipt required.');
  else checkRelease(ROOT, { base: base === head ? git(ROOT, 'rev-parse', 'HEAD^') : base });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `documentation-only=${documentationOnly}\n`);
}
