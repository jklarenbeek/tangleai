import { createSearxngClient } from '@tangleai/search';
import type { DiscoveryQuery, DiscoveryCandidate } from '../contracts.gen.ts';
import { researchRevisionOf } from '../identity.ts';
import { adapterInputs, providerRuntime, type ResearchProviderHost, type ResearchAdapterContext, type ScholarlyResult } from './runtime.ts';

/** Broad-web snippets are proposals only; this adapter cannot produce evidence cards. */
export async function discoverSearxng(query: DiscoveryQuery, host: ResearchProviderHost, context: ResearchAdapterContext,
  baseUrl: string): Promise<ScholarlyResult> {
  ({ query, host } = adapterInputs('searxng', query, host));
  const runtime = providerRuntime(query, host, context), candidates: DiscoveryCandidate[] = [], observations: unknown[] = [];
  let attempts = 0, reason = 'page-limit', malformed = 0;
  const hashingFetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const response = await runtime.executor.execute({ method: request.method, url: request.url, headers: Object.fromEntries(request.headers), safety: 'safe-read' }, runtime.executeContext);
    observations.push(response); attempts += response.attempts;
    if (response.state !== 'ok') { reason = response.reason; throw new Error('SearxNG provider refused.'); }
    return new Response(response.text, { status: response.status, headers: { 'content-type': 'application/json' } });
  };
  const client = createSearxngClient({ baseUrl, fetch: hashingFetch });
  try {
    for (let page = 1; page <= query.pages; page++) {
      let response;
      try { response = await client.search(query.text, { pageno: page, signal: context.signal }); }
      catch { if (reason === 'page-limit') reason = 'malformed-json'; break; }
      const rawHash = runtime.captures.at(-1)!.hash!;
      for (const result of response.results) {
        try {
          const url = new URL(result.url);
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !result.title) throw new Error('Invalid candidate.');
          const value = { queryId: query.id, title: result.title, url: url.href, snippet: result.content ?? '', rawHash };
          candidates.push({ id: 'candidate-' + await researchRevisionOf(value), ...value });
        } catch { malformed++; }
      }
      if (malformed || candidates.length > query.rows) { reason = malformed ? 'malformed-candidates' : 'row-limit'; break; }
      if (!response.results.length) { reason = 'complete'; break; }
    }
    return await runtime.finish({ state: reason === 'complete' ? 'complete' : 'incomplete', reason, attempts,
      rows: candidates.length + malformed, malformed, observations, candidates: reason === 'complete' ? candidates : [] });
  } finally { await runtime.executor.close(); }
}
