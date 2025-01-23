import pdfParse from 'pdf-parse/lib/pdf-parse'
import { Document } from '@langchain/core/documents';
import XXH from 'xxhashjs';

import { sanitizeContentType } from '@tangleai/utils';

export default async function fetchPdfDocument(url: string) : Promise<Document> {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Error ${response.status} fetching: ${url}`);
  
    const contentType = sanitizeContentType(response.headers.get('content-type'));
    if (contentType !== 'application/pdf')
      throw new Error(`Content Type is not 'application/pdf' @ ${url}`);
  
    const buffer = Buffer.from(await response.arrayBuffer());
    const content = await pdfParse(buffer);

    const id = XXH.h64(url, 0xABCD ).toString(16);

    const document = new Document({
      id, metadata: { url },
      pageContent: content?.text.trim(),
    });
    return document;
  }
  
  