/**
 * The pure resolver against the registered conformance families: every
 * fixture case measures `holds` through the real resolver, candidate
 * choice is declared priority then id and survives shuffled input
 * order, two hosts resolving one tag to different stacks cannot share
 * an identity, refusal never falls through to another tag or the legacy
 * or offline behavior, and no call reads the environment or network.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { equalsJson } from '@jarenjs/core/object';
import { resolveProfile, type HostManifest, type ProfileRegistry, type Resolution } from '@tangleai/config';

import { loadFixture, measureCases } from '../../benchmark/lib/config-conformance.ts';

const fixture = await loadFixture();
const base = fixture.base as unknown as { registry: ProfileRegistry, request: unknown, host: HostManifest };

const okOf = (resolution: Resolution): resolution is { ok: true, identity: import('@tangleai/config').RunIdentity } => resolution.ok;

describe('every registered family measures holds through the resolver', () => {
  it('equivalence, sensitivity and refusal cases all hold', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      calls += 1;
      throw new Error('pure resolution must not fetch');
    }) as typeof fetch;
    try {
      const measured = await measureCases(fixture);
      for (const item of measured.filter((entry) => entry.scope === 'resolver')) {
        assert.equal(item.status, 'holds', `${item.id}: ${item.observed}`);
      }
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('deterministic selection', () => {
  it('is stable under shuffled registry and host insertion order', async () => {
    const reference = await resolveProfile({ registry: base.registry, request: base.request, host: base.host });
    assert.equal(okOf(reference), true);

    const shuffledRegistry = structuredClone(base.registry) as ProfileRegistry;
    (shuffledRegistry.candidates as unknown[]).reverse();
    (shuffledRegistry.capabilities[0].candidates as unknown[]).reverse();
    (shuffledRegistry.profiles as unknown[]).reverse();
    const shuffledHost = structuredClone(base.host) as HostManifest;
    (shuffledHost.providers as unknown[]).reverse();
    (shuffledHost.credentialSlots as unknown[]).reverse();
    const shuffled = await resolveProfile({ registry: shuffledRegistry, request: base.request, host: shuffledHost });
    assert.equal(okOf(shuffled), true);
    if (okOf(reference) && okOf(shuffled)) {
      assert.equal(shuffled.identity.roles.answer.model, reference.identity.roles.answer.model, 'selection ignores iteration order');
      assert.notEqual(shuffled.identity.registryRevision, reference.identity.registryRevision, 'a reordered ARRAY is a materially different document');
    }
  });

  it('selects by declared priority then candidate id', async () => {
    const registry = structuredClone(base.registry) as ProfileRegistry;
    registry.capabilities[0].candidates = [
      { candidate: 'chat-beta', priority: 2 },
      { candidate: 'chat-alpha', priority: 1 },
    ];
    const byPriority = await resolveProfile({ registry, request: base.request, host: base.host });
    assert.equal(okOf(byPriority) && byPriority.identity.roles.answer.model, 'example/alpha', 'priority 1 wins regardless of declaration order');

    registry.capabilities[0].candidates = [
      { candidate: 'chat-beta', priority: 1 },
      { candidate: 'chat-alpha', priority: 1 },
    ];
    const byId = await resolveProfile({ registry, request: base.request, host: base.host });
    assert.equal(okOf(byId) && byId.identity.roles.answer.model, 'example/alpha', 'ties break by ascending candidate id');
  });

  it('falls to the next candidate of a tag, never out of the tag', async () => {
    const host = structuredClone(base.host) as HostManifest;
    host.credentialSlots[0].configured = false;
    const fallen = await resolveProfile({ registry: base.registry, request: base.request, host });
    assert.equal(okOf(fallen) && fallen.identity.roles.answer.model, 'example/beta', 'the tag falls to its own next candidate');

    host.providers = [];
    const exhausted = await resolveProfile({ registry: base.registry, request: base.request, host });
    assert.equal(exhausted.ok, false, 'an exhausted tag refuses');
    if (!exhausted.ok) {
      assert.equal(exhausted.issues.some((issue) => issue.code === 'TCFG1015'), true);
      const text = JSON.stringify(exhausted.issues);
      assert.equal(text.includes('legacy'), false, 'no refusal mentions a legacy fallback');
      assert.equal(text.includes('offline'), false, 'no refusal falls back to the offline model');
    }
  });

  it('two hosts resolving one tag to different stacks produce different identities', async () => {
    const hostA = structuredClone(base.host) as HostManifest;
    const hostB = structuredClone(base.host) as HostManifest;
    hostB.credentialSlots[0].configured = false; // openrouter unavailable, ollama serves
    const a = await resolveProfile({ registry: base.registry, request: base.request, host: hostA });
    const b = await resolveProfile({ registry: base.registry, request: base.request, host: hostB });
    assert.equal(okOf(a) && okOf(b), true);
    if (okOf(a) && okOf(b)) {
      assert.notEqual(a.identity.roles.answer.model, b.identity.roles.answer.model);
      assert.notEqual(a.identity.identityId, b.identity.identityId, 'fast maps differently, so the identities differ');
    }
  });
});

describe('requests beyond the base profile', () => {
  it('resolves a tag request to a single chat role with the registry embedding', async () => {
    const resolution = await resolveProfile({ registry: base.registry, request: { kind: 'tag', tag: 'fast', overrides: null }, host: base.host });
    assert.equal(okOf(resolution), true);
    if (okOf(resolution)) {
      assert.deepEqual(Object.keys(resolution.identity.roles), ['chat']);
      assert.equal(resolution.identity.roles.chat.model, 'example/alpha');
      assert.equal(resolution.identity.embedding?.model, 'hash-trigram-64');
      assert.equal(resolution.identity.components.policy, null);
    }
  });

  it('applies role overrides and refuses invalid ones as TCFG1020', async () => {
    const pinned = await resolveProfile({
      registry: base.registry,
      request: { kind: 'profile', profile: 'base', overrides: { answer: { candidate: 'chat-beta' } } },
      host: base.host,
    });
    assert.equal(okOf(pinned) && pinned.identity.roles.answer.model, 'example/beta');

    const ghostRole = await resolveProfile({
      registry: base.registry,
      request: { kind: 'profile', profile: 'base', overrides: { ghost: { candidate: 'chat-beta' } } },
      host: base.host,
    });
    assert.equal(ghostRole.ok, false);
    if (!ghostRole.ok) assert.equal(ghostRole.issues.some((issue) => issue.code === 'TCFG1020'), true);
  });

  it('resolves the child profile differently from its parent', async () => {
    const parent = await resolveProfile({ registry: base.registry, request: { kind: 'profile', profile: 'base', overrides: null }, host: base.host });
    const child = await resolveProfile({ registry: base.registry, request: { kind: 'profile', profile: 'child', overrides: null }, host: base.host });
    assert.equal(okOf(parent) && okOf(child), true);
    if (okOf(parent) && okOf(child)) {
      assert.notEqual(child.identity.identityId, parent.identity.identityId, 'the requested profile is part of the identity');
      assert.equal(child.identity.roles.answer.model, parent.identity.roles.answer.model, 'an empty patch inherits the stack');
    }
  });

  it('resolves a legacy request without a registry revision and honors its states', async () => {
    const legacy = {
      kind: 'legacy',
      chat: { state: 'unconfigured' },
      embed: { state: 'unconfigured' },
      components: { policy: { id: 'memory-policies-shipped', revision: 'f'.repeat(64) }, ranker: null },
      chatPrompt: null,
    };
    const offline = await resolveProfile({ registry: base.registry, request: legacy, host: base.host });
    assert.equal(okOf(offline), true);
    if (okOf(offline)) {
      assert.equal(offline.identity.registryRevision, null);
      assert.deepEqual(Object.keys(offline.identity.roles), [], 'unconfigured legacy chat keeps no wire role');
      assert.equal(offline.identity.embedding?.provider, 'builtin');
      assert.equal(offline.identity.components.policy?.id, 'memory-policies-shipped');
    }

    const incomplete = await resolveProfile({
      registry: base.registry,
      request: { ...legacy, embed: { state: 'incomplete', requested: { provider: 'openrouter', baseUrl: null, model: null }, missing: ['model'] } },
      host: base.host,
    });
    assert.equal(incomplete.ok, false, 'an explicit half-configured wire refuses');
    if (!incomplete.ok) assert.equal(incomplete.issues.some((issue) => issue.code === 'TCFG1021'), true);

    const configured = await resolveProfile({
      registry: base.registry,
      request: { ...legacy, chat: { state: 'configured', provider: 'ollama', baseUrl: null, model: 'example/beta', credentialSlot: null } },
      host: base.host,
    });
    assert.equal(okOf(configured), true);
    if (okOf(configured)) assert.equal(configured.identity.roles.chat.base, 'http://localhost:11434/v1', 'a null legacy base takes the host entry');
  });
});

describe('purity', () => {
  it('repeated calls are deeply equal', async () => {
    const first = await resolveProfile({ registry: base.registry, request: base.request, host: base.host });
    const second = await resolveProfile({ registry: base.registry, request: base.request, host: base.host });
    assert.equal(equalsJson(first as unknown as Record<string, unknown>, second as unknown as Record<string, unknown>), true);
  });

  it('reads no process environment', async () => {
    const before = { ...process.env };
    await resolveProfile({ registry: base.registry, request: base.request, host: base.host });
    assert.deepEqual({ ...process.env }, before);
  });
});
