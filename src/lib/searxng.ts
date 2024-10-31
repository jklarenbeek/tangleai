import { getSearxngApiEndpoint } from '../config';

interface SearxngSearchOptions {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
}

interface SearxngSearchResult {
  title: string;
  url: string;
  img_src?: string;
  thumbnail_src?: string;
  thumbnail?: string;
  content?: string;
  author?: string;
  iframe_src?: string;
}

export const searchSearxng = async (
  query: string,
  opts?: SearxngSearchOptions,
) => {
  const searxngURL = getSearxngApiEndpoint();

  try {
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

    const surl = url.toString();
    const response = await fetch(surl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok)
      throw new Error(`Error ${response.status} fetching: ${surl}`);
    
    const json = await response.json();

    const results: SearxngSearchResult[] = json.results;
    const suggestions: string[] = json.suggestions;
    return { results, suggestions };
  }
  catch(err) {
    return { err };
  }
};
