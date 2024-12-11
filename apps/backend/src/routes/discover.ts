import express from 'express';
import { searchSearxng } from '../lib/fetchers/searxng';
import { logger } from '@tangleai/utils';

const router = express.Router();

async function fetchAllNews() {
  return await Promise.all([
    searchSearxng('site:businessinsider.com AI', {
      engines: ['news'],
      pageno: 1,
    }),
    searchSearxng('site:www.exchangewire.com AI', {
      engines: ['news'],
      pageno: 1,
    }),
    searchSearxng('site:yahoo.com AI', {
      engines: ['news'],
      pageno: 1,
    }),
    searchSearxng('site:businessinsider.com tech', {
      engines: ['news'],
      pageno: 1,
    }),
    searchSearxng('site:www.exchangewire.com tech', {
      engines: ['news'],
      pageno: 1,
    }),
    searchSearxng('site:yahoo.com tech', {
      engines: ['news'],
      pageno: 1,
    }),
  ])
}

router.get('/', async (req, res) => {
  try {
    const data = (await fetchAllNews())
      .map((query) => query.results)
      .flat()
      .sort(() => Math.random() - 0.5);

    return res.json({ blogs: data });
  } 
  catch (err: any) {
    logger.error(`Error in discover route: ${err.message}`);
    return res.status(500).json({ message: 'An error has occurred', err });
  }
});

export default router;
