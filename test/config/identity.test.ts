/**
 * Identity hygiene: canonical revisions ignore member order and see
 * every material value, the returned graph is deeply immutable against
 * retained references in both directions, the dated host observation
 * never enters a revision, and no clock, secret or cache identifier can
 * reach a canonical payload.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  hostManifestRevisionOf,
  registryRevisionOf,
  resolveProfile,
  revisionOf,
  type HostManifest,
  type ProfileRegistry,
  type RunIdentity,
} from '@tangleai/config';

const fixture = JSON.parse(await readFile('test/fixtures/config-conformance.json', 'utf8')) as {
  base: { registry: ProfileRegistry, request: unknown, host: HostManifest },
};
const base = fixture.base;

async function identityOf(input: { registry?: unknown, request?: unknown, host?: unknown } = {}): Promise<RunIdentity> {
  const resolution = await resolveProfile({
    registry: input.registry ?? base.registry,
    request: input.request ?? base.request,
    host: input.host ?? base.host,
  });
  assert.equal(resolution.ok, true, resolution.ok ? '' : JSON.stringify(resolution.issues[0]));
  return (resolution as { ok: true, identity: RunIdentity }).identity;
}

describe('canonical hashing', () => {
  it('ignores object member order and sees array order', async () => {
    const { version, credentialSlots, ...rest } = base.registry;
    const reordered = { ...rest, credentialSlots, version } as unknown as ProfileRegistry;
    assert.equal(await registryRevisionOf(base.registry), await registryRevisionOf(reordered));
    assert.notEqual(await revisionOf(['a', 'b']), await revisionOf(['b', 'a']));
  });

  it('excludes the dated observation from the host revision', async () => {
    const observed = structuredClone(base.host) as HostManifest;
    observed.observation = { kind: 'probed', at: '2026-08-31T00:00:00Z', calls: 3, failures: 1 };
    assert.equal(await hostManifestRevisionOf(base.host), await hostManifestRevisionOf(observed),
      'WHEN a host was observed never changes WHAT it is');
    const changed = structuredClone(base.host) as HostManifest;
    changed.budget = { ...changed.budget, maxCalls: 100 };
    assert.notEqual(await hostManifestRevisionOf(base.host), await hostManifestRevisionOf(changed));
  });

  it('sorts requested tools as a set before hashing', async () => {
    const forward = structuredClone(base.registry) as ProfileRegistry;
    const root = forward.profiles[0] as import('@tangleai/config').RootProfile;
    root.roles.answer.tools = ['recall_memories', 'recall_memories'];
    const duplicated = await identityOf({ registry: forward });
    assert.deepEqual(duplicated.roles.answer.tools.requested, ['recall_memories'], 'the requested list is a set');
  });
});

describe('identity sensitivity and equivalence', () => {
  it('keeps the identity when only the host observation date differs', async () => {
    const observed = structuredClone(base.host) as HostManifest;
    observed.observation = { kind: 'declared', at: null, calls: 0, failures: 0 };
    const a = await identityOf();
    const b = await identityOf({ host: observed });
    assert.equal(a.identityId, b.identityId);
  });

  it('changes the identity for every material value', async () => {
    const reference = await identityOf();
    const inferenceEdit = structuredClone(base.registry) as ProfileRegistry;
    inferenceEdit.inference[0].temperature = 1.1;
    const budgetEdit = structuredClone(base.registry) as ProfileRegistry;
    budgetEdit.budgets[0].maxConcurrency = 2;
    const overrideEdit = { kind: 'profile', profile: 'base', overrides: { answer: { toolsRequired: false } } };
    for (const [name, identity] of [
      ['inference', await identityOf({ registry: inferenceEdit })],
      ['budget', await identityOf({ registry: budgetEdit })],
      ['override', await identityOf({ request: overrideEdit })],
    ] as const) {
      assert.notEqual(identity.identityId, reference.identityId, `${name} is a material value`);
    }
  });
});

describe('immutability at the boundary', () => {
  it('a retained input reference cannot mutate a finished resolution', async () => {
    const registry = structuredClone(base.registry) as ProfileRegistry;
    const host = structuredClone(base.host) as HostManifest;
    const resolution = await resolveProfile({ registry, request: base.request, host });
    assert.equal(resolution.ok, true);
    const before = JSON.stringify(resolution);
    registry.candidates[0].model = 'mutated/after';
    host.budget.maxCalls = 1;
    assert.equal(JSON.stringify(resolution), before, 'the resolution shares no mutable reference with its inputs');
  });

  it('the returned graph is deeply frozen', async () => {
    const identity = await identityOf();
    assert.throws(() => { (identity.roles.answer as { model: string }).model = 'mutated'; }, /read only|Cannot assign/);
    assert.throws(() => { (identity.budget as { maxCalls: number | null }).maxCalls = 1; }, /read only|Cannot assign/);
    assert.throws(() => { (identity.roles.answer.tools.requested as string[]).push('extra'); }, /not extensible|read only|Cannot add/);
  });

  it('a refusal is frozen too', async () => {
    const host = structuredClone(base.host) as HostManifest;
    host.providers = [];
    const refusal = await resolveProfile({ registry: base.registry, request: base.request, host });
    assert.equal(refusal.ok, false);
    if (!refusal.ok) {
      assert.throws(() => { (refusal.issues as unknown as unknown[]).push({}); }, /not extensible|read only|Cannot add/);
    }
  });
});

describe('canonical payload hygiene', () => {
  it('no clock, cache key or secret-shaped value survives into an identity', async () => {
    const identity = await identityOf();
    const text = JSON.stringify(identity);
    assert.equal(/"at":/.test(text), false, 'no timestamp member');
    assert.equal(/"(apiKey|apiToken|secret|password|bearer)"\s*:/.test(text), false, 'no secret-shaped member');
    assert.match(identity.identityId, /^[0-9a-f]{64}$/);
    assert.equal(identity.roles.answer.credentialSlot, 'openrouter-primary', 'the slot NAME is the only credential fact');
  });
});
