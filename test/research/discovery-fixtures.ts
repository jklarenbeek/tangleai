import { readFile } from 'node:fs/promises';
import { sleep, createAttemptBudget } from '@jarenjs/core/retry';
import { createReplayTransport, type DiscoveryQuery, type ResearchTranscript, type ResearchProviderHost } from '@tangleai/research';

export const licence = { spdx: 'MIT', provenance: 'tangle-authored-synthetic', source: 'LICENSE.md' } as const;
export const query = (provider: DiscoveryQuery['provider'], text = 'kmeans-seeding', overrides: Partial<DiscoveryQuery> = {}): DiscoveryQuery =>
  ({ id: provider + '-' + text, provider, text, pages: 3, rows: 100, bytes: 262144, pageSize: 5, ...overrides });
export const adapterContext = () => ({ signal: new AbortController().signal, budget: createAttemptBudget(100), bytes: { remaining: 1048576, consumed: 0 } });
export const providerHost = (transport: ResearchProviderHost['transport'], options: Partial<ResearchProviderHost> = {}): ResearchProviderHost =>
  ({ transport, now: Date.now, sleep, random: () => 0.5, attempts: 2, overallMs: 10000, attemptMs: 5000, spacingMs: 0, licence, ...options });
export async function transcript(path: string): Promise<ResearchTranscript> {
  return JSON.parse(await readFile('benchmark/fixtures/research/literature/transcripts/paged/' + path + '.json', 'utf8'));
}
export async function providerReplay(provider: DiscoveryQuery['provider'], topic = 'kmeans-seeding') {
  const pages = provider === 'openalex' ? [0, 1, 2] : provider === 'searxng' ? [1, 2] : [0, 1];
  return createReplayTransport(await Promise.all(pages.map(page => transcript(topic + '/' + provider + '-' + page))), { scope: 'synthetic-research' });
}
