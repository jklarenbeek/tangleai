/** Explicit opt-in public metadata capture. Never invoked by a fixture or release gate. */
import { readFile, writeFile } from 'node:fs/promises';
import { createProviderExecutor, providerReplayKey } from '@jarenjs/contract/provider';
import { readBoundedResponseBytes } from '@tangleai/documents/fetch';
import type { ResearchTranscript } from '@tangleai/research';

const [approval, input, output, ...extra] = process.argv.slice(2);
if (approval !== '--approved-live-capture' || !input || !output || extra.length)
  throw new Error('Usage: research-transcripts.ts --approved-live-capture requests.json capture.json. Obtain live-tier approval before invocation.');
const requests: Array<{ url: string }> = JSON.parse(await readFile(input, 'utf8'));
const hosts = new Set(['api.openalex.org', 'api.crossref.org', 'api.semanticscholar.org', 'export.arxiv.org']);
if (!Array.isArray(requests) || !requests.length || requests.length > 32) throw new Error('Capture requires 1–32 requests.');
for (const request of requests) {
  if (Object.keys(request).some(key => key !== 'url')) throw new Error('Only public request URLs are accepted.');
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port) throw new Error('Unregistered scholarly endpoint.');
  await providerReplayKey({ url: request.url, method: 'GET', safety: 'safe-read' }, { scope: 'approved-public-metadata' });
}
let remaining = 4 * 1024 * 1024;
const captured: ResearchTranscript[] = [], outcomes: unknown[] = [];
const executor = createProviderExecutor({ attempts: 1, concurrency: 1, spacingMs: 3000, maxBytes: 262144, transport: async (request, context) => {
  const response = await fetch(request.url, { method: 'GET', redirect: 'manual', signal: context.signal });
  const bytes = await readBoundedResponseBytes(response, Math.min(262144, remaining), count => { remaining -= count; }, context.signal);
  const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes), headers = Object.fromEntries(['content-type', 'retry-after', 'etag', 'last-modified']
    .flatMap(key => response.headers.has(key) ? [[key, response.headers.get(key)!]] : []));
  captured.push({ method: 'GET', url: request.url, body: null, response: { status: response.status, headers, body } });
  return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, headers });
} });
try {
  for (const request of requests) {
    if (remaining <= 0) break;
    outcomes.push(await executor.execute({ ...request, method: 'GET', safety: 'safe-read' }));
  }
  // A new private output file is explicit. This never edits the registered synthetic fixture or its MIT grant.
  await writeFile(output, JSON.stringify({ provenance: 'provider-metadata', licence: 'unasserted', transcripts: captured, outcomes }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
} finally { await executor.close(); }
