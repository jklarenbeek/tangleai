import type { Browser, BrowserContext } from 'playwright'
import { firefox } from 'playwright'

import { NodeHtmlMarkdown } from 'node-html-markdown';

import { Document } from '@langchain/core/documents';
import { isEmpty, sanitizeContentType } from '../../utils/tools';
import { ProgressCallback } from '../../utils/progress';
import { sanitizeHtml } from './cheerio';
import { estimateTokens } from '../../utils/similarity';


async function fetchPlaywrightDocument(source: Document, context: BrowserContext, selector?: string) : Promise<Document> {
  const url = source.metadata.url;

  const page = await context.newPage();
  try {
    // make it a printable page
    page.emulateMedia({ media: "print" });

    // abort all unnecessary requests
    await page.route('**/*.{png,jpg,jpeg,webp,gif,ico,svg}', route => route.abort());
    await page.route('**/*.{woff, woff2}', (route) => route.abort());
    //await page.route('**/*.{css}', (route) => route.abort());

    page.on('download', async (download) => {
      console.log(`+++ CANCELLED: ${download.url()}`);
      await download.cancel();
    });

    // Wait until every resource is loaded and the network is silent for 500ms.
    const response = await page.goto(url, { waitUntil: "load" /*, timeout: 10_000 */});

    //const contentType = sanitizeContentType((await response.headerValue("content-type")) || "")
    //if (contentType !== 'text/html')
    //  throw new Error(`Content-Type not supported: ${contentType} @ ${url}`);

    const content = await page.content();
    const sanitized = sanitizeHtml(content, selector);
    if (isEmpty(sanitized.html))
      throw new Error(`Document is empty @ ${url}`);

    const markdown = NodeHtmlMarkdown.translate(sanitized.html);
    source.pageContent = markdown;

    return source;
  }
  finally {
    if (!page.isClosed())
      await page.close()
  }

}

export default async function fetchPlaywrightDocuments(sources: Document[], progress: ProgressCallback, selector?: string) {
  progress("fetch_start", { count: sources.length });

  const browser = await firefox.launch({
    headless: true,
  });
  const context = await browser.newContext(/*{ acceptDownloads:false} */);

  const promises: Promise<Document>[] = [];
  for (let i = 0; i < sources.length; ++i) {
    const source = sources[i];
    promises.push(new Promise((resolve, reject) => {
      fetchPlaywrightDocument(source, context, selector)
        .then((document) => {
          const estimate = estimateTokens(document.pageContent);
          document.metadata.estimateTokens = estimate;
          progress("fetch_success", { id: source.id, count: estimate });
          resolve(document)
        })
        .catch((error) => {
          source.metadata.error = error;
          progress("fetch_error", { id: source.id, error });
          reject(error)
        });
    }));
  }

  const settled = await Promise.allSettled(promises) as {
    status: 'fulfilled' | 'rejected', 
    value: Document
  }[];

  const result = settled
    .filter((promise) => promise.status === 'fulfilled')
    .map((promise) => promise?.value);

  if (context) {
    await context.close()
  }

  if (browser) {
    await browser.close()
  }

  progress("fetch_end");

  return result;
}
