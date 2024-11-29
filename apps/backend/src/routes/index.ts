import express from 'express';
import imagesRouter from './images';
import videosRouter from './videos';
import configRouter from './config';
import suggestionsRouter from './suggestions';
import chatsRouter from './chats';
import searchRouter from './search';
import newSearchRouter from './newsearch';
import factRouter from './factcheck';
import discoverRouter from './discover';

const router = express.Router();

router.use('/images', imagesRouter);
router.use('/videos', videosRouter);
router.use('/config', configRouter);
router.use('/suggestions', suggestionsRouter);
router.use('/chats', chatsRouter);
router.use('/search', searchRouter);
router.use('/newsearch', newSearchRouter);
router.use('/factcheck', factRouter);
router.use('/discover', discoverRouter);

export default router;
