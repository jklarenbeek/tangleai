import { loadGroqChatModels } from './groq';
import { loadOllamaChatModels, loadOllamaEmbeddingsModels } from './ollama';
import { loadOpenAIChatModels, loadOpenAIEmbeddingsModels } from './openai';
import { loadAnthropicChatModels } from './anthropic';
import { loadTransformersEmbeddingsModels } from './transformers';
import { getDefaultChatModel, getDefaultChatProvider, getDefaultEmbedModel, getDefaultEmbedProvider, getDefaultTemperature } from '../../config';

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import { ChatOpenAI } from '@langchain/openai';

export { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';

const chatModelProviders = {
  openai: loadOpenAIChatModels,
  groq: loadGroqChatModels,
  ollama: loadOllamaChatModels,
  anthropic: loadAnthropicChatModels,
};

const embeddingModelProviders = {
  openai: loadOpenAIEmbeddingsModels,
  local: loadTransformersEmbeddingsModels,
  ollama: loadOllamaEmbeddingsModels,
};

export const getAvailableChatModelProviders = async () => {
  const models = {};

  for (const provider in chatModelProviders) {
    const providerModels = await chatModelProviders[provider]();
    if (Object.keys(providerModels).length > 0) {
      models[provider] = providerModels;
    }
  }

  models['custom_openai'] = {};

  return models;
};

export const getAvailableEmbeddingModelProviders = async () => {
  const models = {};

  for (const provider in embeddingModelProviders) {
    const providerModels = await embeddingModelProviders[provider]();
    if (Object.keys(providerModels).length > 0) {
      models[provider] = providerModels;
    }
  }

  return models;
};

export const resolveChatModelConfig = async(
  defChatProvider:string|undefined, 
  defChatModel:string|undefined, 
  customApiKey:string|undefined = undefined,
  customBaseUrl:string|undefined = undefined,
) => {

  const chatProviders = await getAvailableChatModelProviders();

  const chatProviderName:string = defChatProvider
    || getDefaultChatProvider()
    || Object.keys(chatProviders)[0];

  const chatModels = chatProviders[chatProviderName];
  const chatModelName:string = defChatModel
    || getDefaultChatModel()
    || Object.keys(chatModels)[0];
  
  const isCustomChat = chatProviderName === 'custom_openai';

  const chatModel = !isCustomChat
    ? chatModels[chatModelName]?.model
    : customApiKey && customBaseUrl
      ? new ChatOpenAI({
          modelName: chatModelName,
          openAIApiKey: customApiKey,
          temperature: getDefaultTemperature(),
          configuration: {
            baseURL: customBaseUrl,
          },
        }) as unknown as BaseChatModel
      : null

  return {
    isCustom: isCustomChat,
    provider: chatProviderName,
    displayName: chatModelName,
    model: chatModel as unknown as BaseChatModel | undefined,
  };
}

export const resolveEmbedModelConfig = async(
  defEmbedProvider:string|undefined, 
  defEmbedModel:string|undefined,
) => {

  const embedProviders = await getAvailableEmbeddingModelProviders();

  const embedProviderName:string = defEmbedProvider
    || getDefaultEmbedProvider()
    || Object.keys(embedProviders)[0];

  const embedModels = embedProviders[embedProviderName];
  const embedModelName:string = defEmbedModel 
    || getDefaultEmbedModel()
    || Object.keys(embedModels)[0];
  
  const isCustomEmbed = embedProviderName === 'custom_openai';

  const embedModel = !isCustomEmbed
    ? embedModels[embedModelName]?.model
    : null;

  return {
    isCustom: isCustomEmbed,
    provider: embedProviderName,
    displayName: embedModelName,
    model: embedModel as unknown as Embeddings | undefined,
  };
}