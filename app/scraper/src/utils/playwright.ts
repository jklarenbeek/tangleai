import type { Browser, BrowserContext } from 'playwright'
import { chromium } from 'playwright-chromium';

import { NodeHtmlMarkdown } from 'node-html-markdown';

import { Document } from '@langchain/core/documents';
import { isEmpty, sanitizeContentType } from '@tangleai/utils';
import { sanitizeHtml } from './cheerio';


export default async function fetchHtmlDocument(url: string, context: BrowserContext, selector?: string) : Promise<string> {

  const page = await context.newPage();

  try {
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

    // Wait until every resource is loaded and the network is silent for 500ms.
    const response = await page.goto(url, { waitUntil: "load" /*, timeout: 10_000 */});

    //const contentType = sanitizeContentType((await response.headerValue("content-type")) || "")
    //if (contentType !== 'text/html')
    //  throw new Error(`Content-Type not supported: ${contentType} @ ${url}`);

    const content = await page.content();
    const sanitized = sanitizeHtml(content, selector);
    return (isEmpty(sanitized.html))
      ? null
      : NodeHtmlMarkdown.translate(sanitized.html);
  }
  finally {
    if (!page.isClosed())
      await page.close()
  }
}
