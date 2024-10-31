import express from 'express';

import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '../lib/providers';

import {
  getGroqApiKey,
  getOllamaApiEndpoint,
  getAnthropicApiKey,
  getOpenaiApiKey,
  updateConfig,
  getDefaultTemperature,
  getDefaultChatProvider,
  getDefaultChatModel,
  getDefaultEmbedProvider,
  getDefaultEmbedModel,
  getSimilarityMeasure,
} from '../config';

import logger from '../utils/logger';

const router = express.Router();

router.get('/', async (_, res) => {
  try {
    const config = {};

    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);

    config['chatModelProviders'] = {};
    config['embeddingModelProviders'] = {};

    for (const provider in chatModelProviders) {
      config['chatModelProviders'][provider] = Object.keys(
        chatModelProviders[provider],
      ).map((model) => {
        return {
          name: model,
          displayName: chatModelProviders[provider][model].displayName,
        };
      });
    }

    for (const provider in embeddingModelProviders) {
      config['embeddingModelProviders'][provider] = Object.keys(
        embeddingModelProviders[provider],
      ).map((model) => {
        return {
          name: model,
          displayName: embeddingModelProviders[provider][model].displayName,
        };
      });
    }

    config['openaiApiKey'] = getOpenaiApiKey();
    config['ollamaApiUrl'] = getOllamaApiEndpoint();
    config['anthropicApiKey'] = getAnthropicApiKey();
    config['groqApiKey'] = getGroqApiKey();

    config['generalSettings'] = {
      similarityMeasure: getSimilarityMeasure(),
      temperature: getDefaultTemperature(),
      defaultChatProvider: getDefaultChatProvider(),
      defaultChatModel: getDefaultChatModel(),
      defaultEmbedProvider: getDefaultEmbedProvider(),
      defaultEmbedModel: getDefaultEmbedModel(),
    };

    res.status(200).json(config);
  } catch (err: any) {
    res.status(500).json({ message: 'An error has occurred.' });
    logger.error(`Error getting config: ${err.message}`);
  }
});

router.post('/', async (req, res) => {
  const config = req.body;

  const updatedConfig = {
    GROQ: {
      GROQ_API_KEY: config.groqApiKey,
    },
    OPENAI: {
      OPENAI_API_KEY: config.openaiApiKey,
    },
    ANTHROPIC: {
      ANTHROPIC_API_KEY: config.anthropicApiKey,
    },
    OLLAMA: {
      OLLAMA_API_ENDPOINT: config.ollamaApiUrl,
    },
  };

  updateConfig(updatedConfig);

  res.status(200).json({ message: 'Config updated' });
});

export default router;
