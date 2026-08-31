/**
 * Single-parent RFC 7396 inheritance: the suite's merge patch is the
 * only merge, a null member deletes an optional field, the merged
 * result is validated as a registry again so a patch cannot smuggle a
 * ghost reference in, and cycles/missing parents are stable issues
 * rather than stack overflows.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { resolveProfiles, validateRegistry, type ProfileRegistry } from '@tangleai/config';

const fixture = JSON.parse(await readFile('test/fixtures/config-conformance.json', 'utf8')) as {
  base: { registry: ProfileRegistry },
};

function registryWith(mutate: (d: any) => void): ProfileRegistry {
  const copy = structuredClone(fixture.base.registry) as any;
  mutate(copy);
  const outcome = validateRegistry(copy);
  assert.equal(outcome.ok, true, 'the mutated registry must still validate structurally');
  return (outcome as { ok: true, value: ProfileRegistry }).value;
}

describe('profile inheritance', () => {
  it('applies a merge patch over the resolved parent', () => {
    const registry = registryWith((d) => {
      d.profiles[1].patch = {
        description: 'patched child',
        roles: { answer: { capability: null, candidate: 'chat-beta' } },
        budget: null,
      };
    });
    const outcome = resolveProfiles(registry);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      const child = outcome.value.get('child');
      assert.equal(child?.description, 'patched child');
      assert.equal(child?.roles.answer.candidate, 'chat-beta');
      assert.equal(child?.roles.answer.capability, null);
      assert.equal(child?.roles.answer.prompt, 'grounded-answer', 'unpatched role members inherit');
      assert.equal(child?.budget, null, 'a null member overwrites the optional field');
      assert.equal(child?.embedding, 'embed-hash', 'unpatched members inherit');
      const parent = outcome.value.get('base');
      assert.equal(parent?.description, 'fixture root profile', 'the parent is untouched');
    }
  });

  it('resolves a grandchild through its whole ancestry', () => {
    const registry = registryWith((d) => {
      d.profiles.push({ id: 'grandchild', kind: 'child', extends: 'child', patch: { description: 'third generation' } });
      d.profiles[1].patch = { description: 'second generation' };
    });
    const outcome = resolveProfiles(registry);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.value.get('grandchild')?.description, 'third generation');
      assert.equal(outcome.value.get('grandchild')?.embedding, 'embed-hash');
      assert.equal(outcome.value.get('child')?.description, 'second generation');
    }
  });

  it('refuses a cycle as TCFG1003, never a stack overflow', () => {
    const registry = registryWith((d) => {
      d.profiles.push({ id: 'other', kind: 'child', extends: 'child', patch: {} });
      d.profiles[1] = { id: 'child', kind: 'child', extends: 'other', patch: {} };
    });
    const outcome = resolveProfiles(registry);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.issues.some((issue) => issue.code === 'TCFG1003'), true);
    const self = registryWith((d) => {
      d.profiles[1] = { id: 'child', kind: 'child', extends: 'child', patch: {} };
    });
    const selfOutcome = resolveProfiles(self);
    assert.equal(selfOutcome.ok, false);
    if (!selfOutcome.ok) assert.equal(selfOutcome.issues.some((issue) => issue.code === 'TCFG1003'), true);
  });

  it('validates the merged document again, so a patch cannot smuggle a ghost', () => {
    const ghostReference = registryWith((d) => {
      d.profiles[1].patch = { roles: { answer: { prompt: 'ghost' } } };
    });
    const outcome = resolveProfiles(ghostReference);
    assert.equal(outcome.ok, false, 'a merged profile with a ghost prompt refuses');
    if (!outcome.ok) assert.equal(outcome.issues.some((issue) => issue.code === 'TCFG1005'), true);

    const undeclaredMember = registryWith((d) => {
      d.profiles[1].patch = { apiKey: 'sk-x' };
    });
    const secret = resolveProfiles(undeclaredMember);
    assert.equal(secret.ok, false, 'a patch cannot introduce an undeclared member');
    if (!secret.ok) assert.equal(secret.issues.some((issue) => issue.code === 'TCFG1014'), true);

    const invalidFinal = registryWith((d) => {
      d.profiles[1].patch = { roles: { answer: { candidate: 'chat-beta' } } };
    });
    const both = resolveProfiles(invalidFinal);
    assert.equal(both.ok, false, 'a merged role with both capability and candidate refuses');
  });

  it('returns deeply frozen resolved profiles', () => {
    const outcome = resolveProfiles(fixture.base.registry);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      const child = outcome.value.get('child');
      assert.throws(() => { (child as { description: string }).description = 'mutated'; }, /read only|Cannot assign/);
    }
  });
});
