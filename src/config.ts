import fs from 'fs';
import path from 'path';
import toml from '@iarna/toml';

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
  OLLAMA: {
    OLLAMA_API_KEY: string | null; // when has id, ollama config is valid
    OLLAMA_API_ENDPOINT: string;
    OLLAMA_EMBED_MODELS: string; // "nomic-embed-text;all-minilm;mxbai-embed-large"
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

function isEmpty(str) {
  return (str == null) || /^\s*$/.test(str);
}


/**
 * Returns null if the input string is empty or null, otherwise returns the input string.
 * 
 * @param {string} str - The input string to check for emptiness.
 * @returns {string | null} - The input string or null.
 */
function NullIfEmpty(str) {
  return isEmpty(str) ? null : str;
}

function SplitString(str) {
  const re = /\s*(?:;|$)\s*/;
  return isEmpty(str) ? [] : str.split(re);
}

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

//#region OLLAMA CONFIG
export const getOllamaApiKey = () => NullIfEmpty(process.env.OLLAMA_API_KEY || loadConfig().OLLAMA.OLLAMA_API_KEY);
export const getOllamaApiEndpoint = () => NullIfEmpty(process.env.OLLAMA_API_ENDPOINT || loadConfig().OLLAMA.OLLAMA_API_ENDPOINT);
export const getOllamaEmbedModels = () => SplitString(process.env.OLLAMA_EMBED_MODELS || loadConfig().OLLAMA.OLLAMA_EMBED_MODELS);
//#endregion

//#region SEARXNG CONFIG
export const getSearxngApiEndpoint = () => NullIfEmpty(process.env.SEARXNG_API_ENDPOINT || loadConfig().SEARXNG.SEARXNG_API_ENDPOINT);
//#endregion
