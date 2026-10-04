import { compileProvider } from '@jarenjs/contract/provider';
import type { DiscoveryQuery } from '../contracts.gen.ts';
import { adapterInputs, pullJsonProvider, object, text, strings, type ResearchProviderHost, type ResearchAdapterContext } from './runtime.ts';
import { normalizeArxiv } from './normalize.ts';

export function discoverSemanticScholar(query: DiscoveryQuery, host: ResearchProviderHost, context: ResearchAdapterContext) {
  ({ query, host } = adapterInputs('semanticscholar', query, host));
  const provider = compileProvider({ $provider: '0.1', id: 'research-semanticscholar', apiVersion: 'graph-v1',
    endpoint: 'https://api.semanticscholar.org/graph/v1/paper/search', protocol: 'rest', method: 'GET', safety: 'safe-read',
    query: { query: '$.input.text', limit: '$.input.size', fields: '$.input.fields' },
    response: { rows: '$.data', id: '$.paperId', cursor: '$.next' },
    pagination: { cursorParam: 'offset', empty: 'complete' }, limits: { pages: query.pages, rows: query.rows, bytes: query.bytes } });
  return pullJsonProvider(query, host, context, provider, { text: query.text, size: query.pageSize,
    fields: 'title,authors,publicationDate,externalIds,url,openAccessPdf' }, value => {
    const row = object(value), ids = row.externalIds ?? {};
    return { canonicalIds: { s2: text(row.paperId), ...(ids.DOI ? { doi: text(ids.DOI) } : {}),
      ...(ids.ArXiv ? normalizeArxiv(text(ids.ArXiv)) : {}) }, title: text(row.title),
      authors: strings(row.authors, a => text(object(a).name)), date: row.publicationDate || 'unknown',
      sourceUrl: row.openAccessPdf?.url || row.url || '' };
  });
}
