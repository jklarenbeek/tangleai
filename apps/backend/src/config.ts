import fs from 'fs';
import path from 'path';
import toml from '@iarna/toml';
import { NullIfEmpty, SplitString } from '@tangleai/utils';

const configFileName = 'config.toml';

interface Config {
  GENERAL: {
    HOSTNAME: string | null;
    PORT: number; // 3001
    SIMILARITY_MEASURE: string; // "cosine"
    TEMPERATURE: number; // 0.7
    DEFAULT_CHAT_PROVIDER: string; // ollama
    DEFAULT_CHAT_MODEL: string; // llama3.2:3b
    DEFAULT_EMBED_PROVIDER: string; // ollama
    DEFAULT_EMBED_MODEL: string; // nomic-embed-text:latest
    REDIS_URL: string; // your redis url
    REDIS_SESSION: string | null;
  };
  GROQ: {
    GROQ_API_KEY: string | null;
    // GROQ_API_ENDPOINT: string;
  };
  OPENAI: {
    OPENAI_API_KEY: string | null;
    // OPENAI_API_ENDPOINT: string;
    OPENAI_EMBED_MODELS: string;
  };
  ANTHROPIC: {
    ANTHROPIC_API_KEY: string | null;
    // ANTHROPIC_API_ENDPOINT: string;
  };
  FIREWORKSAI: {
    FIREWORKS_API_KEY: string | null;
  };
  MISTRAL: {
    MISTRAL_API_KEY: string | null;
  };
  VERTEXAI: {
    GOOGLE_APPLICATION_CREDENTIALS: string | null;
  };
  OLLAMA: {
    OLLAMA_API_KEY: string | null; // when has id, ollama config is valid
    OLLAMA_API_ENDPOINT: string;
    OLLAMA_EMBED_MODELS: string; // "nomic-embed-text;all-minilm;mxbai-embed-large"
    OLLAMA_EMBED_QPREFIX: string; // "search_query: "
    OLLAMA_EMBED_DPREFIX: string; // "search_document: "
  };
  SEARXNG: {
    SEARXNG_API_ENDPOINT: string;
  }
}

//#region MAIN
type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>;
};

const loadConfig = () =>
  toml.parse(
    fs.readFileSync(path.join(__dirname, `../${configFileName}`), 'utf-8'),
  ) as any as Config;

export const updateConfig = (config: RecursivePartial<Config>) => {
  const currentConfig = loadConfig();

  for (const key in currentConfig) {
    if (!config[key]) config[key] = {};

    if (typeof currentConfig[key] === 'object' && currentConfig[key] !== null) {
      for (const nestedKey in currentConfig[key]) {
        if (
          !config[key][nestedKey] &&
          currentConfig[key][nestedKey] &&
          config[key][nestedKey] !== ''
        ) {
          config[key][nestedKey] = currentConfig[key][nestedKey];
        }
      }
    } else if (currentConfig[key] && config[key] !== '') {
      config[key] = currentConfig[key];
    }
  }

  fs.writeFileSync(
    path.join(__dirname, `../${configFileName}`),
    toml.stringify(config),
  );
};

//#endregion

//#region GENERAL CONFIG
export const getHostname = () => NullIfEmpty(process.env.GENERAL_HOSTNAME || loadConfig().GENERAL.HOSTNAME);
export const getPort = () => Number(process.env.GENERAL_PORT || loadConfig().GENERAL.PORT);

export const getSimilarityMeasure = () => process.env.GENERAL_SIMILARITY_MEASURE || loadConfig().GENERAL.SIMILARITY_MEASURE;
export const getDefaultTemperature = () => Number(process.env.GENERAL_TEMPERATURE || loadConfig().GENERAL.TEMPERATURE) || 0.7;

export const getDefaultChatProvider = () => NullIfEmpty(process.env.DEFAULT_CHAT_PROVIDER || loadConfig().GENERAL.DEFAULT_CHAT_PROVIDER);
export const getDefaultChatModel = () => NullIfEmpty(process.env.DEFAULT_CHAT_MODEL || loadConfig().GENERAL.DEFAULT_CHAT_MODEL);
export const getDefaultEmbedProvider = () => NullIfEmpty(process.env.DEFAULT_EMBED_PROVIDER || loadConfig().GENERAL.DEFAULT_EMBED_PROVIDER);
export const getDefaultEmbedModel = () => NullIfEmpty(process.env.DEFAULT_EMBED_MODEL || loadConfig().GENERAL.DEFAULT_EMBED_MODEL);

export const getRedisUrl = () => NullIfEmpty(process.env.REDIS_URL || loadConfig().GENERAL.REDIS_URL);

//#endregion

//#region GROQ CONFIG
export const getGroqApiKey = () => NullIfEmpty(process.env.GROQ_API_KEY || loadConfig().GROQ.GROQ_API_KEY);
//#endregion

//#region OPENAI CONFIG
export const getOpenaiApiKey = () => NullIfEmpty(process.env.OPENAI_API_KEY || loadConfig().OPENAI.OPENAI_API_KEY);
export const getOpenaiEmbedModels = () => SplitString(process.env.OPENAI_EMBED_MODELS || loadConfig().OPENAI.OPENAI_EMBED_MODELS);
//#endregion

//#region ANTHROPIC CONFIG
export const getAnthropicApiKey = () => NullIfEmpty(process.env.ANTHROPIC_API_KEY || loadConfig().ANTHROPIC.ANTHROPIC_API_KEY);
//#endregion

//#region FIREWORKS AI config
export const getFireworksAIApiKey = () => NullIfEmpty(process.env.FIREWORKS_API_KEY || loadConfig().FIREWORKSAI.FIREWORKS_API_KEY);
//#endregion

//#region MISTRAL CONFIG
export const getMistralApiKey = () => NullIfEmpty(process.env.MISTRAL_API_KEY || loadConfig().MISTRAL.MISTRAL_API_KEY);
//#endregion

//#region VERTEX AI CONFIG
export const getVertexAIApiKey = () => NullIfEmpty(process.env.GOOGLE_APPLICATION_CREDENTIALS || loadConfig().VERTEXAI.GOOGLE_APPLICATION_CREDENTIALS);
//#endregion

//#region OLLAMA CONFIG
export const getOllamaApiKey = () => NullIfEmpty(process.env.OLLAMA_API_KEY || loadConfig().OLLAMA.OLLAMA_API_KEY);
export const getOllamaApiEndpoint = () => NullIfEmpty(process.env.OLLAMA_API_ENDPOINT || loadConfig().OLLAMA.OLLAMA_API_ENDPOINT);
export const getOllamaEmbedModels = () => SplitString(process.env.OLLAMA_EMBED_MODELS || loadConfig().OLLAMA.OLLAMA_EMBED_MODELS);
export const getOllamaEmbedQPrefix = () => NullIfEmpty(loadConfig().OLLAMA.OLLAMA_EMBED_QPREFIX);
export const getOllamaEmbedDPrefix = () => NullIfEmpty(loadConfig().OLLAMA.OLLAMA_EMBED_DPREFIX);

//#endregion

//#region SEARXNG CONFIG
export const getSearxngApiEndpoint = () => NullIfEmpty(process.env.SEARXNG_API_ENDPOINT || loadConfig().SEARXNG.SEARXNG_API_ENDPOINT);
//#endregion
