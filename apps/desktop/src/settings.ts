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
 */

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

export interface Settings {
  folder: string | null;
  chat: ChatSettings;
  embed: EmbedSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  folder: null,
  chat: { provider: null, baseUrl: null, model: null, apiKey: null },
  embed: { provider: 'builtin', baseUrl: null, model: null, apiKey: null },
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

export function createSettingsStore(db: TangleDb): SettingsStore {
  const collection = db.collection('settings');
  return {
    async read() {
      const row = await collection.get('settings');
      const stored = (row?.value ?? {}) as Partial<Settings>;
      return {
        folder: stored.folder ?? DEFAULT_SETTINGS.folder,
        chat: { ...DEFAULT_SETTINGS.chat, ...stored.chat },
        embed: readEmbed(stored.embed),
      };
    },
    async write(next) {
      const current = await this.read();
      const merged: Settings = {
        folder: next.folder !== undefined ? next.folder : current.folder,
        chat: { ...current.chat, ...next.chat },
        embed: readEmbed({ ...current.embed, ...next.embed }),
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
