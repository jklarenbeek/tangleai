import assert from 'node:assert/strict';
import { chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, git } from './common.ts';

let existing = '';
try { existing = git(ROOT, 'config', '--local', '--get', 'core.hooksPath'); } catch { /* Unset is normal. */ }
assert.ok(!existing || existing === '.githooks', `Preserve the existing hook configuration ${existing}; integrate the release hook explicitly`);
if (!existing) assert.ok(!existsSync(resolve(ROOT, git(ROOT, 'rev-parse', '--git-path', 'hooks/pre-push'))), 'An existing pre-push hook needs explicit integration');
chmodSync(resolve(ROOT, '.githooks/pre-push'), 0o755);
git(ROOT, 'config', '--local', 'core.hooksPath', '.githooks');
console.log('Installed the version and complete-gate pre-push hook. CI independently gates publication and deployment after the main push.');
