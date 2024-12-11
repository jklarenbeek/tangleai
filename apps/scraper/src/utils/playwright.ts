import type { Browser, BrowserContext, Page } from 'playwright-chromium'

import { NodeHtmlMarkdown } from 'node-html-markdown';

import { isEmpty, logger } from '@tangleai/utils';
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
    logger.error('@tangleai/scraper:playwright:closing page, already closed');
  }
}

export default async function fetchHtmlDocument(url: string, context: BrowserContext, selector?: string): Promise<any> {

  const page = await newPage(context);

  try {
    // Wait until every resource is loaded and the network is silent for 500ms.
    const response = await page.goto(url, { waitUntil: "load" /*, timeout: 10_000 */ });

    //const contentType = sanitizeContentType((await response.headerValue("content-type")) || "")
    //if (contentType !== 'text/html')
    //  throw new Error(`Content-Type not supported: ${contentType} @ ${url}`);

    const content = await page.content();
    const sanitized = sanitizeHtml(content, selector);
    return (isEmpty(sanitized.html))
      ? null
      : {
        metadata: { url, links: sanitized.links },
        pageContent: NodeHtmlMarkdown.translate(sanitized.html)
      };
  }
  finally {
    closePage(page);
  }
}
