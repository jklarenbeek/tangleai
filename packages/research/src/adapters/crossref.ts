import { compileProvider } from '@jarenjs/contract/provider';
import type { DiscoveryQuery } from '../contracts.gen.ts';
import { adapterInputs, pullJsonProvider, object, text, strings, type ResearchProviderHost, type ResearchAdapterContext } from './runtime.ts';

export function discoverCrossref(query: DiscoveryQuery, host: ResearchProviderHost, context: ResearchAdapterContext) {
  ({ query, host } = adapterInputs('crossref', query, host));
  const provider = compileProvider({ $provider: '0.1', id: 'research-crossref', apiVersion: 'works-v1',
    endpoint: 'https://api.crossref.org/works', protocol: 'rest', method: 'GET', safety: 'safe-read',
    query: { query: '$.input.text', rows: '$.input.size' },
    response: { rows: '$.message.items', id: '$.DOI', cursor: '$.message["next-cursor"]', hasMore: { callback: 'more' } },
    pagination: { cursorParam: 'cursor', empty: 'complete' }, limits: { pages: query.pages, rows: query.rows, bytes: query.bytes } },
  { callbacks: { more: value => Array.isArray(value?.message?.items) && value.message.items.length >= query.pageSize } });
  return pullJsonProvider(query, host, context, provider, { text: query.text, size: query.pageSize }, value => {
    const row = object(value), parts = row.published?.['date-parts']?.[0] ?? row.issued?.['date-parts']?.[0];
    const date = Array.isArray(parts) && parts.length && parts.every(Number.isInteger)
      ? parts.map((part: number, i: number) => String(part).padStart(i === 0 ? 4 : 2, '0')).join('-') : 'unknown';
    return { canonicalIds: { doi: text(row.DOI) }, title: text(row.title?.[0]),
      authors: strings(row.author, a => text([a.given, a.family].filter(Boolean).join(' ') || a.name)), date,
      sourceUrl: row.link?.[0]?.URL || row.resource?.primary?.URL || row.URL || '' };
  });
}
