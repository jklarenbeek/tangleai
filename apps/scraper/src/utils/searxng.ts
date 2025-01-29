import { Document } from '@langchain/core/documents';
import XXH from 'xxhashjs';

import { getSearxngApiEndpoint } from '../config';

import type { ProgressCallback } from '@tangleai/utils'

import { 
  collapseWhitespaces, 
  sanitizeContentType, 
  sanitizeUrl 
} from '@tangleai/utils';

export interface SearxngSearchOptions {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
}

export interface SearxngSearchResult {
  title: string;
  url: string;
  img_src?: string;
  thumbnail_src?: string;
  thumbnail?: string;
  content?: string;
  author?: string;
  iframe_src?: string;
  //err?: any;
}

async function getUrlContentType(link) {
  try {
    const head = await fetch(link, {
      method: "HEAD",
      keepalive: false,
      signal: AbortSignal.timeout(1000),
    });
    
    const headers = head.headers;
    return sanitizeContentType(headers.get('content-type'));
  }
  catch(err) { };

  // some servers simply do not respond to a head request.
  // Lets do it again with a GET request.
  const get = await fetch(link, {
    method: "GET",
    keepalive: false,
    signal: AbortSignal.timeout(1000),
  });
  
  const headers = get.headers;

  return sanitizeContentType(headers.get('content-type'));
}

async function fetchResults(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok)
    throw new Error(`Error ${response.status} fetching: ${url.toString()}`);
  
  const json = await response.json();
  const results: SearxngSearchResult[] = json.results;
  const suggestions: string[] = json.suggestions;
  return { results, suggestions };
}

export async function searchSearxng(query: string, opts?: SearxngSearchOptions) {
  const searxngURL = getSearxngApiEndpoint();

  const url = new URL(`${searxngURL}/search?format=json`);
  url.searchParams.append('q', query);

  if (opts) {
    Object.keys(opts).forEach((key) => {
      if (Array.isArray(opts[key])) {
        url.searchParams.append(key, opts[key].join(','));
        return;
      }
      url.searchParams.append(key, opts[key]);
    });
  }

  return await fetchResults(url);
};

async function createSearchItemDocument(result:SearxngSearchResult) {
  const id = XXH.h64( result.url, 0xABCD ).toString(16);
  const url = sanitizeUrl(result.url);
  const type = await getUrlContentType(url);

  return new Document({
    id,
    pageContent: '',
    metadata: {
      title: result.title,
      abstract: collapseWhitespaces(result.content),
      author: result.author,
      url: url,
      urlType: type,
      error: null,
      ...(result.img_src && { img_src: result.img_src }),
    },
  });
}

export default async function fetchSearchQuery(query: string, progress: ProgressCallback, opts: SearxngSearchOptions = {}) {
  progress("search_start");

  // fetch searxng results
  const response = await searchSearxng(query, {
    language: 'en',
    ...opts
  });

  // search results to documents
  const results = response.results;
  progress("search_found", { count: results.length});

  const promises: Promise<Document>[] = [];
  for (let i = 0; i < results.length; ++i) {
    const result = results[i];
    promises.push(new Promise((resolve, reject) => {
      createSearchItemDocument(result)
        .then((document) => {
          progress("search_success", { id: document.id, source: document })
          resolve(document)
        })
        .catch((error) => {
          progress("search_error", { id: result.url, error });
          reject(error)
        });
    }));
  }

  const settled = await Promise.allSettled(promises) as {
    status: 'fulfilled' | 'rejected', 
    value: Document
  }[];

  const sources = settled
    .filter((promise) => promise.status === 'fulfilled')
    .map((promise) => promise?.value);


  const suggestions = response.suggestions;

  progress("search_end", { suggestions });

  return { sources, suggestions };
}
