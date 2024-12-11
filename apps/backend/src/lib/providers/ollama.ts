import { ChatOllama } from '@langchain/ollama';
import { OllamaEmbeddings } from '@langchain/ollama';

import { getDefaultTemperature, getOllamaApiEndpoint, getOllamaEmbedModels } from '../../config';
import { logger } from '@tangleai/utils';

const removeModelVersion = (name: string) => name.lastIndexOf(':') > 0
  ? name.substring(0, name.lastIndexOf(':'))
  : name;

const removeModelVersions = (arr: string[]) => arr.map((value) => removeModelVersion(value));

export const loadOllamaChatModels = async () => {
  const ollamaEndpoint = getOllamaApiEndpoint();
  const ollamaDefEmbeds = removeModelVersions(getOllamaEmbedModels());

  if (!ollamaEndpoint) return {};

  try {
    const response = await fetch(`${ollamaEndpoint}/api/tags`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const { models: ollamaModels } = (await response.json()) as any;

    const chatModels = ollamaModels.reduce((acc, model) => {
      if (!ollamaDefEmbeds.includes(removeModelVersion(model.name))) {
        acc[model.model] = {
          displayName: model.name,
          model: new ChatOllama({
            baseUrl: ollamaEndpoint,
            model: model.model,
            temperature: getDefaultTemperature(),
          }),
        };
      }

      return acc;
    }, {});

    return chatModels;
  } catch (err) {
    logger.error(`Error loading Ollama models: ${err}`);
    return {};
  }
};

export const loadOllamaEmbeddingsModels = async () => {
  const ollamaEndpoint = getOllamaApiEndpoint();
  const ollamaDefEmbeds = removeModelVersions(getOllamaEmbedModels());
  
  if (!ollamaEndpoint) return {};

  try {
    const response = await fetch(`${ollamaEndpoint}/api/tags`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const { models: ollamaModels } = (await response.json()) as any;

    const embeddingsModels = ollamaModels.reduce((acc, model) => {

      if (ollamaDefEmbeds.includes(removeModelVersion(model.name))) {
        acc[model.model] = {
          displayName: model.name,
          model: new OllamaEmbeddings({
            baseUrl: ollamaEndpoint,
            model: model.model,
          }),
        };
      }

      return acc;
    }, {});

    return embeddingsModels;
  } catch (err) {
    logger.error(`Error loading Ollama embeddings model: ${err}`);
    return {};
  }
};
