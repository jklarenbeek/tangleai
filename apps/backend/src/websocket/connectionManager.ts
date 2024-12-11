import { WebSocket } from 'ws';
import { handleMessage } from './messageHandler';
import { resolveChatModelConfig, resolveEmbedModelConfig, } from '../lib/providers';
import type { IncomingMessage } from 'http';
import { logger } from '@tangleai/utils';

export const handleConnection = async (
  ws: WebSocket,
  request: IncomingMessage,
) => {
  try {
    const searchParams = new URL(request.url, `http://${request.headers.host}`)
      .searchParams;

    const chatConfig = await resolveChatModelConfig(
      searchParams.get('chatModelProvider'),
      searchParams.get('chatModel'),
      searchParams.get('openAIApiKey'),
      searchParams.get('openAIBaseURL'),
    );
    const llm = chatConfig.model;
    if (!llm) {
      ws.send(
        JSON.stringify({
          type: 'error',
          data: 'Invalid chat model selected, please refresh the page and try again.',
          key: 'INVALID_MODEL_SELECTED',
        }),
      );
      ws.close();
      return;
    }

    const embedConfig = await resolveEmbedModelConfig(
      searchParams.get('embeddingModelProvider'),
      searchParams.get('embeddingModel'),
    );
    const embeddings = embedConfig.model;
    if (!embeddings) {
      ws.send(
        JSON.stringify({
          type: 'error',
          data: 'Invalid embeddings model selected, please refresh the page and try again.',
          key: 'INVALID_MODEL_SELECTED',
        }),
      );
      ws.close();
      return;
    }

    const interval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'signal',
            data: 'open',
          }),
        );
        clearInterval(interval);
      }
    }, 5);

    ws.on(
      'message',
      async (message) =>
        await handleMessage(message.toString(), ws, llm, embeddings),
    );

    ws.on('close', () => logger.debug('Connection closed'));
  } 
  catch (err) {
    const errstr = JSON.stringify(err, Object.getOwnPropertyNames(err))
    ws.send(
      JSON.stringify({
        type: 'error',
        data: errstr,
        key: 'INTERNAL_SERVER_ERROR',
      }),
    );
    ws.close();
    logger.error(errstr);
  }
};
