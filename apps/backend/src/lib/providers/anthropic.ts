import { ChatAnthropic } from '@langchain/anthropic';
import { getAnthropicApiKey, getDefaultTemperature } from '../../config';
import { logger } from '@tangleai/utils';

export const loadAnthropicChatModels = async () => {
  const anthropicApiKey = getAnthropicApiKey();

  if (!anthropicApiKey) return {};

  try {
    const chatModels = {
      'claude-3-5-sonnet-20240620': {
        displayName: 'Claude 3.5 Sonnet',
        model: new ChatAnthropic({
          temperature: getDefaultTemperature(),
          anthropicApiKey: anthropicApiKey,
          model: 'claude-3-5-sonnet-20240620',
        }),
      },
      'claude-3-opus-20240229': {
        displayName: 'Claude 3 Opus',
        model: new ChatAnthropic({
          temperature: getDefaultTemperature(),
          anthropicApiKey: anthropicApiKey,
          model: 'claude-3-opus-20240229',
        }),
      },
      'claude-3-sonnet-20240229': {
        displayName: 'Claude 3 Sonnet',
        model: new ChatAnthropic({
          temperature: getDefaultTemperature(),
          anthropicApiKey: anthropicApiKey,
          model: 'claude-3-sonnet-20240229',
        }),
      },
      'claude-3-haiku-20240307': {
        displayName: 'Claude 3 Haiku',
        model: new ChatAnthropic({
          temperature: getDefaultTemperature(),
          anthropicApiKey: anthropicApiKey,
          model: 'claude-3-haiku-20240307',
        }),
      },
    };

    return chatModels;
  } catch (err) {
    logger.error(`Error loading Anthropic models: ${err}`);
    return {};
  }
};
