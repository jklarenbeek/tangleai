/**
 * The one effectful host boundary: validated settings project into the
 * generated legacy request or, when one is named, the registry request;
 * credential values stay in memory, the manifest is suite-normalized and
 * credential-free (userinfo refuses BEFORE the suite), resolution states
 * are honest — ready, refused, provisional — a provisional wire embedder
 * finalizes its identity from the FIRST reply, before any vector reaches
 * a caller, and a named selection is built from the identity it resolved
 * rather than from the wire settings beside it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nodeDriver } from '@jarenjs/db/node';
import { openTangleDb } from '@tangleai/store';

import {
  buildHostManifest,
  chatPromptContentRevision,
  inspectStack,
  legacyRequestOf,
  productionRegistry,
  profileFactsOf,
  refreshObservation,
  requestOf,
  settingsStack,
  SLOT_NAMES,
  type FinalizingEmbedder,
} from '../../apps/desktop/src/ai-host.ts';
import {
  DEFAULT_SETTINGS,
  chatWireConfigured,
  createSettingsStore,
  embedWireConfigured,
  validateStoredSettings,
  type Settings,
} from '../../apps/desktop/src/settings.ts';
import { SYSTEM_PROMPT } from '../../apps/desktop/src/chat.ts';
import { revisionOf, type ProfileRegistry, type ProfileRequest } from '@tangleai/config';
import { scriptedFetch } from '../fixtures/scripted-wire.ts';
import { readFile } from 'node:fs/promises';

const SENTINEL = 'sk-adapter-sentinel-feedface';

const wired = (over: Partial<Settings> = {}): Settings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  ...over,
});

describe('validated settings reads', () => {
  it('replaces every member a corrupt row smuggled and counts each', () => {
    const { settings, issues } = validateStoredSettings({
      chat: { provider: 'bogus' as never, model: 17 as never, baseUrl: null, apiKey: null },
      documents: { chunker: 'recursive', maxTokens: -9, overlapTokens: 48 },
    });
    assert.equal(settings.chat.provider, null, 'an unknown provider reverts to the default');
    assert.equal(settings.chat.model, null, 'a numeric model reverts to the default');
    assert.equal(settings.documents.maxTokens, 450, 'a negative budget reverts to the default');
    assert.equal(settings.documents.chunker, 'recursive', 'valid siblings survive');
    assert.equal(issues.length >= 3, true, 'every reverted member is a counted issue');
    for (const issue of issues) assert.match(issue.path, /^\/(chat|documents)\//);
  });

  it('redacts every credential value in the public read and reports slot status', async () => {
    const db = await openTangleDb({ driver: nodeDriver() });
    const store = createSettingsStore(db);
    await store.write({
      chat: { provider: 'openrouter', baseUrl: null, model: 'm', apiKey: SENTINEL },
      browser: { mode: 'remote', endpoint: 'https://example.com', token: SENTINEL, allowUnsafeLocal: false },
    });
    const view = await store.readPublic();
    assert.equal(view.settings.chat.apiKey, null);
    assert.equal(view.settings.browser.token, null);
    assert.deepEqual(view.slots, { chatKey: true, embedKey: false, browserToken: true });
    assert.equal(JSON.stringify(view).includes(SENTINEL), false, 'no public byte carries the value');
  });

  it('secrets are write-only: read-save retains, a string replaces, only the explicit action clears', async () => {
    const db = await openTangleDb({ driver: nodeDriver() });
    const store = createSettingsStore(db);
    await store.write({ chat: { provider: 'openrouter', baseUrl: null, model: 'm', apiKey: SENTINEL } });
    await store.write({ chat: { model: 'm2' } as never });
    assert.equal((await store.read()).chat.apiKey, SENTINEL, 'an absent member retains');
    const roundTrip = (await store.readPublic()).settings;
    await store.write(roundTrip);
    assert.equal((await store.read()).chat.apiKey, SENTINEL, 'a public read saved back verbatim retains — null is not a clear');
    await store.write({ chat: { apiKey: '' } as never });
    assert.equal((await store.read()).chat.apiKey, SENTINEL, 'a blank input retains');
    await store.write({ chat: { apiKey: 'replaced' } as never });
    assert.equal((await store.read()).chat.apiKey, 'replaced', 'a non-empty string replaces');
    await store.write({}, { clearChatKey: true });
    assert.equal((await store.read()).chat.apiKey, null, 'only the explicit action clears');
  });
});

describe('the profile setting', () => {
  it('defaults to none, round-trips a name, and reverts a value the schema refuses', async () => {
    assert.equal(DEFAULT_SETTINGS.profile, null, 'no selection is the default');
    assert.equal(validateStoredSettings({}).settings.profile, null);
    assert.equal(validateStoredSettings({ profile: 'desktop-default' }).settings.profile, 'desktop-default');

    const refused = validateStoredSettings({ profile: '' } as never);
    assert.equal(refused.settings.profile, null, 'a name of no length is not a selection');
    assert.deepEqual(refused.issues.map((issue) => `${issue.code} ${issue.path}`), ['TCFG1007 /profile']);
    assert.equal(validateStoredSettings({ profile: 7 } as never).settings.profile, null);

    const db = await openTangleDb({ driver: nodeDriver() });
    try {
      const store = createSettingsStore(db);
      await store.write({ profile: 'desktop-default' });
      assert.equal((await store.read()).profile, 'desktop-default');
      // the name is displayed, never redacted: it is not a credential
      assert.equal((await store.readPublic()).settings.profile, 'desktop-default');
      // an unrelated write leaves the selection alone
      await store.write({ folder: '/tmp/elsewhere' });
      assert.equal((await store.read()).profile, 'desktop-default');
      await store.write({ profile: null });
      assert.equal((await store.read()).profile, null);
    } finally {
      await db.close();
    }
  });
});

describe('suite endpoint authority', () => {
  it('Ollama and LM Studio without bases are configured at suite defaults; custom is not', () => {
    assert.equal(chatWireConfigured({ provider: 'ollama', baseUrl: null, model: 'm', apiKey: null }), true);
    assert.equal(chatWireConfigured({ provider: 'lmstudio', baseUrl: null, model: 'm', apiKey: null }), true);
    assert.equal(chatWireConfigured({ provider: 'custom', baseUrl: null, model: 'm', apiKey: null }), false);
    assert.equal(embedWireConfigured({ provider: 'ollama', baseUrl: null, model: 'e', apiKey: null }), true);
    assert.equal(embedWireConfigured({ provider: 'custom', baseUrl: null, model: 'e', apiKey: null }), false);
  });
});

describe('the generated legacy request', () => {
  it('projects unconfigured, configured and incomplete states honestly', async () => {
    const unconfigured = await legacyRequestOf(DEFAULT_SETTINGS) as Extract<ProfileRequest, { kind: 'legacy' }>;
    assert.equal(unconfigured.chat.state, 'unconfigured');
    assert.equal(unconfigured.embed.state, 'unconfigured');
    assert.equal(unconfigured.components.policy?.id, 'memory-policies-selected');
    assert.equal(unconfigured.chatPrompt, null);

    const configured = await legacyRequestOf(wired({
      chat: { provider: 'openrouter', baseUrl: null, model: 'm', apiKey: SENTINEL },
    })) as Extract<ProfileRequest, { kind: 'legacy' }>;
    assert.equal(configured.chat.state, 'configured');
    if (configured.chat.state === 'configured') assert.equal(configured.chat.credentialSlot, SLOT_NAMES.chat);
    assert.equal(configured.chatPrompt?.id, 'desktop-grounded-chat');
    assert.equal(JSON.stringify(configured).includes(SENTINEL), false, 'a request carries slot names, never values');

    const incomplete = await legacyRequestOf(wired({
      embed: { provider: 'openrouter', baseUrl: null, model: null, apiKey: null },
    })) as Extract<ProfileRequest, { kind: 'legacy' }>;
    assert.equal(incomplete.embed.state, 'incomplete');
    if (incomplete.embed.state === 'incomplete') assert.deepEqual(incomplete.embed.missing, ['model']);
  });

  it('registers the shipped chat template at its recomputed revision', async () => {
    const prompt = await chatPromptContentRevision();
    assert.equal(prompt.revision, await revisionOf(SYSTEM_PROMPT), 'the registry revision is the canonical hash of the shipped prompt');
  });
});

describe('the credential-free host manifest', () => {
  it('refuses URL userinfo as host policy before the suite sees the base', async () => {
    const built = await buildHostManifest({
      sourceClass: 'synthetic',
      wires: [{ provider: 'custom', baseUrl: `https://user:${SENTINEL}@example.com/v1`, path: '/chat/baseUrl' }],
      slots: [],
      wireEmbeddings: [],
      budget: { maxCalls: null, maxTokens: null, maxMs: null, maxConcurrency: null },
    });
    assert.equal(built.ok, false);
    if (!built.ok) {
      assert.equal(built.issues[0].code, 'TCFG1013');
      assert.equal(JSON.stringify(built.issues).includes(SENTINEL), false, 'the refusal names no secret');
    }
  });

  it('normalizes bases through the suite and declares built-in embedding', async () => {
    const built = await buildHostManifest({
      sourceClass: 'synthetic',
      wires: [{ provider: 'ollama', baseUrl: null, path: '/chat/baseUrl' }],
      slots: [],
      wireEmbeddings: [],
      budget: { maxCalls: null, maxTokens: null, maxMs: null, maxConcurrency: null },
    });
    assert.equal(built.ok, true);
    if (built.ok) {
      assert.equal(built.manifest.providers[0].base, 'http://localhost:11434/v1');
      assert.equal(built.manifest.embedding[0].model, 'hash-trigram-512');
      assert.equal(built.manifest.embedding[0].dims, 512);
    }
  });
});

describe('the resolved stack', () => {
  it('default settings are a ready offline stack with a stored-shape identity', async () => {
    const stack = await settingsStack(DEFAULT_SETTINGS);
    assert.equal(stack.state, 'ready');
    if (stack.state === 'ready') {
      assert.equal(stack.chat, null);
      assert.equal(stack.identity.registryRevision, null);
      assert.equal(stack.identity.embedding?.provider, 'builtin');
      assert.equal(stack.identity.components.policy?.id, 'memory-policies-selected');
    }
  });

  it('an incomplete wire refuses as TCFG1021 and never falls back', async () => {
    const stack = await settingsStack(wired({ embed: { provider: 'openrouter', baseUrl: null, model: null, apiKey: null } }));
    assert.equal(stack.state, 'refused');
    if (stack.state === 'refused') assert.equal(stack.issues.some((issue) => issue.code === 'TCFG1021'), true);
  });

  it('a wire embedder is provisional and finalizes its identity from the first reply, before vectors return', async () => {
    const { fetch, calls } = scriptedFetch();
    const finalOrder: string[] = [];
    const stack = await settingsStack(
      wired({ embed: { provider: 'openrouter', baseUrl: null, model: 'stub-embed', apiKey: 'k' } }),
      { fetch, onFinal: (identity) => { finalOrder.push(`final:${identity.embedding?.dims}`); } },
    );
    assert.equal(stack.state, 'provisional');
    if (stack.state !== 'provisional') return;
    assert.equal(stack.issues.every((issue) => issue.code === 'TCFG1012'), true, 'the only pending issue is the unobserved width');
    const embedder = stack.embedder as FinalizingEmbedder;
    assert.equal(embedder.finalIdentity(), null, 'nothing is final before a reply');
    const vectors = await embedder.embed(['first text']);
    finalOrder.push('vectors-returned');
    assert.deepEqual(finalOrder, ['final:8', 'vectors-returned'], 'finalization completes BEFORE the vectors reach the caller');
    const identity = embedder.finalIdentity();
    assert.equal(identity?.embedding?.dims, vectors[0].length);
    assert.equal(identity?.embedding?.model, 'stub-embed');
    assert.equal(calls.embeddings, 1);
    const again = await embedder.embed(['second text']);
    assert.equal(again.length, 1);
    assert.equal(embedder.finalIdentity()?.identityId, identity?.identityId, 'the identity does not drift after finalization');
  });
});

// ---------------------------------------------------------------------------
// named profile selection
// ---------------------------------------------------------------------------

/**
 * The identity the unconfigured settings resolve to when no profile is
 * named. Pinned as a literal so the legacy projection cannot drift while
 * the selected one is being built beside it.
 */
const LEGACY_DEFAULT_IDENTITY = 'fd8f7a7df75a3719a541709e2abf6ecaed7d53cedfa33a48e446ef96aec49e47';

/** The shipped selection, with a chat key merely HELD for the candidate's provider. */
const selected = (over: Partial<Settings['chat']> = {}): Settings => wired({
  profile: 'desktop-default',
  chat: { provider: 'openrouter', baseUrl: null, model: null, apiKey: 'k', ...over },
});

describe('named profile selection', () => {
  it('leaves the legacy projection byte-identical when no profile is named', async () => {
    const request = await requestOf(DEFAULT_SETTINGS);
    assert.deepEqual(request, await legacyRequestOf(DEFAULT_SETTINGS), 'no profile asks exactly what it always asked');
    const inspection = await inspectStack(DEFAULT_SETTINGS);
    assert.equal(inspection.state, 'ready');
    assert.equal(inspection.identity?.requested.kind, 'legacy');
    assert.equal(inspection.identity?.identityId, LEGACY_DEFAULT_IDENTITY);
  });

  it('a named selection is requested as a profile and resolves from the registry', async () => {
    const request = await requestOf(selected()) as { kind: string, profile: string, overrides: unknown };
    assert.deepEqual(request, { kind: 'profile', profile: 'desktop-default', overrides: null });
    const stack = await settingsStack(selected(), { fetch: (() => { throw new Error('resolution must not call'); }) as never });
    assert.equal(stack.state, 'ready');
    if (stack.state !== 'ready') return;
    assert.equal(stack.identity.requested.kind, 'profile');
    assert.equal((stack.identity.requested as { profile: string }).profile, 'desktop-default');
    assert.equal(stack.identity.roles.chat.model, 'z-ai/glm-5.3-flash');
    assert.equal(stack.identity.roles.chat.provider, 'openrouter');
    assert.equal(stack.identity.embedding?.provider, 'builtin');
    assert.notEqual(stack.identity.identityId, LEGACY_DEFAULT_IDENTITY, 'a selection is a different identity from the projection');
    assert.equal(stack.display, 'openrouter/z-ai/glm-5.3-flash', 'the surface names what answered');
    assert.notEqual(stack.chat, null, 'the role that resolved builds its client');
  });

  it('builds the client from the identity, not from the wire settings beside it', async () => {
    const bare = await inspectStack(selected());
    const contradicting = await inspectStack(selected({ model: 'some/other-model', baseUrl: null }));
    assert.equal(bare.identity?.identityId, contradicting.identity?.identityId,
      'the settings model is not part of a named selection');
    assert.equal(contradicting.identity?.roles.chat.model, 'z-ai/glm-5.3-flash');
    const stack = await settingsStack(selected({ model: 'some/other-model' }));
    assert.equal(stack.state === 'ready' ? stack.display : null, 'openrouter/z-ai/glm-5.3-flash');
  });

  it('binds a credential slot by provider, never by the slot name', async () => {
    const facts = profileFactsOf(selected(), productionRegistry as unknown as ProfileRegistry);
    assert.deepEqual(facts.slots.find((slot) => slot.name === 'openrouter-primary'),
      { name: 'openrouter-primary', configured: true, source: 'settings' });
    assert.equal(facts.slots.some((slot) => slot.name === SLOT_NAMES.chat), true, "the desktop's own slots stay declared");

    // a key held for ANOTHER provider binds nothing, however the slot is spelled
    const elsewhere = profileFactsOf(
      wired({ profile: 'desktop-default', chat: { provider: 'ollama', baseUrl: null, model: null, apiKey: 'k' } }),
      productionRegistry as unknown as ProfileRegistry,
    );
    assert.equal(elsewhere.slots.find((slot) => slot.name === 'openrouter-primary')?.configured, false);

    for (const settings of [
      wired({ profile: 'desktop-default', chat: { provider: 'ollama', baseUrl: null, model: null, apiKey: 'k' } }),
      wired({ profile: 'desktop-default' }),
    ]) {
      const inspection = await inspectStack(settings);
      assert.equal(inspection.state, 'refused');
      assert.equal(inspection.identity, null);
      assert.deepEqual(inspection.issues.map((issue) => `${issue.code} ${issue.path}`), ['TCFG1015 /roles/chat/capability']);
      assert.match(inspection.issues[0].detail, /credential slot 'openrouter-primary' is not configured/);
    }
  });

  it('refuses an unknown profile and an uninstalled component as fixable issues', async () => {
    const unknown = await inspectStack(wired({ profile: 'no-such-profile' }));
    assert.equal(unknown.state, 'refused');
    assert.deepEqual(unknown.issues.map((issue) => `${issue.code} ${issue.path}`), ['TCFG1005 /profile']);

    const mutated = structuredClone(productionRegistry) as unknown as ProfileRegistry;
    mutated.components[0].revision = 'c'.repeat(64);
    const stale = await inspectStack(selected(), mutated);
    assert.equal(stale.state, 'refused');
    assert.deepEqual(stale.issues.map((issue) => `${issue.code} ${issue.path}`), ['TCFG1017 /policyComponent']);
    for (const issue of [...unknown.issues, ...stale.issues]) {
      assert.equal(typeof issue.detail, 'string');
      assert.notEqual(issue.detail, '', 'every refusal says what to fix');
    }
  });

  it('a refused selection degrades to nothing: no legacy request, no offline client', async () => {
    const stack = await settingsStack(wired({ profile: 'desktop-default' }));
    assert.equal(stack.state, 'refused');
    assert.equal('chat' in stack, false, 'a refusal carries no client at all');
    assert.equal('identity' in stack, false);

    // the legacy projection has exactly one caller, and it is the branch
    // taken when no profile is named
    const source = await readFile('apps/desktop/src/ai-host.ts', 'utf8');
    const callSites = source.split('legacyRequestOf(').length - 1 - 1;
    assert.equal(callSites, 1, 'the legacy projection is a branch, never a fallback');
    assert.match(source, /settings\.profile === null\s*\n\s*\? legacyRequestOf\(settings\)/);
  });

  it('keeps the userinfo prohibition over the selected projection', async () => {
    const facts = profileFactsOf(
      selected({ baseUrl: 'https://user:secret@proxy.example.com/v1' }),
      productionRegistry as unknown as ProfileRegistry,
    );
    assert.equal(facts.wires[0].baseUrl, 'https://user:secret@proxy.example.com/v1', 'the raw base reaches the manifest builder');
    const built = await buildHostManifest(facts);
    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.deepEqual(built.issues.map((issue) => issue.code), ['TCFG1013']);
  });

  it("keeps the operator's own base for the provider the settings also name", () => {
    const facts = profileFactsOf(
      selected({ baseUrl: 'https://mirror.example.com/v1' }),
      productionRegistry as unknown as ProfileRegistry,
    );
    assert.deepEqual(facts.wires, [{ provider: 'openrouter', baseUrl: 'https://mirror.example.com/v1', path: '/chat/baseUrl' }]);
  });
});

describe('explicit host refresh', () => {
  it('counts every attempted call and failure and dates its observation', async () => {
    const { fetch } = scriptedFetch();
    const outcome = await refreshObservation(
      wired({
        chat: { provider: 'openrouter', baseUrl: null, model: 'm', apiKey: 'k' },
        embed: { provider: 'openrouter', baseUrl: null, model: 'stub-embed', apiKey: 'k' },
      }),
      { fetch, now: () => '2026-08-31T00:00:00.000Z' },
    );
    assert.equal(outcome.observation.kind, 'probed');
    assert.equal(outcome.observation.at, '2026-08-31T00:00:00.000Z');
    assert.equal(outcome.observation.calls, 2, 'one probe per configured wire, counted');
    assert.equal(outcome.embeddingDims, 8, 'the embedding probe observed the width');
    assert.equal(outcome.observation.failures, 1, 'the scripted wire serves no /models listing — a failure is a counted value');
  });

  it('makes zero calls for ordinary resolution', async () => {
    let calls = 0;
    const counting: typeof fetch = () => { calls += 1; throw new Error('no'); };
    await settingsStack(DEFAULT_SETTINGS, { fetch: counting });
    await settingsStack(wired({ chat: { provider: 'openrouter', baseUrl: null, model: 'm', apiKey: 'k' } }), { fetch: counting });
    assert.equal(calls, 0, 'resolution and client construction never probe');
  });
});
