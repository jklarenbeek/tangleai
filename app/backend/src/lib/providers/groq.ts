import { ChatOpenAI } from '@langchain/openai';
import { getDefaultTemperature, getGroqApiKey } from '../../config';
import logger from '../../utils/logger';

export const loadGroqChatModels = async () => {
  const groqApiKey = getGroqApiKey();

  if (!groqApiKey) return {};

  try {
    const chatModels = {
      'llama-3.2-3b-preview': {
        displayName: 'Llama 3.2 3B',
        model: new ChatOpenAI(
          {
            openAIApiKey: groqApiKey,
            modelName: 'llama-3.2-3b-preview',
            temperature: getDefaultTemperature(),
          },
          {
            baseURL: 'https://api.groq.com/openai/v1',
          },
        ),
      },
      'llama-3.2-11b-vision-preview': {
        displayName: 'Llama 3.2 11B Vision',
        model: new ChatOpenAI(
          {
            openAIApiKey: groqApiKey,
            modelName: 'llama-3.2-11b-vision-preview',
            temperature:  getDefaultTemperature(),
          },
          {
            baseURL: 'https://api.groq.com/openai/v1',
          },
        ),
      },
      'llama-3.2-90b-vision-preview': {
        displayName: 'Llama 3.2 90B Vision',
        model: new ChatOpenAI(
          {
            openAIApiKey: groqApiKey,
            modelName: 'llama-3.2-90b-vision-preview',
            temperature:  getDefaultTemperature(),
          },
          {
            baseURL: 'https://api.groq.com/openai/v1',
          },
        ),
      },
      'llama-3.1-70b-versatile': {
        displayName: 'Llama 3.1 70B',
        model: new ChatOpenAI(
          {
            openAIApiKey: groqApiKey,
            modelName: 'llama-3.1-70b-versatile',
            temperature: getDefaultTemperature(),
          },
          {
            baseURL: 'https://api.groq.com/openai/v1',
          },
        ),
      },
      'llama-3.1-8b-instant': {
        displayName: 'Llama 3.1 8B',
        model: new ChatOpenAI(
          {
            openAIApiKey: groqApiKey,
            modelName: 'llama-3.1-8b-instant',
            temperature: getDefaultTemperature(),
          },
          {
            baseURL: 'https://api.groq.com/openai/v1',
          },
        ),
      },
      'llama3-8b-8192': {
        displayName: 'LLaMA3 8B',
        model: new ChatOpenAI(
          {
            openAIApiKey: groqApiKey,
            modelName: 'llama3-8b-8192',
            temperature: getDefaultTemperature(),
          },
          {
            baseURL: 'https://api.groq.com/openai/v1',
          },
        ),
      },
      'llama3-70b-8192': {
        displayName: 'LLaMA3 70B',
        model: new ChatOpenAI(
          {
            openAIApiKey: groqApiKey,
            modelName: 'llama3-70b-8192',
            temperature: getDefaultTemperature(),
          },
          {
            baseURL: 'https://api.groq.com/openai/v1',
          },
        ),
      },
      'mixtral-8x7b-32768': {
        displayName: 'Mixtral 8x7B',
        model: new ChatOpenAI(
          {
            openAIApiKey: groqApiKey,
            modelName: 'mixtral-8x7b-32768',
            temperature: getDefaultTemperature(),
          },
          {
            baseURL: 'https://api.groq.com/openai/v1',
          },
        ),
      },
      'gemma-7b-it': {
        displayName: 'Gemma 7B',
        model: new ChatOpenAI(
          {
            openAIApiKey: groqApiKey,
            modelName: 'gemma-7b-it',
            temperature: getDefaultTemperature(),
          },
          {
            baseURL: 'https://api.groq.com/openai/v1',
          },
        ),
      },
      'gemma2-9b-it': {
        displayName: 'Gemma2 9B',
        model: new ChatOpenAI(
          {
            openAIApiKey: groqApiKey,
            modelName: 'gemma2-9b-it',
            temperature: getDefaultTemperature(),
          },
          {
            baseURL: 'https://api.groq.com/openai/v1',
          },
        ),
      },
    };

    return chatModels;
  } catch (err) {
    logger.error(`Error loading Groq models: ${err}`);
    return {};
  }
};