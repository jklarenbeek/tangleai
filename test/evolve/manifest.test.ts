/**
 * The executor manifest, pinned, and the root import kept browser-safe.
 *
 * The manifest is what a consumer matches an injected executor against,
 * so its bytes are a contract: renaming a capability has to show up as a
 * failing assertion here rather than at someone else's call site.
 *
 * The second test is the one that keeps the package honest about its own
 * boundary. Every module reachable from the root is walked, and a single
 * `node:` import anywhere in that closure fails — a claim that the root is
 * browser-safe is worth nothing if it is only checked by remembering to.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { EVOLVE_EXECUTOR_MANIFEST, EVOLVE_CODES } from '@tangleai/evolve';

const ROOT = 'packages/evolve/src/index.ts';

/** Every relative module reachable from an entry, following imports. */
async function closure(entry: string): Promise<Map<string, string>> {
  const seen = new Map<string, string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const source = await readFile(file, 'utf8');
    seen.set(file, source);
    for (const match of source.matchAll(/from\s+'([^']+)'/g)) {
      const target = match[1];
      if (!target.startsWith('.')) continue;
      if (target.endsWith('.json')) continue;
      queue.push(resolve(dirname(file), target));
    }
  }
  return seen;
}

describe('the evolve executor manifest', () => {
  it('pins its bytes, so a rename is a visible contract change', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(EVOLVE_EXECUTOR_MANIFEST)), {
      runner: 'evolve-runner/v1',
      worktree: 'evolve-worktree/v1',
      effects: 'jarenjs-external-effects',
      codes: ['TEVO1001', 'TEVO1002', 'TEVO1003', 'TEVO1004', 'TEVO1005', 'TEVO1006',
        'TEVO1007', 'TEVO1008', 'TEVO1009', 'TEVO1010', 'TEVO1011'],
    });
  });

  it('declares exactly the refusal vocabulary the package implements', () => {
    assert.deepEqual([...EVOLVE_EXECUTOR_MANIFEST.codes], Object.keys(EVOLVE_CODES).sort(),
      'the manifest cannot advertise a code the package does not define');
    assert.equal(Object.keys(EVOLVE_CODES).length, 11);
  });

  it('keeps the root import free of every node builtin', async () => {
    const modules = await closure(ROOT);
    assert.ok(modules.size >= 8, 'the walk actually reached the package');
    const offenders: string[] = [];
    for (const [file, source] of modules) {
      if (/from\s+'node:/.test(source) || /require\('node:/.test(source)) offenders.push(file);
    }
    assert.deepEqual(offenders, [], 'the root import must load in a browser');
  });

  it('reaches every module the root re-exports', async () => {
    const modules = await closure(ROOT);
    const names = [...modules.keys()].map(file => file.split('/').pop());
    for (const expected of ['errors.ts', 'schema.ts', 'identity.ts', 'transitions.ts',
      'authority.ts', 'budgets.ts', 'store.ts', 'strategy.ts', 'manifest.ts']) {
      assert.ok(names.includes(expected), 'the closure missed ' + expected);
    }
  });
});
