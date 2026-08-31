/**
 * The one effectful host boundary: validated settings project into the
 * generated legacy request, credential values stay in memory, the
 * manifest is suite-normalized and credential-free (userinfo refuses
 * BEFORE the suite), resolution states are honest — ready, refused,
 * provisional — and a provisional wire embedder finalizes its identity
 * from the FIRST reply, before any vector reaches a caller.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nodeDriver } from '@jarenjs/db/node';
import { openTangleDb } from '@tangleai/store';

import {
  buildHostManifest,
  chatPromptContentRevision,
  legacyRequestOf,
  refreshObservation,
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
import { revisionOf, type ProfileRequest } from '@tangleai/config';
import { scriptedFetch } from '../fixtures/scripted-wire.ts';

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
    assert.equal(unconfigured.components.policy?.id, 'memory-policies-shipped');
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
      assert.equal(built.manifest.embedding[0].model, 'hash-trigram-64');
      assert.equal(built.manifest.embedding[0].dims, 64);
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
      assert.equal(stack.identity.components.policy?.id, 'memory-policies-shipped');
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
