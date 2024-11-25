import fs from 'fs';
import path from 'path';

import toml from '@iarna/toml';
import { Embeddings } from '@langchain/core/embeddings';
import { RedisVectorStoreConfig } from '@langchain/redis';

type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>;
};

const loadConfig = () =>
  toml.parse(
    fs.readFileSync(path.join(__dirname, '../backend.toml'), 'utf-8'),
  );

const configuration = loadConfig();

export interface ProviderConfigDefaults {
  maxSync: number;
}

export interface ProviderConfig {
  driver: string;
  disabled?: boolean;
  endpoint?: string;
  apiKey?: string;
  secret?: string;
  token?: string;
  deployment?: string;
  version?: string;
  maxAsync?: number;
}

export function getProviderConfigDefaults() {
  const defaults = configuration['provider']['defaults'] as ProviderConfigDefaults;
  return defaults;
}

export function getProviderConfigNames() {
  const providers = configuration['providers'] as object;
  const names: string[] = [];
  for (const key in providers) {
    const result = getProviderConfig(key);
    if (result.length > 0)
      names.push(key);
  }
  return names;
}

export function getProviderConfig(name: string): ProviderConfig[] {
  const providers = configuration['providers'] as object;
  const result: ProviderConfig[] = [];
  if (name in providers) {
    const provider: ProviderConfig[] = providers[name];
    if (provider.length > 0) {
      for (let i = 0; i < provider.length; ++i) {
        const endpoint = provider[i];
        const disabled = endpoint.disabled || false;
        if (!!endpoint.disabled)
          continue;

        result.push(endpoint);
      }
    }
  }
  return result;
}

export interface EmbeddingPrefixConfig {
  query?: string;
  document?: string;
  ranking?: string;
  grouping?: string;
}

export interface EmbeddingConfigDefaults {
  measure?: "cosine" | "dot";
  encoding?: "float" | "base64";
}

export interface EmbeddingConfig 
  extends EmbeddingConfigDefaults {
  provider: string;
  model: string;
  disabled?: boolean;
  endpoint?: string;
  deployment?: string;
  version?: string;
  maxCtx?: number;
  maxDim?: number;
  prefix?: EmbeddingPrefixConfig;
}

export function getEmbeddingConfigDefaults() {
  const defaults = configuration['embedding']['defaults'] as EmbeddingConfigDefaults;
  return defaults;
}

export function getEmbeddingConfigNames() {
  const embeddings = configuration['embeddings'] as object;
  const names: string[] = [];
  for (const name in embeddings) {
    const config = getEmbeddingConfig(name);
    if (config != null)
      names.push(name);
  }
  return names;
}

export function getEmbeddingConfig(name: string): EmbeddingConfig | null {
  const embeddings = configuration['embeddings'] as object;
  if (name in embeddings) {
    const embedConfig: EmbeddingConfig = embeddings[name];
    if (!!embedConfig.disabled)
      return null;

    const provider = getProviderConfig(embedConfig.provider);
    if (provider.length === 0)
      return null;

    return embedConfig;
  }
  return null;
}

export interface ConversationConfigDefaults {
  temperature: number; 
}

export interface ConversationConfig {
  provider: string;
  model: string;
  disabled?: boolean;
  endpoint?: string;
  deployment?: string;
  version?: string;
  temperature?: number;
  maxCtx?: number;
}

export function getConversationConfigDefaults() {
  const defaults = configuration['chat']['defaults'] as ConversationConfigDefaults;
  return defaults;
}

export function getConversationConfigNames() {
  const chats = configuration['chats'] as object;
  const names: string[] = [];
  for (const name in chats) {
    const config = getConversationConfig(name);
    if (config != null)
      names.push(name);
  }
  return names;

}

export function getConversationConfig(name: string): ConversationConfig | null {
  const chats = configuration['chats'] as any;
  if (name in chats) {
    const chatConfig: ConversationConfig = chats[name];
    if (!!chatConfig.disabled)
      return null;

    const provider = getProviderConfig(chatConfig.provider);
    if (provider.length === 0)
      return null;

    return chatConfig;
  }
  return null;
}

export interface VectorStoreConfig {
  disabled?: boolean;
  driver: string;
  endpoint: string;
  collection?: string;
  prefix?: string;
}

export function getVectorStoreConfig(name: string): VectorStoreConfig| null {
  const stores = configuration["vectorstore"] as any;
  if (name in stores) {
    const store = stores[name] as VectorStoreConfig
    if (!!store.disabled && !store.driver)
      return null;
    return store;
  }
  return null;
}
