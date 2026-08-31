/**
 * The ONE effectful host boundary between stored/environment
 * configuration and the pure resolver.
 *
 * Everything secret-bearing happens here and only here: validated
 * settings or environment strings are projected into a generated
 * legacy request, credential values are bound to named slots IN MEMORY,
 * a credential-free host manifest is built from suite-normalized
 * endpoints (URL userinfo is refused as host policy BEFORE the suite
 * sees the base), the pure resolver produces an identity or issues, and
 * only an `ok` identity may construct clients — through the one
 * chat/embed factory pair, never a second wire.
 *
 * Probes are explicit refresh operations: `refreshObservation` counts
 * every attempted call and failure and dates its manifest; ordinary
 * stack resolution makes zero calls, and holding a credential is not
 * authority to probe.
 *
 * A wire embedder is provisional until a reply proves its width: the
 * stack comes back `provisional`, and its wrapped embedder finalizes
 * the identity from the FIRST successful reply — before any vector is
 * handed onward — refusing a dimension disagreement instead of storing
 * a vector under an unproven identity.
 */

import { PROVIDERS, probeProvider, resolveEndpoint, createToolbox } from '@jarenjs/ai';
import { probeEmbeddings, type Embedder } from '@jarenjs/ai/embed';
import { createOfflineEmbedder } from '@tangleai/pipeline';
import {
  resolveProfile,
  revisionOf,
  validateHostManifest,
  type ContentRevision,
  type HostManifest,
  type Issue,
  type ProfileRegistry,
  type ProfileRequest,
  type Resolution,
  type RunIdentity,
} from '@tangleai/config';

import productionRegistry from '../../../config/profiles.json' with { type: 'json' };
import { SYSTEM_PROMPT } from './chat.ts';
import {
  chatClientFor,
  chatWireConfigured,
  embedderFor,
  type AiReplayCache,
  type ChatClient,
  type Settings,
} from './settings.ts';

export { productionRegistry };

/** The desktop's declared slot names — names, never values. */
export const SLOT_NAMES = { chat: 'settings-chat-key', embed: 'settings-embed-key' } as const;

/** The chat prompt's registered content identity. */
export const CHAT_PROMPT_ID = 'desktop-grounded-chat';

/** The shipped policy component as the production registry declares it. */
const SHIPPED_POLICY = (productionRegistry as unknown as ProfileRegistry).components.find((c) => c.kind === 'policy') ?? null;

let chatPromptRevision: ContentRevision | null = null;

/** The versioned chat template's content revision, computed once from the real prompt. */
export async function chatPromptContentRevision(): Promise<ContentRevision> {
  if (chatPromptRevision === null) {
    chatPromptRevision = { id: CHAT_PROMPT_ID, revision: await revisionOf(SYSTEM_PROMPT) };
  }
  return chatPromptRevision;
}

// ---------------------------------------------------------------------------
// legacy projection — settings become a generated request, honestly
// ---------------------------------------------------------------------------

type LegacyState =
  | { state: 'unconfigured' }
  | { state: 'configured', provider: 'openrouter' | 'ollama' | 'lmstudio' | 'custom', baseUrl: string | null, model: string, credentialSlot: string | null }
  | { state: 'incomplete', requested: { provider?: string | null, baseUrl?: string | null, model?: string | null }, missing: string[] };

/**
 * The suite-normalized base a request records — AFTER the host's
 * userinfo prohibition, which must fire before the suite sees the base.
 * A credentialed base is returned raw so request validation refuses it
 * as TCFG1013 instead of this projection laundering it.
 */
export function normalizedWireBase(provider: string, baseUrl: string | null): string | null {
  if (baseUrl === null) return null;
  try {
    const url = new URL(baseUrl);
    if (url.username !== '' || url.password !== '') return baseUrl;
  } catch {
    return baseUrl;
  }
  try {
    return resolveEndpoint({ provider, baseUrl, model: 'projection' }).base;
  } catch {
    return baseUrl;
  }
}

function legacyChatOf(settings: Settings): LegacyState {
  const chat = settings.chat;
  if (chat.provider === null && chat.model === null) return { state: 'unconfigured' };
  const missing: string[] = [];
  if (chat.provider === null) missing.push('provider');
  if (chat.model === null) missing.push('model');
  if (chat.provider === 'custom' && chat.baseUrl === null) missing.push('baseUrl');
  if (missing.length > 0) {
    return { state: 'incomplete', requested: { provider: chat.provider, baseUrl: chat.baseUrl, model: chat.model }, missing };
  }
  return {
    state: 'configured',
    provider: chat.provider as 'openrouter',
    baseUrl: normalizedWireBase(chat.provider as string, chat.baseUrl),
    model: chat.model as string,
    credentialSlot: chat.apiKey !== null ? SLOT_NAMES.chat : null,
  };
}

function legacyEmbedOf(settings: Settings): LegacyState {
  const embed = settings.embed;
  if (embed.provider === 'builtin') return { state: 'unconfigured' };
  const missing: string[] = [];
  if (embed.model === null) missing.push('model');
  if (embed.provider === 'custom' && embed.baseUrl === null) missing.push('baseUrl');
  if (missing.length > 0) {
    return { state: 'incomplete', requested: { provider: embed.provider, baseUrl: embed.baseUrl, model: embed.model }, missing };
  }
  return {
    state: 'configured',
    provider: embed.provider,
    baseUrl: normalizedWireBase(embed.provider, embed.baseUrl),
    model: embed.model as string,
    credentialSlot: embed.apiKey !== null ? SLOT_NAMES.embed : null,
  };
}

/** Project validated settings into the generated legacy request. */
export async function legacyRequestOf(settings: Settings): Promise<ProfileRequest> {
  const chat = legacyChatOf(settings);
  return {
    kind: 'legacy',
    chat,
    embed: legacyEmbedOf(settings),
    components: {
      policy: SHIPPED_POLICY === null ? null : { id: SHIPPED_POLICY.id, revision: SHIPPED_POLICY.revision },
      ranker: null,
    },
    chatPrompt: chat.state === 'unconfigured' ? null : await chatPromptContentRevision(),
  } as ProfileRequest;
}

// ---------------------------------------------------------------------------
// the credential-free host manifest
// ---------------------------------------------------------------------------

/** Refuse userinfo as host policy BEFORE the suite normalizes a base. */
function userinfoIssue(baseUrl: string | null, path: string): Issue | null {
  if (baseUrl === null) return null;
  try {
    const url = new URL(baseUrl);
    if (url.username !== '' || url.password !== '') {
      return { code: 'TCFG1013', path, detail: 'the base URL carries userinfo; a credential-bearing base can enter no manifest, identity, report or cache key' };
    }
  } catch {
    return { code: 'TCFG1007', path, detail: 'the base URL does not parse' };
  }
  return null;
}

function featureListOf(provider: string): string[] {
  const structured = PROVIDERS[provider]?.structured ?? null;
  if (structured === 'json_schema') return ['structured-json-schema'];
  if (structured === 'json') return ['structured-json'];
  return [];
}

export interface ManifestFacts {
  /** Configured wires, credential-free: provider plus the AUTHORED base (normalized here). */
  wires: Array<{ provider: string, baseUrl: string | null, path: string }>;
  /** Slot presence, by declared name. */
  slots: Array<{ name: string, configured: boolean, source: string | null }>;
  /** Wire embedding identities with their observed widths (null until a probe/reply). */
  wireEmbeddings: Array<{ provider: string, baseUrl: string | null, model: string, dims: number | null }>;
  /** Hard ceilings. */
  budget: HostManifest['budget'];
  sourceClass: HostManifest['sourceClass'];
  observation?: HostManifest['observation'];
}

/**
 * Build the credential-free host manifest: suite-normalized provider
 * entries, the built-in embedding identity, the compiled (empty)
 * product toolbox, the installed component revisions, and the ceilings.
 */
export async function buildHostManifest(facts: ManifestFacts): Promise<{ ok: true, manifest: HostManifest } | { ok: false, issues: Issue[] }> {
  const issues: Issue[] = [];
  const providers: HostManifest['providers'] = [];
  const seen = new Set<string>();
  for (const wire of facts.wires) {
    const refused = userinfoIssue(wire.baseUrl, wire.path);
    if (refused !== null) {
      issues.push(refused);
      continue;
    }
    if (seen.has(wire.provider)) continue;
    seen.add(wire.provider);
    try {
      const endpoint = resolveEndpoint({ provider: wire.provider, baseUrl: wire.baseUrl ?? undefined, model: 'manifest' });
      providers.push({ provider: wire.provider as 'openrouter', base: endpoint.base, models: null, features: featureListOf(wire.provider) });
    } catch (error) {
      issues.push({ code: 'TCFG1009', path: wire.path, detail: error instanceof Error ? error.message : String(error) });
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  const offline = createOfflineEmbedder();
  const embedding: HostManifest['embedding'] = [
    { provider: 'builtin', base: null, model: offline.model, dims: offline.dims ?? null },
  ];
  for (const wire of facts.wireEmbeddings) {
    try {
      const endpoint = resolveEndpoint({ provider: wire.provider, baseUrl: wire.baseUrl ?? undefined, model: wire.model });
      embedding.push({ provider: wire.provider as 'openrouter', base: endpoint.base, model: wire.model, dims: wire.dims });
    } catch (error) {
      issues.push({ code: 'TCFG1009', path: '/embed', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  const tools: HostManifest['tools'] = [];
  for (const tool of createToolbox().list()) {
    tools.push({ name: tool.name, description: tool.description, inputSchemaRevision: await revisionOf(tool.inputSchema) });
  }
  const manifest: HostManifest = {
    sourceClass: facts.sourceClass,
    credentialSlots: facts.slots,
    providers,
    embedding,
    tools,
    components: (productionRegistry as unknown as ProfileRegistry).components.map((component) => ({ id: component.id, revision: component.revision })),
    budget: facts.budget,
    observation: facts.observation ?? null,
  };
  const validated = validateHostManifest(manifest);
  if (!validated.ok) return validated;
  return { ok: true, manifest: validated.value };
}

// ---------------------------------------------------------------------------
// the resolved stack — identity plus clients, or issues
// ---------------------------------------------------------------------------

export interface StackOptions {
  fetch?: typeof globalThis.fetch;
  cache?: AiReplayCache;
  retry?: { attempts?: number, baseMs?: number, maxMs?: number };
  reasoning?: { effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high', enabled?: boolean, exclude?: boolean, max_tokens?: number };
  /** Awaited when a provisional embedding identity finalizes, BEFORE the first vectors are returned to the caller. */
  onFinal?: (identity: RunIdentity) => Promise<void> | void;
}

/** An embedder that finalizes a provisional identity from its first reply. */
export interface FinalizingEmbedder extends Embedder {
  finalIdentity(): RunIdentity | null;
}

export type HostStack =
  | { state: 'refused', issues: Issue[] }
  | { state: 'ready', identity: RunIdentity, chat: ChatClient | null, embedder: Embedder }
  | { state: 'provisional', pending: 'embedding-width', chat: ChatClient | null, embedder: FinalizingEmbedder, issues: Issue[] };

const PROVISIONAL_WIDTH = (issues: Issue[]): boolean =>
  issues.length > 0 && issues.every((item) => item.code === 'TCFG1012' && item.detail.includes('width'));

/**
 * Resolve validated settings into a stack. Secrets stay inside: the
 * settings' key values are bound into the factory options in memory and
 * appear in no manifest, request, identity, issue or log.
 */
/** The manifest facts the desktop's settings imply — credential-free. */
export function settingsFactsOf(settings: Settings): ManifestFacts {
  return {
    sourceClass: 'desktop-settings',
    wires: [
      ...(legacyChatOf(settings).state === 'configured' ? [{ provider: settings.chat.provider as string, baseUrl: settings.chat.baseUrl, path: '/chat/baseUrl' }] : []),
      ...(legacyEmbedOf(settings).state === 'configured' ? [{ provider: settings.embed.provider, baseUrl: settings.embed.baseUrl, path: '/embed/baseUrl' }] : []),
    ],
    slots: [
      { name: SLOT_NAMES.chat, configured: settings.chat.apiKey !== null, source: 'settings' },
      { name: SLOT_NAMES.embed, configured: settings.embed.apiKey !== null, source: 'settings' },
    ],
    wireEmbeddings: legacyEmbedOf(settings).state === 'configured'
      ? [{ provider: settings.embed.provider, baseUrl: settings.embed.baseUrl, model: settings.embed.model as string, dims: null }]
      : [],
    budget: { maxCalls: null, maxTokens: null, maxMs: null, maxConcurrency: null },
  };
}

export async function settingsStack(
  settings: Settings,
  options: StackOptions = {},
  registry: unknown = productionRegistry,
): Promise<HostStack> {
  const request = await legacyRequestOf(settings);
  return resolveStack({ registry, request, facts: settingsFactsOf(settings), settings, options });
}

/** What a read-only inspection sees — no client, no probe, no secret. */
export interface StackInspection {
  request: ProfileRequest;
  state: 'ready' | 'refused' | 'provisional';
  issues: Issue[];
  identity: RunIdentity | null;
}

/**
 * Resolve the current settings WITHOUT constructing a client or making
 * any call: the pure resolver over the projected request and manifest.
 * This is the desktop's inspection path — a read never probes.
 */
export async function inspectStack(settings: Settings, registry: unknown = productionRegistry): Promise<StackInspection> {
  const request = await legacyRequestOf(settings);
  const built = await buildHostManifest(settingsFactsOf(settings));
  if (!built.ok) return { request, state: 'refused', issues: built.issues, identity: null };
  const resolution = await resolveProfile({ registry, request, host: built.manifest });
  if (resolution.ok) return { request, state: 'ready', issues: [], identity: resolution.identity };
  const issues = resolution.issues as Issue[];
  return PROVISIONAL_WIDTH(issues)
    ? { request, state: 'provisional', issues, identity: null }
    : { request, state: 'refused', issues, identity: null };
}

interface ResolveStackInput {
  registry: unknown;
  request: ProfileRequest;
  facts: ManifestFacts;
  settings: Settings;
  options: StackOptions;
}

async function resolveStack(input: ResolveStackInput): Promise<HostStack> {
  const { registry, request, facts, settings, options } = input;
  const built = await buildHostManifest(facts);
  if (!built.ok) return { state: 'refused', issues: built.issues };

  const resolution = await resolveProfile({ registry, request, host: built.manifest });
  if (resolution.ok) {
    return {
      state: 'ready',
      identity: resolution.identity,
      chat: chatClientOf(resolution, settings, options),
      embedder: embedderOf(resolution.identity, settings, options),
    };
  }
  if (!PROVISIONAL_WIDTH(resolution.issues as Issue[])) {
    return { state: 'refused', issues: resolution.issues as Issue[] };
  }

  // provisional: the wire embedder's width is unobserved — wrap the
  // client so the FIRST successful reply finalizes the identity before
  // any vector reaches a caller
  const wireEmbedder = embedderFor(settings, options.fetch, options.cache);
  let finalized: RunIdentity | null = null;
  let chat: ChatClient | null = null;
  const provisionalChat = chatClientOf(null, settings, options);
  chat = provisionalChat;
  const finalizing: FinalizingEmbedder = {
    model: wireEmbedder.model,
    dims: wireEmbedder.dims,
    async embed(texts: string[]) {
      const vectors = await wireEmbedder.embed(texts);
      if (finalized === null && vectors.length > 0) {
        const observed = vectors[0].length;
        const rebuilt = await buildHostManifest({
          ...facts,
          wireEmbeddings: facts.wireEmbeddings.map((wire) => ({ ...wire, dims: observed })),
        });
        if (!rebuilt.ok) throw new Error('adapter bug: a manifest that built provisionally must rebuild with an observed width');
        const proven = await resolveProfile({ registry, request, host: rebuilt.manifest });
        if (!proven.ok) {
          throw new Error(`the embedding wire answered ${observed} dimensions and the identity still refuses: ${proven.issues.map((item) => `${item.code} ${item.path}`).join('; ')}`);
        }
        finalized = proven.identity;
        (finalizing as { dims?: number }).dims = observed;
        await options.onFinal?.(proven.identity);
      }
      return vectors;
    },
    finalIdentity: () => finalized,
  } as FinalizingEmbedder;
  return { state: 'provisional', pending: 'embedding-width', chat, embedder: finalizing, issues: resolution.issues as Issue[] };
}

function chatClientOf(resolution: Resolution | null, settings: Settings, options: StackOptions): ChatClient | null {
  if (!chatWireConfigured(settings.chat)) return null;
  if (resolution !== null && resolution.ok && resolution.identity.roles.chat === undefined) return null;
  return chatClientFor(settings.chat, {
    fetch: options.fetch,
    retry: options.retry,
    reasoning: options.reasoning,
    cache: options.cache,
  });
}

function embedderOf(identity: RunIdentity, settings: Settings, options: StackOptions): Embedder {
  if (identity.embedding === null || identity.embedding.provider === 'builtin') return createOfflineEmbedder();
  return embedderFor(settings, options.fetch, options.cache);
}

// ---------------------------------------------------------------------------
// explicit host refresh — counted, dated, never a side effect
// ---------------------------------------------------------------------------

export interface ObservationOutcome {
  observation: NonNullable<HostManifest['observation']>;
  providerModels: string[] | null;
  embeddingDims: number | null;
  failures: Array<{ path: string, detail: string }>;
}

/**
 * Probe the configured wires once each, counting every attempted call
 * and failure, and return the dated observation. Called only from an
 * explicit user/operator action — never from resolution or startup.
 */
export async function refreshObservation(
  settings: Settings,
  options: { fetch?: typeof globalThis.fetch, timeoutMs?: number, now?: () => string } = {},
): Promise<ObservationOutcome> {
  const now = options.now ?? ((): string => new Date().toISOString());
  let calls = 0;
  let failed = 0;
  const failures: Array<{ path: string, detail: string }> = [];
  let providerModels: string[] | null = null;
  let embeddingDims: number | null = null;

  if (chatWireConfigured(settings.chat)) {
    calls += 1;
    const outcome = await probeProvider({
      provider: settings.chat.provider as string,
      baseUrl: settings.chat.baseUrl ?? undefined,
      apiKey: settings.chat.apiKey ?? undefined,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? 4000,
    });
    if (outcome.ok) providerModels = outcome.models;
    else {
      failed += 1;
      failures.push({ path: '/chat', detail: outcome.error });
    }
  }
  const embed = settings.embed;
  if (embed.provider !== 'builtin' && embed.model !== null) {
    calls += 1;
    const outcome = await probeEmbeddings({
      provider: embed.provider,
      baseUrl: embed.baseUrl ?? undefined,
      model: embed.model,
      apiKey: embed.apiKey ?? undefined,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? 4000,
    });
    if (outcome.ok) embeddingDims = outcome.dims;
    else {
      failed += 1;
      failures.push({ path: '/embed', detail: outcome.error ?? 'unreachable' });
    }
  }
  return {
    observation: { kind: 'probed', at: now(), calls, failures: failed },
    providerModels,
    embeddingDims,
    failures,
  };
}
