/**
 * Authority, and the single vocabulary that expresses it.
 *
 * The last test is a grep, deliberately: the order's whole safety argument
 * rests on there being ONE refusal vocabulary, ONE identity helper and ONE
 * transition table. A second copy of any of them would not fail a
 * behavioural test — it would just quietly become the version some caller
 * used — so the count is asserted directly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { assertAuthority, checkPrincipal, AUTOMATION_PRINCIPAL, EVOLVE_ACTIONS } from '@tangleai/evolve';

const SRC = 'packages/evolve/src';

async function sources(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await sources(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.gen.ts')) found.push(path);
  }
  return found;
}

describe('evolve authority', () => {
  it('lets the automation principal propose and execute, and never approve', () => {
    assert.equal(assertAuthority(AUTOMATION_PRINCIPAL, 'propose').ok, true);
    assert.equal(assertAuthority(AUTOMATION_PRINCIPAL, 'execute').ok, true);

    const refused = assertAuthority(AUTOMATION_PRINCIPAL, 'approve');
    assert.equal(refused.ok, false, 'approval is a person’s');
    const issue = (refused as { issues: Array<{ code: string, path: string }> }).issues[0];
    assert.equal(issue.code, 'TEVO1010');
    assert.equal(issue.path, '/approve', 'the pointer names the capability that was missing');
  });

  it('has exactly three actions, and merge is not among them', () => {
    assert.deepEqual([...EVOLVE_ACTIONS], ['propose', 'execute', 'approve']);
    assert.equal(EVOLVE_ACTIONS.includes('merge' as never), false);
  });

  it('refuses a malformed principal before asking what it holds', () => {
    const refused = assertAuthority({ id: 'x' } as never, 'propose');
    assert.equal(refused.ok, false);
    assert.equal((refused as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1001');

    assert.equal(checkPrincipal({ ...AUTOMATION_PRINCIPAL, merge: true }).ok, false);
  });

  it('holds one refusal vocabulary, one identity helper and one transition table', async () => {
    const files = await sources(SRC);
    const bodies = await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')] as const));

    const declares = (needle: string) => bodies.filter(([, body]) => body.includes(needle)).map(([file]) => file);

    assert.deepEqual(declares('export const EVOLVE_CODES'), [join(SRC, 'errors.ts')]);
    assert.deepEqual(declares('export const evolveRevision'), [join(SRC, 'identity.ts')]);
    assert.deepEqual(declares('const EXPERIMENT_TRANSITIONS'), [join(SRC, 'transitions.ts')]);
    assert.deepEqual(declares('export function planExperimentTransition'), [join(SRC, 'transitions.ts')]);

    // One place computes a content address, and it is the suite's.
    const hashing = bodies.filter(([, body]) => body.includes('canonicalSha256')).map(([file]) => file);
    assert.deepEqual(hashing, [join(SRC, 'identity.ts')], 'nothing else may invent an address');
  });
});
