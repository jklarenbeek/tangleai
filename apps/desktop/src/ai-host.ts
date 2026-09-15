/**
 * The ONE effectful host boundary between stored/environment
 * configuration and the pure resolver.
 *
 * Everything secret-bearing happens here and only here: validated
 * settings are projected into a request — the generated legacy one when
 * no profile is named, the registry request when one is — credential
 * values are bound to named slots IN MEMORY, a credential-free host
 * manifest is built from suite-normalized endpoints (URL userinfo is
 * refused as host policy BEFORE the suite sees the base), the pure
 * resolver produces an identity or issues, and only an `ok` identity may
 * construct clients — through the one chat/embed factory pair, never a
 * second wire.
 *
 * The two projections differ in one place only: which credential slots
 * and providers the manifest declares. A named selection declares the
 * registry's slots — configured when this host holds a key for the
 * PROVIDER a candidate of that slot names, never by matching a slot's
 * spelling — and the providers its chat candidates name. Under a named
 * selection the resolved identity IS the client specification: provider,
 * base, model and inference controls come from the role, and only the
 * key comes from the settings. A selection the registry refuses is
 * issues, never the legacy projection and never the offline answer.
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

import { PROVIDERS, probeProvider, resolveEndpoint } from '@tangleai/models/providers';
import { createToolbox } from '@tangleai/agents/toolbox';
import { probeEmbeddings, type Embedder } from '@tangleai/models/embed';
import { createOfflineEmbedder } from '@tangleai/pipeline';
import {
  resolveProfile,
  revisionOf,
  validateHostManifest,
  type ContentRevision,
  type EffectiveRole,
  type HostManifest,
  type Issue,
  type ProfileRegistry,
  type ProfileRequest,
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
  type ChatSettings,
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
  | { state: 'configured', provider: 'openrouter' | 'ollama' | 'lmstudio' | 'custom', baseUrl: string | null, model: string, credentialSlot: string | null, inference?: RunIdentity['roles'][string]['inference'] }
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
    ...(chat.maxTokens == null && chat.maxTokensField === undefined ? {} : {
      inference: {
        temperature: null, maxTokens: chat.maxTokens ?? null,
        maxTokensField: chat.maxTokensField ?? 'max_tokens', retry: null, reasoning: null,
      },
    }),
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

/**
 * The request the validated settings ask for: the registry request when
 * a profile is named, the generated legacy one otherwise. This is the
 * ONLY branch between the two; nothing in the named branch calls
 * `legacyRequestOf`, so a refused selection can never be answered by the
 * wire settings.
 */
export async function requestOf(settings: Settings): Promise<ProfileRequest> {
  return settings.profile === null
    ? legacyRequestOf(settings)
    : { kind: 'profile', profile: settings.profile, overrides: null } as ProfileRequest;
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

/**
 * `display` names the wire a stack actually built — `provider/model` —
 * so a surface labels a reply with what answered it instead of re-reading
 * the settings, which say nothing about a named selection's choice.
 */
export type HostStack =
  | { state: 'refused', issues: Issue[] }
  | { state: 'ready', identity: RunIdentity, chat: ChatClient | null, display: string | null, embedder: Embedder }
  | { state: 'provisional', pending: 'embedding-width', chat: ChatClient | null, display: string | null, embedder: FinalizingEmbedder, issues: Issue[] };

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
    wireEmbeddings: wireEmbeddingFactsOf(settings),
    budget: { maxCalls: null, maxTokens: null, maxMs: null, maxConcurrency: null },
  };
}

function wireEmbeddingFactsOf(settings: Settings): ManifestFacts['wireEmbeddings'] {
  return legacyEmbedOf(settings).state === 'configured'
    ? [{ provider: settings.embed.provider, baseUrl: settings.embed.baseUrl, model: settings.embed.model as string, dims: null }]
    : [];
}

/**
 * The manifest facts a NAMED selection is resolved against.
 *
 * Slot binding is host policy, and it binds by PROVIDER: a registry slot
 * is configured when this host holds a chat key and some chat candidate
 * of that slot names the provider the key belongs to. Matching a slot's
 * spelling binds nothing — the desktop's own slot names are not the
 * registry's, and a key held for one provider is not authority on
 * another. The desktop's own two slots stay declared, so a profile that
 * names one still resolves.
 *
 * Providers are the ones the registry's chat candidates name, each at
 * its suite-default base — except the one the stored chat settings also
 * name, which keeps the operator's own base so a proxy survives the
 * selection. The userinfo prohibition runs over every base here exactly
 * as it does for the legacy projection.
 */
export function profileFactsOf(settings: Settings, registry: ProfileRegistry): ManifestFacts {
  const chatCandidates = registry.candidates.filter((candidate) => candidate.kind === 'chat');
  const holdsKeyFor = (provider: string): boolean =>
    settings.chat.provider === provider && settings.chat.apiKey !== null;

  const slots: ManifestFacts['slots'] = [];
  const declared = new Set<string>();
  for (const name of registry.credentialSlots) {
    declared.add(name);
    slots.push({
      name,
      configured: chatCandidates.some((candidate) => candidate.credentialSlot === name && holdsKeyFor(candidate.provider)),
      source: 'settings',
    });
  }
  for (const own of [
    { name: SLOT_NAMES.chat, configured: settings.chat.apiKey !== null },
    { name: SLOT_NAMES.embed, configured: settings.embed.apiKey !== null },
  ]) {
    if (declared.has(own.name)) continue;
    declared.add(own.name);
    slots.push({ ...own, source: 'settings' });
  }

  const wires: ManifestFacts['wires'] = [];
  const seen = new Set<string>();
  for (const candidate of chatCandidates) {
    if (seen.has(candidate.provider)) continue;
    seen.add(candidate.provider);
    wires.push({
      provider: candidate.provider,
      baseUrl: settings.chat.provider === candidate.provider ? settings.chat.baseUrl : null,
      path: '/chat/baseUrl',
    });
  }

  return {
    sourceClass: 'desktop-settings',
    wires,
    slots,
    wireEmbeddings: wireEmbeddingFactsOf(settings),
    budget: { maxCalls: null, maxTokens: null, maxMs: null, maxConcurrency: null },
  };
}

/** The manifest facts the current settings imply, by which request they ask for. */
export function factsOf(settings: Settings, registry: unknown = productionRegistry): ManifestFacts {
  return settings.profile === null
    ? settingsFactsOf(settings)
    : profileFactsOf(settings, registry as ProfileRegistry);
}

export async function settingsStack(
  settings: Settings,
  options: StackOptions = {},
  registry: unknown = productionRegistry,
): Promise<HostStack> {
  const request = await requestOf(settings);
  return resolveStack({ registry, request, facts: factsOf(settings, registry), settings, options });
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
  const request = await requestOf(settings);
  const built = await buildHostManifest(factsOf(settings, registry));
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
    const wire = chatWireOf(request, resolution.identity, settings);
    return {
      state: 'ready',
      identity: resolution.identity,
      chat: chatClientOf(wire, options),
      display: displayOf(wire),
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
  const provisionalWire = chatWireOf(request, null, settings);
  const chat: ChatClient | null = chatClientOf(provisionalWire, options);
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
  return { state: 'provisional', pending: 'embedding-width', chat, display: displayOf(provisionalWire), embedder: finalizing, issues: resolution.issues as Issue[] };
}

/**
 * The chat wire a resolved role names, bound to the key this host holds
 * for that role's provider. Provider, base, model and the inference
 * controls come from the identity — it IS the client specification —
 * and only the key comes from the settings. A role whose slot this host
 * cannot bind builds nothing: the resolution already refused it, and a
 * keyless call to a credentialed endpoint is not a fallback.
 */
export function chatSettingsOfRole(role: EffectiveRole, settings: Settings): ChatSettings | null {
  const key = role.credentialSlot === null
    ? null
    : (settings.chat.provider === role.provider ? settings.chat.apiKey : null);
  if (role.credentialSlot !== null && key === null) return null;
  return {
    provider: role.provider,
    baseUrl: role.base,
    model: role.model,
    apiKey: key,
    maxTokens: role.inference.maxTokens,
    ...(role.inference.maxTokensField === undefined ? {} : { maxTokensField: role.inference.maxTokensField }),
  };
}

/**
 * Which wire a stack may build. The legacy branch builds from the
 * settings verbatim, exactly as it always has; a named selection builds
 * from the identity's chat role and from nothing else — no identity
 * means no selection resolved, and the answer is no client rather than
 * the settings' wire.
 */
function chatWireOf(request: ProfileRequest, identity: RunIdentity | null, settings: Settings): ChatSettings | null {
  if (request.kind !== 'legacy') {
    const role = identity?.roles.chat;
    if (role === undefined) return null;
    const chat = chatSettingsOfRole(role, settings);
    return chat !== null && chatWireConfigured(chat) ? chat : null;
  }
  if (identity !== null && identity.roles.chat === undefined) return null;
  return chatWireConfigured(settings.chat) ? settings.chat : null;
}

/** What a surface calls the wire that answered. */
const displayOf = (chat: ChatSettings | null): string | null =>
  chat === null ? null : `${chat.provider}/${chat.model}`;

function chatClientOf(chat: ChatSettings | null, options: StackOptions): ChatClient | null {
  if (chat === null) return null;
  return chatClientFor(chat, {
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
