import express, { Response } from 'express';
import { isEmpty, logger } from '@tangleai/utils';
import { BrowserContext } from 'playwright-chromium';
import fetchHtmlDocument from '../utils/playwright';
import fetchPdfDocument from '../utils/pdf-parse';

const router = express.Router();

function sendMessage404(res: Response, message: string) {
  res.status(404).json({ message })
}

router.get('/', async (req, res) => {
  try {
    const url = req.query.url as string;
    if (isEmpty(url)) {
      sendMessage404(res, "url cannot be empty");
      return;
    }

    const kind = req.query.kind as string;
    if (isEmpty(kind)) {
      sendMessage404(res, "kind cannot be empty");
      return;
    }

    logger.info(`@tangleai/scraper:fetching:${kind}:${url}`);
    
    switch(kind) {
      case 'text/html': {
        const context = res.locals.browserContext as BrowserContext;
        if (!context)
          throw new Error('Locals BrowserContext is empty!');
        
        res.send(await fetchHtmlDocument(url, context));
        break;
      }
      case 'application/pdf':
        res.send(await fetchPdfDocument(url));
        break;
      default: {
        sendMessage404(res, `unknown type: ${kind}`);
        return;
      }
    }
    
  } 
  catch (err: any) {
    const json = JSON.stringify(err, Object.getOwnPropertyNames(err));
    res.status(500).json({ message: 'An error has occurred.' });
    logger.error(`@tangleai/scraper:scrape: ${err.message}\n${json}`);
  }
});

export default router;
