import express from 'express';
import scrapeRouter from './scrape';

const router = express.Router();
router.use('/scrape', scrapeRouter);

export default router
