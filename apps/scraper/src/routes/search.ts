import express, { Request, Response } from 'express';
import { logger } from '@tangleai/utils';
import { searchSearxng, SearxngSearchResult } from '../utils/searxng';
import { sanitizeUrl, collapseWhitespaces } from '@tangleai/utils';

const router = express.Router();

const formatAsMarkdown = (result: SearxngSearchResult, index: number): string => {
  return `## ${index + 1}. ${result.title}
  
**URL**: [${sanitizeUrl(result.url)}](${sanitizeUrl(result.url)})  
${result.content ? `\n${collapseWhitespaces(result.content)}\n` : ''}
${result.author ? `*Author: ${result.author}*` : ''}\n`;
};

router.get('/', async (req , res) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ error: 'Missing search query parameter "q"' });
    }

    const response = await searchSearxng(query, {
      language: 'en',
      pageno: parseInt(req.query.pageno as string) || 1
    });

    if (response.err) {
      logger.error('SearXNG search failed', response.err);
      return res.status(500).json({ error: 'Failed to perform search' });
    }

    const markdownResults = response.results
      .filter(result => result.url && result.title)
      .map((result, index) => formatAsMarkdown(result, index))
      .join('\n---\n');

    res.set('Content-Type', 'text/markdown');
    res.send(markdownResults);

  } catch (error) {
    logger.error('Search route error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;