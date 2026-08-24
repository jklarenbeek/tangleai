/**
 * Host settings over the `settings` collection — one row per key, a
 * typed read of the whole object, and the embedder factory that turns
 * the embed setting into a live seam.
 *
 * The default embedder is the built-in trigram — the app works
 * COMPLETELY offline out of the box; a real provider (Ollama, any
 * OpenAI-compatible wire) is an upgrade the user configures, never a
 * requirement to start.
 */

import { createEmbeddingClient } from '@tangleai/providers';
import { createTrigramEmbedder, type Embedder } from '@tangleai/pipeline';
import type { TangleDb } from '@tangleai/store';

export interface ChatSettings {
  provider: 'ollama' | 'openrouter' | 'lmstudio' | 'custom' | null;
  baseUrl: string | null;
  model: string | null;
  apiKey: string | null;
}

export interface EmbedSettings {
  provider: 'builtin' | 'ollama' | 'openai';
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

export function createSettingsStore(db: TangleDb): SettingsStore {
  const collection = db.collection('settings');
  return {
    async read() {
      const row = await collection.get('settings');
      const stored = (row?.value ?? {}) as Partial<Settings>;
      return {
        folder: stored.folder ?? DEFAULT_SETTINGS.folder,
        chat: { ...DEFAULT_SETTINGS.chat, ...stored.chat },
        embed: { ...DEFAULT_SETTINGS.embed, ...stored.embed },
      };
    },
    async write(next) {
      const current = await this.read();
      const merged: Settings = {
        folder: next.folder !== undefined ? next.folder : current.folder,
        chat: { ...current.chat, ...next.chat },
        embed: { ...current.embed, ...next.embed },
      };
      await collection.put({ key: 'settings', value: merged });
      return merged;
    },
  };
}

/** The embed setting, turned into a live embedder. Injected fetch for tests. */
export function embedderFor(settings: Settings, fetchImpl?: typeof globalThis.fetch): Embedder {
  const embed = settings.embed;
  if (embed.provider === 'builtin' || embed.baseUrl === null || embed.model === null) {
    return createTrigramEmbedder();
  }
  return createEmbeddingClient({
    provider: embed.provider,
    baseUrl: embed.baseUrl,
    model: embed.model,
    apiKey: embed.apiKey ?? undefined,
    fetch: fetchImpl,
  });
}
