/**
 * The proposal shape, probed for what it refuses to express.
 *
 * `move` and `copy` are the interesting absences. A rename written as a
 * `move` is one opaque operation, and every rename detection in this
 * campaign reads adds against removes — so allowing `move` would create a
 * spelling of "rename a test file" that the policy is structurally blind
 * to. `test` is absent because a patch that can assert can branch.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadProposal, operationPath, decodePointerSegment, patchBytes, patchIdOf } from '@tangleai/evolve';

const valid = {
  proposalId: 'p1',
  strategyId: 's1',
  rationale: 'narrow the loop',
  evidence: ['experiment/e1'],
  origin: 'hand-authored',
  patch: [{ op: 'replace', path: '/files/src~1rank.js', value: 'export const x = 1;\n' }],
};

const refusedAt = (value: unknown, path?: string) => {
  const result = loadProposal(value);
  assert.equal(result.ok, false, 'should refuse: ' + JSON.stringify(value).slice(0, 120));
  const issue = (result as { issues: Array<{ code: string, path: string }> }).issues[0];
  assert.equal(issue.code, 'TEVO1001');
  if (path !== undefined) assert.equal(issue.path, path);
  return issue;
};

describe('the proposal shape', () => {
  it('accepts a well-formed proposal and decodes its paths', () => {
    const loaded = loadProposal(valid);
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
    const patch = (loaded as { value: { patch: Array<{ path: string }> } }).value.patch;
    assert.equal(operationPath(patch[0] as never), 'src/rank.js');
    assert.equal(decodePointerSegment('test~1rank.test.js'), 'test/rank.test.js');
    assert.equal(decodePointerSegment('a~0b'), 'a~b');
    assert.equal(decodePointerSegment('..~1escape.js'), '../escape.js');
  });

  it('cannot express move, copy or test', () => {
    for (const op of ['move', 'copy', 'test', 'MOVE', '']) {
      refusedAt({ ...valid, patch: [{ op, path: '/files/a.js', value: 'x' }] }, '/patch/0');
    }
  });

  it('cannot address anything outside the file map, or more than one segment', () => {
    for (const path of ['/config/secret', '/files', '/files/', '/files/a/b.js', 'files/a.js', '/FILES/a.js', '']) {
      refusedAt({ ...valid, patch: [{ op: 'replace', path, value: 'x' }] }, '/patch/0');
    }
  });

  it('requires string content on a write and none on a remove', () => {
    for (const value of [1, null, true, {}, ['x'], undefined]) {
      refusedAt({ ...valid, patch: [{ op: 'add', path: '/files/a.js', value }] }, '/patch/0');
    }
    refusedAt({ ...valid, patch: [{ op: 'remove', path: '/files/a.js', value: 'x' }] }, '/patch/0');
    assert.equal(loadProposal({ ...valid, patch: [{ op: 'remove', path: '/files/a.js' }] }).ok, true);
  });

  it('requires evidence, a rationale and a declared origin', () => {
    refusedAt({ ...valid, evidence: [] }, '/evidence');
    refusedAt({ ...valid, evidence: ['' ] }, '/evidence');
    refusedAt({ ...valid, evidence: 'one' }, '/evidence');
    refusedAt({ ...valid, rationale: '' }, '/rationale');
    refusedAt({ ...valid, rationale: 'x'.repeat(2049) }, '/rationale');
    refusedAt({ ...valid, origin: 'anonymous' }, '/origin');
  });

  it('carries no member nobody declared', () => {
    refusedAt({ ...valid, surprise: true }, '/surprise');
    refusedAt({ ...valid, patch: [{ op: 'add', path: '/files/a.js', value: 'x', mode: '100755' }] }, '/patch/0');
  });

  it('refuses a non-object and an empty patch', () => {
    refusedAt(null);
    refusedAt('a proposal');
    refusedAt([valid]);
    refusedAt({ ...valid, patch: [] }, '/patch');
  });

  it('addresses a patch by its operations alone', async () => {
    const first = await patchIdOf(valid.patch as never);
    const second = await patchIdOf([{ ...valid.patch[0] }] as never);
    assert.equal(first, second, 'the same operations hash the same');
    assert.match(first, /^[a-f0-9]{64}$/);

    const other = await patchIdOf([{ op: 'replace', path: '/files/src~1rank.js', value: 'different' }] as never);
    assert.notEqual(first, other);
  });

  it('counts the bytes a patch would write', () => {
    assert.equal(patchBytes([{ op: 'remove', path: '/files/a' }] as never), '/files/a'.length);
    const withValue = patchBytes([{ op: 'add', path: '/files/a', value: 'hello' }] as never);
    assert.equal(withValue, '/files/a'.length + 5);
  });
});
