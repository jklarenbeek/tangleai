/**
 * Host settings over the `settings` collection — one row per key, a
 * typed read of the whole object, and the embedder factory that turns
 * the embed setting into a live seam.
 *
 * The default embedder is the pipeline's offline one (@jarenjs/ai's
 * hash reference at the measured width) — the app works COMPLETELY
 * offline out of the box; a real provider (the
 * same OpenAI-compatible family the chat client speaks: Ollama, LM
 * Studio, OpenRouter, any custom base) is an upgrade the user
 * configures, never a requirement to start. A half-configured wire
 * (no model; a custom provider with no base URL) falls back to the
 * built-in rather than failing every sync.
 *
 * The chat client is built here for the same reason: the chat engine
 * and the benchmark's live tier (`benchmark/lib/ai-env.ts`) both turn
 * a `ChatSettings` into `createChatClient`, and one factory means one
 * idea of "configured".
 */

import { createChatClient } from '@jarenjs/ai';
import { createEmbeddingClient, type Embedder } from '@jarenjs/ai/embed';
import { createOfflineEmbedder } from '@tangleai/pipeline';
import type { TangleDb } from '@tangleai/store';

export type WireProvider = 'ollama' | 'openrouter' | 'lmstudio' | 'custom';

export interface ChatSettings {
  provider: WireProvider | null;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
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

export interface SettingsStore {
  read(): Promise<Settings>;
  write(next: Partial<Settings>): Promise<Settings>;
}

/** The pre-0.46 embed setting named the OpenAI-compatible wire `openai`;
 * the provider set is now the chat client's, where that wire is `custom`. */
function readEmbed(stored: Partial<EmbedSettings> | undefined): EmbedSettings {
  const embed = { ...DEFAULT_SETTINGS.embed, ...stored };
  if ((embed.provider as string) === 'openai') embed.provider = 'custom';
  return embed;
}

/** The one settings row, keyed by its `key`. */
interface SettingsRow {
  key: string;
  value: Settings;
}

export function createSettingsStore(db: TangleDb): SettingsStore {
  const collection = db.collection<SettingsRow>('settings');
  return {
    async read() {
      const row = await collection.get('settings');
      const stored: Partial<Settings> = row?.value ?? {};
      return {
        folder: stored.folder ?? DEFAULT_SETTINGS.folder,
        chat: { ...DEFAULT_SETTINGS.chat, ...stored.chat },
        embed: readEmbed(stored.embed),
        documents: { ...DEFAULT_SETTINGS.documents, ...stored.documents },
        browser: { ...DEFAULT_SETTINGS.browser, ...stored.browser },
        search: { ...DEFAULT_SETTINGS.search, ...stored.search },
      };
    },
    async write(next) {
      const current = await this.read();
      const merged: Settings = {
        folder: next.folder !== undefined ? next.folder : current.folder,
        chat: { ...current.chat, ...next.chat },
        embed: readEmbed({ ...current.embed, ...next.embed }),
        documents: { ...current.documents, ...next.documents },
        browser: { ...current.browser, ...next.browser },
        search: { ...current.search, ...next.search },
      };
      await collection.put({ key: 'settings', value: merged });
      return merged;
    },
  };
}

/** Whether the embed setting names a usable wire (else the built-in serves). */
export function embedWireConfigured(embed: EmbedSettings): boolean {
  return embed.provider !== 'builtin' && embed.model !== null
    && (embed.baseUrl !== null || embed.provider !== 'custom');
}

/** The embed setting, turned into a live embedder. Injected fetch for tests. */
export function embedderFor(settings: Settings, fetchImpl?: typeof globalThis.fetch): Embedder {
  const embed = settings.embed;
  if (!embedWireConfigured(embed)) return createOfflineEmbedder();
  return createEmbeddingClient({
    provider: embed.provider,
    baseUrl: embed.baseUrl ?? undefined,
    model: embed.model ?? undefined,
    apiKey: embed.apiKey ?? undefined,
    fetch: fetchImpl,
  });
}

/** The chat client the desktop and the benchmarks build from a chat setting. */
export type ChatClient = ReturnType<typeof createChatClient>;

/** Whether the chat setting names a usable wire (OpenRouter needs no base URL). */
export function chatWireConfigured(chat: ChatSettings): boolean {
  return chat.provider !== null && chat.model !== null
    && (chat.baseUrl !== null || chat.provider === 'openrouter');
}

/**
 * The chat setting, turned into a live client. Injected fetch for
 * tests; `retry` is the caller's (the chat engine disables it so a dead
 * wire answers at once, a benchmark retries a rate limit for minutes);
 * `reasoning` is the client's default thinking control, forwarded
 * verbatim (a benchmark turns thinking off for short-answer extraction,
 * the measured case in @jarenjs/ai's README; the chat engine leaves the
 * model's default). Throws when `chatWireConfigured` is false — check
 * first.
 */
export function chatClientFor(
  chat: ChatSettings,
  options: {
    fetch?: typeof globalThis.fetch;
    retry?: { attempts?: number, baseMs?: number, maxMs?: number };
    reasoning?: { effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high', enabled?: boolean, exclude?: boolean, max_tokens?: number };
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
  });
}
