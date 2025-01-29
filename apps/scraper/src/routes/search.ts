import express, { Request, Response } from 'express';

import { 
  logger,
  sanitizeUrl, 
  collapseWhitespaces, 
  isEmpty
} from '@tangleai/utils';

import { searchSearxng, SearxngSearchResult } from '../utils/searxng';
import type { SearxngCategoryOptions } from '../utils/searxng';

const router = express.Router();

const formatAsMarkdown = (result: SearxngSearchResult, index: number): string => {
  return `## ${index + 1}. ${result.title}
  
**URL**: [${sanitizeUrl(result.url)}](${sanitizeUrl(result.url)})  
${result.content ? `\n${collapseWhitespaces(result.content)}\n` : ''}
${result.author ? `*Author: ${result.author}*` : ''}\n`;
};

function sendMessage404(res: Response, message: string) {
  res.status(404).json({ message })
}

router.get('/', async (req, res) => {
  try {
    const query = req.query.q as string;
    if (isEmpty(query)) {
      sendMessage404(res, 'Missing search query parameter "q"');
      return;
    }

    const context_out = req.query.c as string;
    const context: SearxngCategoryOptions = isEmpty(req.query.c)
      ? 'general'
      : context_out as SearxngCategoryOptions;

    const language_out = req.query.l as string;
    const language = isEmpty(language_out)
      ? "en"
      : language_out;

    const response = await searchSearxng(query, {
      language,
      categories: context,
      pageno: parseInt(req.query.pageno as string) || 1
    });

    const markdownResults = response.results
      .filter(result => result.url && result.title)
      .map((result, index) => formatAsMarkdown(result, index))
      .join('\n---\n');

    res.set('Content-Type', 'text/markdown');
    res.send(markdownResults);

  } 
  catch (err: any) {
    const json = JSON.stringify(err, Object.getOwnPropertyNames(err));
    res.status(500).json({ message: 'An error has occurred.' });
    logger.error(`@tangleai/scraper:search: ${err.message}\n${json}`);
  }
});

export default router;