import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { getDefaultTemperature, getOpenaiApiKey } from '../../config';
import { logger } from '@tangleai/utils';

export const loadOpenAIChatModels = async () => {
  const openAIApiKey = getOpenaiApiKey();

  if (!openAIApiKey) return {};

  try {
    const chatModels = {
      'gpt-3.5-turbo': {
        displayName: 'GPT-3.5 Turbo',
        model: new ChatOpenAI({
          openAIApiKey,
          modelName: 'gpt-3.5-turbo',
          temperature: getDefaultTemperature(),
        }),
      },
      'gpt-4': {
        displayName: 'GPT-4',
        model: new ChatOpenAI({
          openAIApiKey,
          modelName: 'gpt-4',
          temperature: getDefaultTemperature(),
        }),
      },
      'gpt-4-turbo': {
        displayName: 'GPT-4 turbo',
        model: new ChatOpenAI({
          openAIApiKey,
          modelName: 'gpt-4-turbo',
          temperature: getDefaultTemperature(),
        }),
      },
      'gpt-4o': {
        displayName: 'GPT-4 omni',
        model: new ChatOpenAI({
          openAIApiKey,
          modelName: 'gpt-4o',
          temperature: getDefaultTemperature(),
        }),
      },
      'gpt-4o-mini': {
        displayName: 'GPT-4 omni mini',
        model: new ChatOpenAI({
          openAIApiKey,
          modelName: 'gpt-4o-mini',
          temperature: getDefaultTemperature(),
        }),
      },
    };

    return chatModels;
  } catch (err) {
    logger.error(`Error loading OpenAI models: ${err}`);
    return {};
  }
};

export const loadOpenAIEmbeddingsModels = async () => {
  const openAIApiKey = getOpenaiApiKey();

  if (!openAIApiKey) return {};

  try {
    const embeddingModels = {
      'text-embedding-3-small': {
        displayName: 'Text Embedding 3 Small',
        model: new OpenAIEmbeddings({
          openAIApiKey,
          modelName: 'text-embedding-3-small',
        }),
      },
      'text-embedding-3-large': {
        displayName: 'Text Embedding 3 Large',
        model: new OpenAIEmbeddings({
          openAIApiKey,
          modelName: 'text-embedding-3-large',
        }),
      },
    };

    return embeddingModels;
  } catch (err) {
    logger.error(`Error loading OpenAI embeddings model: ${err}`);
    return {};
  }
};
