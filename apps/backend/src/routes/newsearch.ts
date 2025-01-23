import express from 'express';

import { logger } from '@tangleai/utils';

import { 
  resolveChatModelConfig,
  resolveEmbedModelConfig
} from '../lib/providers';

import { Document } from '@langchain/core/documents';

import fetchSearchQuery from '../lib/fetchers/searxng';
import fetchPlaywrightDocuments from '../lib/fetchers/playwright';
import fetchPdfDocuments from '../lib/fetchers/pdf-parse';

const router = express.Router();

interface ChatRequestBody {
  query: string;
}

router.post('/', async (req, res) => {
  try {
    const body: ChatRequestBody = req.body;
    if (!body.query) {
      return res.status(400)
        .json({ message: 'Missing query' });
    }

    const urls:Document[] = []; //TODO: ??
    await fetchSearchQuery(body.query, (name, props) => {
      console.log(`== phase1: ${name}`, props);
      if (name === 'search_success') {
        const source = props.source;
        switch(source.metadata.urlType) {
          case 'text/html':
          case 'application/pdf':
            urls.push(source);
            break;
          default:
            break;
        }
      }
    });

    // const htmlDocs = await fetchPlaywrightDocuments(htmls, (name, props) => {
    //   console.log(`== phase2:html: ${name}`, props);
    // });

    // const pdfDocs = await fetchPdfDocuments(pdfs, (name, props) => {
    //   console.log(`== phase2:pdf: ${name}`, props);
    // });

    const docs = fetchDocuments(urls, (name, props) => {
      console.log(`== phase2:url: ${name}`, props);
    });

    const chatConfig = await resolveChatModelConfig();
    const embedConfig = await resolveEmbedModelConfig();

    return res.status(200)
      .json({ sources: docs });
  }
  catch (err: any) {
    logger.error(`Error in search route: ${err.message}`);
    return res.status(500)
      .json({ message: 'An error has occurred', err: JSON.stringify(err) });
  }
});

export default router;
