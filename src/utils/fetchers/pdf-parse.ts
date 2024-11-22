import pdfParse from 'pdf-parse';
// import html2md from 'html2md';

import { Document } from '@langchain/core/documents';
import { sanitizeContentType } from '../tools';
import { ProgressCallback } from '../progress';

async function fetchPdfDocument(source: Document) : Promise<Document> {
  const url = source.metadata.url;
  if (source.metadata.urlType !== 'application/pdf')
      throw new Error(`urlType is not a PDF source @ ${url}`);

    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Error ${response.status} fetching: ${url}`);
  
    const contentType = sanitizeContentType(response.headers.get('content-type'));
    if (contentType !== 'application/pdf')
      throw new Error(`Content Type is not 'application/pdf' @ ${url}`);
  
    const buffer = Buffer.from(await response.arrayBuffer());
  
    const content = (await pdfParse(buffer)).text.trim();
    source.pageContent = content;
    return source;
  }
  
export default async function fetchPdfDocuments(sources: Document[], progress: ProgressCallback) : Promise<Document[]> {
  progress("fetch_start", { count: sources.length });

  const promises: Promise<Document>[] = [];
  for (let i = 0; i < sources.length; ++i) {
    const source = sources[i];
    promises.push(new Promise((resolve, reject) => {
      fetchPdfDocument(source)
        .then((document) => {
          progress("fetch_success", { id: source.id })
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

  progress("fetch_end");

  return result;
}
  