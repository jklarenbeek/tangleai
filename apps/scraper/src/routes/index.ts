import express from 'express';
import scrapeRouter from './scrape';
import searchRouter from './search';

const router = express.Router();
router.use('/scrape', scrapeRouter);
router.use('/search', searchRouter);

export default router;
