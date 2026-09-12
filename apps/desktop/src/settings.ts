/**
 * Host settings over the `settings` collection — one row per key, a
 * validated read of the whole object, and the ONE chat/embed factory
 * pair every consumer builds clients through.
 *
 * The default embedder is the pipeline's offline one (@tangleai/models's
 * hash reference at the measured width) — the app works COMPLETELY
 * offline out of the box; a real provider (the same OpenAI-compatible
 * family the chat client speaks: Ollama, LM Studio, OpenRouter, any
 * custom base) is an upgrade the user configures, never a requirement
 * to start.
 *
 * Stored rows are DATA, not settings, until they validate: `read`
 * normalizes a row against the settings schema and every member that
 * does not validate is replaced by its default and counted as a typed
 * issue — a corrupt row cannot spread a numeric model or a negative
 * budget into runtime state. `readValidated` returns those issues;
 * `readPublic` additionally redacts every credential value to a
 * configured/not-configured slot status, which is the only shape a
 * renderer may receive.
 *
 * Endpoint authority is the suite's: `chatWireConfigured` and
 * `embedWireConfigured` ask `resolveEndpoint` whether a wire resolves
 * and keep no provider-default rule of their own, so Ollama and LM
 * Studio with an omitted base are configured at their suite defaults
 * and a custom provider without a base is not.
 */

import { createChatClient } from '@tangleai/models/client';
import { resolveEndpoint } from '@tangleai/models/providers';
import { createEmbeddingClient, type Embedder } from '@tangleai/models/embed';
import { createOfflineEmbedder } from '@tangleai/pipeline';
import type { TangleDb } from '@tangleai/store';

import { SETTINGS_SCHEMA } from './contract.ts';
import { JarenValidator } from '@jarenjs/validate';

/** The wire providers of the settings contract (the suite's `PROVIDERS` owns the runtime vocabulary). */
export type WireProvider = 'ollama' | 'openrouter' | 'lmstudio' | 'custom';

export interface ChatSettings {
  provider: WireProvider | null;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
  maxTokens?: number | null;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
}

export interface EmbedSettings {
  provider: 'builtin' | WireProvider;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
}

export interface DocumentSettings {
  chunker: 'recursive' | 'semantic-boundary' | 's2';
  maxTokens: number;
  overlapTokens: number;
}

export interface BrowserSettings {
  mode: 'disabled' | 'webview' | 'remote';
  endpoint: string | null;
  token: string | null;
  allowUnsafeLocal: boolean;
}

export interface SearchSettings {
  searxngUrl: string | null;
}

export interface Settings {
  folder: string | null;
  chat: ChatSettings;
  embed: EmbedSettings;
  documents: DocumentSettings;
  browser: BrowserSettings;
  search: SearchSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  folder: null,
  chat: { provider: null, baseUrl: null, model: null, apiKey: null },
  embed: { provider: 'builtin', baseUrl: null, model: null, apiKey: null },
  documents: { chunker: 'recursive', maxTokens: 450, overlapTokens: 48 },
  browser: { mode: 'disabled', endpoint: null, token: null, allowUnsafeLocal: false },
  search: { searxngUrl: null },
};

/** A member that did not validate and the default that replaced it. */
export interface SettingsIssue {
  code: string;
  path: string;
  detail: string;
}

export interface ValidatedSettings {
  settings: Settings;
  issues: SettingsIssue[];
}

/** Which credential slots hold a value — the status, never the value. */
export interface SettingsSlots {
  chatKey: boolean;
  embedKey: boolean;
  browserToken: boolean;
}

export interface PublicSettings {
  /** The settings with every credential value replaced by null. */
  settings: Settings;
  slots: SettingsSlots;
  issues: SettingsIssue[];
}

/** Explicit secret-slot actions — the ONLY way a stored credential is removed. */
export interface SecretActions {
  clearChatKey?: boolean;
  clearEmbedKey?: boolean;
  clearBrowserToken?: boolean;
}

export interface SettingsStore {
  read(): Promise<Settings>;
  readValidated(): Promise<ValidatedSettings>;
  readPublic(): Promise<PublicSettings>;
  /**
   * Secrets are write-only: an absent, null or empty credential member
   * RETAINS the stored value (a public read-save round trip cannot
   * erase a key), a non-empty string replaces it, and only the explicit
   * clear action removes one.
   */
  write(next: Partial<Settings>, actions?: SecretActions): Promise<Settings>;
}

/** The replay seam published on both JarenJS wire-client factories. */
export type AiReplayCache = NonNullable<NonNullable<Parameters<typeof createChatClient>[0]>['cache']>;

/** The pre-0.46 embed setting named the OpenAI-compatible wire `openai`;
 * the provider set is now the chat client's, where that wire is `custom`. */
function readEmbed(stored: Partial<EmbedSettings> | undefined, issues?: SettingsIssue[]): EmbedSettings {
  const embed = { ...DEFAULT_SETTINGS.embed, ...stored };
  if ((embed.provider as string) === 'openai') {
    embed.provider = 'custom';
    issues?.push({ code: 'TCFG1007', path: '/embed/provider', detail: "the stored provider 'openai' predates the current vocabulary and reads as 'custom'" });
  }
  return embed;
}

/** The one settings row, keyed by its `key`. */
interface SettingsRow {
  key: string;
  value: Settings;
}

const settingsValidator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' })
  .compile(SETTINGS_SCHEMA as unknown as Record<string, unknown>);

/** Read one member of the defaults by JSON-pointer segments. */
function defaultAt(path: string): unknown {
  let value: unknown = DEFAULT_SETTINGS;
  for (const segment of path.split('/').slice(1)) {
    if (value === null || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function setAt(target: Record<string, any>, path: string, value: unknown): void {
  const segments = path.split('/').slice(1);
  let cursor: Record<string, any> = target;
  for (const segment of segments.slice(0, -1)) {
    if (cursor[segment] === null || typeof cursor[segment] !== 'object') return;
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
}

/**
 * Normalize a stored row into typed settings: structure first, then the
 * schema; every member the schema refuses reverts to its default and is
 * counted. The row itself is never mutated.
 */
export function validateStoredSettings(stored: Partial<Settings>): ValidatedSettings {
  const issues: SettingsIssue[] = [];
  const settings: Settings = {
    folder: stored.folder ?? DEFAULT_SETTINGS.folder,
    chat: { ...DEFAULT_SETTINGS.chat, ...stored.chat },
    embed: readEmbed(stored.embed, issues),
    documents: { ...DEFAULT_SETTINGS.documents, ...stored.documents },
    browser: { ...DEFAULT_SETTINGS.browser, ...stored.browser },
    search: { ...DEFAULT_SETTINGS.search, ...stored.search },
  };
  const outcome = settingsValidator(settings) as { valid: boolean, errors?: Array<{ instancePath?: string, message?: string }> };
  if (!outcome.valid) {
    const reverted = new Set<string>();
    for (const error of outcome.errors ?? []) {
      const path = error.instancePath ?? '';
      if (path === '' || reverted.has(path)) continue;
      reverted.add(path);
      setAt(settings as unknown as Record<string, any>, path, defaultAt(path));
      issues.push({ code: 'TCFG1007', path, detail: `${error.message ?? 'the stored value does not validate'}; the default replaced it` });
    }
    const recheck = settingsValidator(settings) as { valid: boolean };
    if (!recheck.valid) {
      issues.push({ code: 'TCFG1007', path: '', detail: 'the stored row does not validate even member-by-member; the defaults replaced it whole' });
      return { settings: structuredClone(DEFAULT_SETTINGS), issues };
    }
  }
  return { settings, issues };
}

export function createSettingsStore(db: TangleDb): SettingsStore {
  const collection = db.collection<SettingsRow>('settings');

  async function readValidated(): Promise<ValidatedSettings> {
    const row = await collection.get('settings');
    return validateStoredSettings(row?.value ?? {});
  }

  return {
    async read() {
      return (await readValidated()).settings;
    },
    readValidated,
    async readPublic() {
      const { settings, issues } = await readValidated();
      return {
        settings: {
          ...settings,
          chat: { ...settings.chat, apiKey: null },
          embed: { ...settings.embed, apiKey: null },
          browser: { ...settings.browser, token: null },
        },
        slots: {
          chatKey: settings.chat.apiKey !== null,
          embedKey: settings.embed.apiKey !== null,
          browserToken: settings.browser.token !== null,
        },
        issues,
      };
    },
    async write(next, actions = {}) {
      const current = (await readValidated()).settings;
      const secret = (incoming: string | null | undefined, stored: string | null, clear: boolean | undefined): string | null => {
        if (clear === true) return null;
        if (typeof incoming === 'string' && incoming !== '') return incoming;
        return stored;
      };
      const merged: Settings = {
        folder: next.folder !== undefined ? next.folder : current.folder,
        chat: { ...current.chat, ...next.chat, apiKey: secret(next.chat?.apiKey, current.chat.apiKey, actions.clearChatKey) },
        embed: readEmbed({ ...current.embed, ...next.embed, apiKey: secret(next.embed?.apiKey, current.embed.apiKey, actions.clearEmbedKey) }),
        documents: { ...current.documents, ...next.documents },
        browser: { ...current.browser, ...next.browser, token: secret(next.browser?.token, current.browser.token, actions.clearBrowserToken) },
        search: { ...current.search, ...next.search },
      };
      await collection.put({ key: 'settings', value: merged });
      return merged;
    },
  };
}

/** Whether a wire's endpoint resolves — asked of the suite, never decided here. */
function endpointResolves(provider: string, baseUrl: string | null): boolean {
  try {
    resolveEndpoint({ provider, baseUrl: baseUrl ?? undefined, model: 'probe' });
    return true;
  } catch {
    return false;
  }
}

/** Whether the embed setting names a usable wire (else the built-in serves). */
export function embedWireConfigured(embed: EmbedSettings): boolean {
  return embed.provider !== 'builtin' && embed.model !== null && endpointResolves(embed.provider, embed.baseUrl);
}

/** The embed setting, turned into a live embedder. Injected fetch for tests. */
export function embedderFor(
  settings: Settings,
  fetchImpl?: typeof globalThis.fetch,
  cache?: AiReplayCache,
): Embedder {
  const embed = settings.embed;
  if (!embedWireConfigured(embed)) return createOfflineEmbedder();
  return createEmbeddingClient({
    provider: embed.provider,
    baseUrl: embed.baseUrl ?? undefined,
    model: embed.model ?? undefined,
    apiKey: embed.apiKey ?? undefined,
    fetch: fetchImpl,
    cache,
  });
}

/** The chat client the desktop and the benchmarks build from a chat setting. */
export type ChatClient = ReturnType<typeof createChatClient>;

/** Whether the chat setting names a usable wire — the suite resolves, so Ollama and LM Studio need no base. */
export function chatWireConfigured(chat: ChatSettings): boolean {
  return chat.provider !== null && chat.model !== null && endpointResolves(chat.provider, chat.baseUrl);
}

/**
 * The chat setting, turned into a live client. Injected fetch for
 * tests; `retry` is the caller's (the chat engine disables it so a dead
 * wire answers at once, a benchmark retries a rate limit for minutes);
 * `reasoning` is the client's default thinking control, forwarded
 * verbatim (a benchmark turns thinking off for short-answer extraction,
 * the measured case in @tangleai/models's README; the chat engine leaves the
 * model's default). Throws when `chatWireConfigured` is false — check
 * first.
 */
export function chatClientFor(
  chat: ChatSettings,
  options: {
    fetch?: typeof globalThis.fetch;
    retry?: { attempts?: number, baseMs?: number, maxMs?: number };
    reasoning?: { effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high', enabled?: boolean, exclude?: boolean, max_tokens?: number };
    cache?: AiReplayCache;
  } = {},
): ChatClient {
  if (!chatWireConfigured(chat)) throw new Error('no chat wire is configured');
  return createChatClient({
    provider: chat.provider!,
    baseUrl: chat.baseUrl ?? undefined,
    model: chat.model!,
    apiKey: chat.apiKey ?? undefined,
    fetch: options.fetch,
    retry: options.retry,
    reasoning: options.reasoning,
    cache: options.cache,
    maxTokens: chat.maxTokens ?? undefined,
    maxTokensField: chat.maxTokensField,
  });
}
