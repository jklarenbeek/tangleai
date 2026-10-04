import type { DiscoveryQuery, LiteratureRecord } from '../contracts.gen.ts';
import { readAtomEntries } from './atom.ts';
import { normalizeLiterature } from './normalize.ts';
import { adapterInputs, providerRuntime, type ResearchProviderHost, type ResearchAdapterContext, type ScholarlyResult } from './runtime.ts';

export async function discoverArxiv(query: DiscoveryQuery, host: ResearchProviderHost, context: ResearchAdapterContext): Promise<ScholarlyResult> {
  ({ query, host } = adapterInputs('arxiv', query, host));
  const runtime = providerRuntime(query, host, context), observations: unknown[] = [], records: LiteratureRecord[] = [];
  let attempts = 0, malformed = 0, start = 0, consumed = 0, reason = 'page-limit';
  let total: number | null = null;
  const ids = new Set<string>();
  try {
    for (let page = 0; page < query.pages; page++) {
      const url = new URL('https://export.arxiv.org/api/query');
      url.searchParams.set('search_query', query.text); url.searchParams.set('start', String(start)); url.searchParams.set('max_results', String(query.pageSize));
      const response = await runtime.executor.execute({ url: url.href, method: 'GET', safety: 'safe-read' },
        { ...runtime.executeContext, maxBytes: Math.max(0, query.bytes - consumed) });
      attempts += response.attempts; consumed += response.bytes; observations.push(response);
      if (response.state !== 'ok') { reason = response.reason; break; }
      const parsed = readAtomEntries(response.text); observations.push(parsed); malformed += parsed.malformed;
      if (parsed.errors.length) { reason = 'malformed-atom'; break; }
      if (parsed.total === null || parsed.start === null || parsed.pageSize === null) { reason = 'pagination-missing'; break; }
      if (total !== null && parsed.total !== total || start + parsed.entries.length > parsed.total) { reason = 'pagination-mismatch'; break; }
      total = parsed.total;
      if (parsed.start !== null && parsed.start !== start || parsed.pageSize !== null && parsed.pageSize > query.pageSize
        || parsed.entries.length > query.pageSize) { reason = 'pagination-mismatch'; break; }
      const hash = runtime.captures.at(-1)?.hash;
      if (!hash) throw new TypeError('Native Atom page lacks captured response bytes.');
      for (const row of parsed.entries) {
        if (ids.has(row.canonicalIds.arxiv!)) { reason = 'duplicate-id'; break; }
        ids.add(row.canonicalIds.arxiv!);
        try { records.push(await normalizeLiterature(row, 'arxiv', hash, host.licence)); } catch { malformed++; }
      }
      if (reason === 'duplicate-id' || malformed) { reason = malformed ? 'malformed-records' : reason; break; }
      start += parsed.entries.length;
      if (records.length > query.rows) { reason = 'row-limit'; break; }
      if (parsed.total !== null ? start >= parsed.total : parsed.entries.length < query.pageSize) { reason = 'complete'; break; }
      if (!parsed.entries.length) { reason = 'no-progress'; break; }
    }
    return await runtime.finish({ state: reason === 'complete' ? 'complete' : 'incomplete', reason, attempts,
      rows: records.length + malformed, malformed, observations, records: reason === 'complete' ? records : [] });
  } finally { await runtime.executor.close(); }
}
