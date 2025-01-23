import type { Browser, BrowserContext, Page } from 'playwright-chromium'

import { Document } from '@langchain/core/documents';
import XXH from 'xxhashjs';

import { NodeHtmlMarkdown } from 'node-html-markdown';

import { compressMarkdown, logger } from '@tangleai/utils';
import { sanitizeHtml } from './cheerio';

async function newPage(context: BrowserContext) {
  const page = await context.newPage();
  // make it a printable page
  page.emulateMedia({ media: "print" });
  page.setViewportSize({ width: 600, height: 400 });

  // abort all unnecessary requests
  await page.route('**/*.{png,jpg,jpeg,webp,gif,ico,svg}', route => route.abort());
  await page.route('**/*.{woff, woff2}', (route) => route.abort());
  //await page.route('**/*.{css}', (route) => route.abort());

  page.on('download', async (download) => {
    // we cancel all downloads!
    await download.cancel();
  });

  return page;
}

async function closePage(page:Page) {
  try {
    if (!page.isClosed()) {
      await page.close()
    }
  }
  catch(_) {
    logger.debug('@tangleai/scraper:playwright:page:already closed');
  }
}

export default async function fetchHtmlDocument(url: string, context: BrowserContext, selector?: string): Promise<Document> {

  const page = await newPage(context);

  try {
    // Wait until every resource is loaded and the network is silent for 500ms.
    const response = await page.goto(url, { waitUntil: "load" /*, timeout: 10_000 */ });

    //const contentType = sanitizeContentType((await response.headerValue("content-type")) || "")
    //if (contentType !== 'text/html')
    //  throw new Error(`Content-Type not supported: ${contentType} @ ${url}`);

    const content = await page.content();
    const sanitized = sanitizeHtml(content, selector);

    const id = XXH.h64(url, 0xABCD).toString(16);
    const html = sanitized.html;
    const md = compressMarkdown(NodeHtmlMarkdown.translate(html));
    const links = sanitized.links;
    
    return new Document({ id, metadata: { url, links }, pageContent: md });
  }
  finally {
    closePage(page);
  }
}
