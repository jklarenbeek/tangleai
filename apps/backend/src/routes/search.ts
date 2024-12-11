import express from 'express';
import { logger } from '@tangleai/utils';

import { 
  resolveChatModelConfig, 
  resolveEmbedModelConfig, 
  BaseMessage,
  HumanMessage, 
  AIMessage 
} from '../lib/providers';

import { searchHandlers } from '../websocket/messageHandler';

const router = express.Router();

interface chatModel {
  provider: string;
  model: string;
  customOpenAIBaseURL?: string;
  customOpenAIKey?: string;
}

interface embeddingModel {
  provider: string;
  model: string;
}

interface ChatRequestBody {
  optimizationMode: 'speed' | 'balanced';
  focusMode: string;
  chatModel?: chatModel;
  embeddingModel?: embeddingModel;
  query: string;
  history: Array<[string, string]>;
}

router.post('/', async (req, res) => {
  try {
    const body: ChatRequestBody = req.body;

    if (!body.query) {
      return res.status(400).json({ message: 'Missing query' });
    }

    body.focusMode = body.focusMode || 'webSearch';
    body.history = body.history || [];
    body.optimizationMode = body.optimizationMode || 'balanced';

    const history: BaseMessage[] = body.history.map((msg) => {
      if (msg[0] === 'human') {
        return new HumanMessage({
          content: msg[1],
        });
      } else {
        return new AIMessage({
          content: msg[1],
        });
      }
    });

    const chatConfig = await resolveChatModelConfig(
      body.chatModel?.provider,
      body.chatModel?.model,
      body.chatModel?.customOpenAIKey,
      body.chatModel?.customOpenAIBaseURL,
    );

    const embedConfig = await resolveEmbedModelConfig(
      body.embeddingModel?.provider,
      body.embeddingModel?.model,
    );

    const llm = chatConfig.model;
    const embeddings = embedConfig.model;

    if (chatConfig.isCustom && chatConfig.model == null) {
      return res
        .status(400)
        .json({ message: 'Missing or invalid custom OpenAI base URL or key' });
    }

    if (!llm || !embeddings) {
      return res
        .status(400)
        .json({ message: 'Invalid model selected' });
    }

    const searchHandler = searchHandlers[body.focusMode];
    if (!searchHandler) {
      return res
        .status(400)
        .json({ message: 'Invalid focus mode' });
    }

    const emitter = searchHandler(
      body.query,
      history,
      llm,
      embeddings,
      body.optimizationMode,
    );

    let message = '';
    let sources = [];

    emitter.on('data', (data) => {
      const parsedData = JSON.parse(data);
      if (parsedData.type === 'response') {
        message += parsedData.data;
      } else if (parsedData.type === 'sources') {
        sources = parsedData.data;
      }
    });

    emitter.on('end', () => {
      res.status(200).json({ message, sources });
    });

    emitter.on('error', (data) => {
      const parsedData = JSON.parse(data);
      res.status(500).json({ message: parsedData.data });
    });
  } 
  catch (err: any) {
    logger.error(`Error in getting search results: ${err.message}`);
    res.status(500).json({ message: 'An error has occurred.' });
  }
});

export default router;
