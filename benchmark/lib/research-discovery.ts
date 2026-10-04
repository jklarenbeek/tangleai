/** Offline scholarly discovery through native document and provider owners. Gold is scorer-only. */
import { sleep } from '@jarenjs/core/retry';
import { createDocumentIngester, SafeStaticFetcher, readBoundedResponseBytes } from '@tangleai/documents';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createDocumentStore, type TangleDb } from '@tangleai/store';
import { createInclusionCriteria, createQueryPlan, createReplayTransport, discoveryRevisionOf, researchArtifactIdOf, resolveEvidenceCard,
  type ResearchTranscript, type ResearchDiscoveryOptions, type ResearchSnapshot, type DiscoveryReceipt } from '@tangleai/research';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { ResearchFixtureTopic } from './research.types.ts';
import { researchScore } from './research-oracle.ts';

export async function researchDiscoveryConfiguration(topic: ResearchFixtureTopic) {
  const criteria = await createInclusionCriteria({ reviewer: 'scripted-title-date-v1', titleTerms: [topic.id],
    dateFrom: '2026-01-01', dateTo: '2026-12-31', requireSource: true });
  const plan = await createQueryPlan({ projectId: topic.contract.projectId, criteriaId: criteria.id,
    queries: (['openalex', 'crossref', 'semanticscholar', 'arxiv', 'searxng'] as const).map(provider =>
      ({ id: topic.id + '-' + provider, provider, text: topic.id, pages: 3, rows: 32, bytes: 262144, pageSize: 5 })),
    concurrency: 4, maxRequests: 32, maxBytes: 1048576 });
  const data = { plan, criteria, acquisition: { sources: 16, bytes: 1048576, cards: 128 },
    extractionPromptRevision: 'e'.repeat(64), searxngBaseUrl: 'https://search.fixture.invalid' };
  return { ...data, revision: await discoveryRevisionOf(data) };
}
export async function createResearchDiscoveryFixture(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic, db: TangleDb,
  beforeRequest?: () => Promise<void>) {
  const configuration = await researchDiscoveryConfiguration(topic), { revision, ...data } = configuration;
  const transcripts: ResearchTranscript[] = [...loaded.files].filter(([path]) => path.startsWith('literature/transcripts/paged/' + topic.id + '/'))
    .map(([, bytes]) => JSON.parse(new TextDecoder().decode(bytes)));
  const agent = 'TangleAI-Research-Fixture/1', headers = { 'user-agent': agent,
    accept: 'text/html,application/xhtml+xml,application/pdf,text/markdown,text/plain;q=0.9,*/*;q=0.1' };
  // These bodies are already registered source members; no extra mutable capture is consulted.
  for (const [path, bytes] of loaded.files) if (path.startsWith('sources/')) transcripts.push({ method: 'GET', url: 'https://fixture.invalid/' + path,
    headers, body: null, response: { status: 200, headers: { 'content-type': 'text/markdown' }, body: new TextDecoder().decode(bytes) } });
  transcripts.push({ method: 'GET', url: 'https://fixture.invalid/robots.txt', headers: { 'user-agent': agent, accept: 'text/plain' }, body: null,
    response: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' } });
  const replay = await createReplayTransport(transcripts, { scope: 'authored-synthetic-research-v1' }), retained = new Map<string, Uint8Array>();
  let documentBytes = 0;
  const fetcher = new SafeStaticFetcher({ fetch: async (input, init) => {
    await beforeRequest?.();
    const response = await replay.fetch(input, init), bytes = await readBoundedResponseBytes(response, data.acquisition.bytes, undefined, init?.signal ?? undefined);
    retained.set((await researchArtifactIdOf(bytes)).slice(4), bytes);
    return new Response(new Uint8Array(bytes), { status: response.status, headers: response.headers });
  }, lookup: async () => [{ address: '93.184.216.34', family: 4 }], now: () => '2026-01-01T00:00:00.000Z', termsPolicy: url => new URL(url).hostname === 'fixture.invalid',
  schedule: { now: () => 0, sleep },
  limits: { maxBytes: data.acquisition.bytes, maxCompressedBytes: data.acquisition.bytes, perHostDelayMs: 0, userAgent: agent },
  onBytesRead: count => { documentBytes += count; if (documentBytes > data.acquisition.bytes) throw new Error('Aggregate fixture source budget exhausted.'); } });
  const store = createDocumentStore(db), ingester = createDocumentIngester({ store, fetcher, embedder: createHashEmbedder({ dims: 64 }),
    now: () => '2026-01-01T00:00:00.000Z' });
  const options: ResearchDiscoveryOptions = { ...data, provider: { transport: async (request, context) => {
    await beforeRequest?.(); return replay.transport(request, context);
  }, now: () => 0, sleep, random: () => 0.5, attempts: 2, overallMs: 10000, attemptMs: 5000, spacingMs: 0, licence: loaded.manifest.licence },
  documents: { ingester, store, readSourceBytes: async (version, signal) => {
    signal.throwIfAborted(); const bytes = retained.get(version.contentHash); if (!bytes) throw Error('Missing retained source body.'); return new Uint8Array(bytes);
  } } };
  return { options, replay, store, retained, revision, close: () => fetcher.close(),
    async measure(snapshot: ResearchSnapshot) {
      const receipt = snapshot.records.find(r => r.kind === 'DiscoveryReceipt')?.value as DiscoveryReceipt | undefined;
      if (!receipt) throw Error('Native discovery receipt missing.');
      const literature = snapshot.records.filter(r => r.kind === 'LiteratureRecord').map(r => r.value);
      const screening = snapshot.records.filter(r => r.kind === 'ScreeningDecision').map(r => r.value);
      const cards = snapshot.records.filter(r => r.kind === 'EvidenceCard').map(r => r.value);
      const acquisitions = snapshot.records.filter(r => r.kind === 'SourceAcquisition').map(r => r.value);
      const selected = literature.filter(r => screening.some(s => s.literatureId === r.id && s.decision === 'keep'));
      // The evaluator maps canonical identifiers to the frozen gold ids after execution has finished.
      const gold = new Set(loaded.hidden.get(topic.id)!.relevantLiterature), matched = selected.filter(r => {
        const original = loaded.literature.find(old => old.canonicalIds.doi === r.canonicalIds.doi || old.canonicalIds.arxiv === r.canonicalIds.arxiv);
        return original && gold.has(original.id);
      });
      let resolvable = 0;
      for (const card of cards) if ((await resolveEvidenceCard(card, store, async id => retained.get(id.slice(4))!)).valid) resolvable++;
      return { topicId: topic.id, receipt, literature, screening, acquisitions, evidence: cards,
        literatureRecall: researchScore(matched.length, gold.size), literaturePrecision: researchScore(matched.length, selected.length),
        absentRelevant: [...gold].filter(id => !loaded.literature.some(r => r.id === id)).length,
        providerOutcomes: { complete: receipt.outcomes.filter(o => o.state === 'complete').length,
          incomplete: receipt.outcomes.filter(o => o.state === 'incomplete').length, refused: receipt.outcomes.filter(o => o.state === 'refused').length,
          attempts: receipt.outcomes.reduce((sum, o) => sum + o.attempts, 0),
          counts: receipt.outcomes.reduce((sum, o) => ({ ok: sum.ok + o.counts.ok, failed: sum.failed + o.counts.failed,
            refused: sum.refused + o.counts.refused, unresolved: sum.unresolved + o.counts.unresolved,
            cancelled: sum.cancelled + o.counts.cancelled, rateLimited: sum.rateLimited + o.counts.rateLimited }),
          { ok: 0, failed: 0, refused: 0, unresolved: 0, cancelled: 0, rateLimited: 0 }) },
        replay: replay.stats(), cards: { total: cards.length, resolvable, unresolvable: cards.length - resolvable } };
    } };
}
export type ResearchDiscoveryMeasurement = Awaited<ReturnType<Awaited<ReturnType<typeof createResearchDiscoveryFixture>>['measure']>>;
