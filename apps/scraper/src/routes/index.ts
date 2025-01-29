import express from 'express';
import scrapeRouter from './scrape';
import searchRouter from './search';

const router = express.Router();
router.use('/api/scrape', scrapeRouter);
router.use('/api/search', searchRouter);

export default router;
