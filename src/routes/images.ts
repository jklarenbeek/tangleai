import express from 'express';
import logger from '../utils/logger';

import { 
  resolveChatModelConfig, 
  HumanMessage, 
  AIMessage 
} from '../lib/providers';

import handleImageSearch from '../agents/imageSearchAgent';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    let { query, chat_history, chat_model_provider, chat_model } = req.body;

    chat_history = chat_history.map((msg: any) => {
      if (msg.role === 'user') {
        return new HumanMessage(msg.content);
      } else if (msg.role === 'assistant') {
        return new AIMessage(msg.content);
      }
    });

    const chatConfig = await resolveChatModelConfig(
      chat_model_provider,
      chat_model,
    );

    const llm = chatConfig.model;
    if (!llm) {
      res.status(500).json({ message: 'Invalid LLM model selected' });
      return;
    }

    const images = await handleImageSearch({ query, chat_history }, llm);

    res.status(200).json({ images });
  } catch (err) {
    res.status(500).json({ message: 'An error has occurred.' });
    logger.error(`Error in image search: ${err.message}`);
  }
});

export default router;
