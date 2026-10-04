import { providerReplayKey, type createProviderExecutor } from '@jarenjs/contract/provider';
import { immutableResearchJson } from '../identity.ts';
import { ResearchFailure } from '../workflow-contract.ts';
import { researchIssue } from '../errors.ts';

type Transport = NonNullable<NonNullable<Parameters<typeof createProviderExecutor>[0]>['transport']>;
export interface ResearchTranscript {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body: string | null;
  response: { status: number; headers: Record<string, string>; body: string };
}
export interface ResearchReplayTransport {
  transport: Transport;
  fetch: typeof globalThis.fetch;
  /** A host may install this on another capability to detect accidental fallback. */
  networkGuard: typeof globalThis.fetch;
  stats(): { requests: number; misses: number; networkCalls: number };
}
/** One exact native request-key owner, including public headers, body and visibility scope. */
export async function createReplayTransport(transcripts: readonly ResearchTranscript[],
  options: { scope: string; maxBytes?: number }): Promise<ResearchReplayTransport> {
  const pinned = immutableResearchJson(transcripts), config = immutableResearchJson(options), entries = new Map<string, ResearchTranscript>();
  for (const entry of pinned) {
    if (!Number.isInteger(entry.response.status) || entry.response.status < 200 || entry.response.status > 599)
      throw new TypeError('Invalid replay HTTP status.');
    const key = await providerReplayKey({ method: entry.method, url: entry.url, headers: entry.headers,
      ...(entry.body === null ? {} : { body: entry.body }), safety: 'safe-read' }, config);
    if (entries.has(key)) throw new TypeError('Duplicate replay request identity.');
    entries.set(key, entry);
  }
  let requests = 0, misses = 0, networkCalls = 0;
  const transport: Transport = async (request, { signal }) => {
    signal.throwIfAborted(); requests++;
    const key = await providerReplayKey(request, config);
    signal.throwIfAborted();
    const entry = entries.get(key);
    if (!entry) { misses++; throw new ResearchFailure(researchIssue('TRSH1008', '/replay', 'No transcript matches the request.',
      { code: 'replay-miss', path: '/replay', detail: 'Offline transport has no network fallback.' })); }
    return new Response([204, 205, 304].includes(entry.response.status) ? null : entry.response.body,
      { status: entry.response.status, headers: entry.response.headers });
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
    return transport({ method: request.method, url: request.url, headers: Object.fromEntries(request.headers), body, safety: 'safe-read' },
      { signal: request.signal, attempt: 1, maxAttempts: 1 });
  };
  return { transport, fetch, networkGuard: async () => { networkCalls++; throw new Error('Research replay forbids network access.'); },
    stats: () => ({ requests, misses, networkCalls }) };
}
