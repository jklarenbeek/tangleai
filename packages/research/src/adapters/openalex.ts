import { compileProvider } from '@jarenjs/contract/provider';
import type { DiscoveryQuery } from '../contracts.gen.ts';
import { adapterInputs, pullJsonProvider, object, text, strings, type ResearchProviderHost, type ResearchAdapterContext } from './runtime.ts';

export function discoverOpenalex(query: DiscoveryQuery, host: ResearchProviderHost, context: ResearchAdapterContext) {
  ({ query, host } = adapterInputs('openalex', query, host));
  const provider = compileProvider({ $provider: '0.1', id: 'research-openalex', apiVersion: 'works-v1',
    endpoint: 'https://api.openalex.org/works', protocol: 'rest', method: 'GET', safety: 'safe-read',
    query: { search: '$.input.text', per_page: '$.input.size' },
    response: { rows: '$.results', id: '$.id', cursor: '$.meta.next_cursor' },
    pagination: { cursorParam: 'cursor', empty: 'complete' }, limits: { pages: query.pages, rows: query.rows, bytes: query.bytes } });
  return pullJsonProvider(query, host, context, provider, { text: query.text, size: query.pageSize }, value => {
    const row = object(value);
    return { canonicalIds: { openalex: text(row.id), ...(row.doi ? { doi: text(row.doi) } : {}) },
      title: text(row.display_name), authors: strings(row.authorships, a => text(object(object(a).author).display_name)),
      date: row.publication_date || 'unknown', sourceUrl: row.primary_location?.landing_page_url || '' };
  });
}
