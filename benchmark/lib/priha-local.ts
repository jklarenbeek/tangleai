/** Retrieval measurements inspect real retained text against frozen support quotes. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { mean } from '@jarenjs/core/stats';
import { createHashEmbedder } from '@tangleai/models/embed';
import { SafeStaticFetcher, createDocumentIngester, type DocumentChunk, type DocumentParent, type StoredDocumentBundle } from '@tangleai/documents';
import { createDocumentStore, createGroundingStore, openTangleDb } from '@tangleai/store';
import { createLocalRetriever, createRrfRanker, groundingIdOf, promoteToCorpus, type CorpusManifest, type GroundingProfile } from '@tangleai/grounding';
import { collectDocumentEvidence, GROUNDING_DEFAULTS } from '../../apps/desktop/src/grounding.ts';
import { contractMust } from './priha-contracts.ts';
import type { LoadedPrihaFixture } from './priha.ts';
import type { PrihaLocalCase, PrihaLocalCensus, PrihaLocalMetrics, PrihaLocalReport, PrihaLocalRow } from './priha.types.ts';
import { latency } from './stats.ts';
export interface PrihaLocalTiming { row: string; query: string; ms: number; rebuildMs: number; }
const normalized = (text: string) => text.replace(/\s+/gu, ' ').trim();
const average = (values: number[]) => mean(values) ?? 0;
function metrics(cases: PrihaLocalCase[]): PrihaLocalMetrics {
    const sum = (field: 'support' | 'childHits' | 'parentHits') => cases.reduce((n, c) => n + c[field], 0);
    const census = (field: 'skipped' | 'deduplicated' | 'parentsOverBudget' | 'issues' | 'rebuilds') => cases.reduce((n, c) => n + c.census[field], 0);
    const support = sum('support'), childHits = sum('childHits'), parentHits = sum('parentHits');
    const suite = (name: string) => cases.filter(c => c.suite === name && c.support > 0);
    return { cases: cases.length, eligibleCases: cases.filter(c => c.support > 0).length, support, childHits, parentHits,
        childRecall: support ? childHits / support : 0, parentRecovery: support ? parentHits / support : 0,
        exactNameRecall: average(suite('exact-name').map(c => c.childRecall)), paraphraseRecall: average(suite('paraphrase').map(c => c.childRecall)),
        meanCandidates: average(cases.map(c => c.childIds.length)), skipped: census('skipped'), deduplicated: census('deduplicated'),
        parentsOverBudget: census('parentsOverBudget'), issues: census('issues'), rebuilds: census('rebuilds'), rebuildMs: null };
}
/** One corpus owner shared by retrieval measurements and scripted answer treatments. */
export async function createPrihaCorpus(loaded: LoadedPrihaFixture, profile: GroundingProfile, granularity: LoadedPrihaFixture['fixture']['granularities'][number], path?: string, jobClock: () => number = () => 1_000_000, options: { sourceKeys?: readonly string[] } = {}) {
    const db = await openTangleDb({ ...(path ? { path } : {}), jobs: { now: jobClock, random: () => 0.5 } }), f = loaded.fixture;
    try {
        const store = createDocumentStore(db), grounding = createGroundingStore(db), embedder = createHashEmbedder({ dims: 128 });
        contractMust(await grounding.putProfile(profile));
        const versionKeys = new Map<string, string>(); let embeddingCalls = 0, embeddedChildren = 0;
        if (options.sourceKeys?.some(key => !f.sources.some(source => source.key === key))) throw Error('Unregistered corpus source selection.');
        for (const source of f.sources.filter(source => options.sourceKeys === undefined || options.sourceKeys.includes(source.key))) for (const registered of source.versions) {
            const url = loaded.corpusAddresses.find(a => a.version === registered.key)!.url;
            let bundle: StoredDocumentBundle | undefined;
            const staging = { ...store, async activate(value: StoredDocumentBundle) { bundle = value; }, async recordFailure() {} };
            const fetcher = new SafeStaticFetcher({ now: () => registered.admittedAt,
                lookup: async () => [{ address: '93.184.216.34', family: 4 }], limits: { respectRobots: false, perHostDelayMs: 0 },
                fetch: async input => {
                    if (String(input) !== url) throw Error('Unregistered local fixture request.');
                    // Historical markdown bytes have their own format, even when a later source is HTML.
                    return new Response(new Uint8Array(loaded.bodies.get(registered.file)!), { headers: { 'content-type': registered.file.endsWith('.md') ? 'text/markdown' : source.mimeType } });
                },
            });
            await createDocumentIngester({ store: staging, fetcher, embedder, now: () => registered.admittedAt }).ingest({ url,
                strategy: granularity.parentTokens === null ? 'recursive' : 'parent-child', maxTokens: granularity.maxTokens,
                overlapTokens: granularity.overlapTokens, ...(granularity.parentTokens === null ? {} : { parentTokens: granularity.parentTokens }), allowBrowser: false });
            if (!bundle) throw Error('The document ingester did not stage the registered version.');
            if (bundle.version.contentHash !== registered.sha256) throw Error('The document ingester changed the registered source bytes.');
            const facts = registered.facts;
            const payload = { profileId: profile.id, profileRevision: profile.revision, sourceId: bundle.source.id, versionId: bundle.version.id,
                status: 'active' as const, canonicalUrl: bundle.source.canonicalUrl, institution: facts.institution, authorityTier: facts.authorityTier,
                jurisdiction: facts.jurisdiction, language: facts.language, contentHash: registered.sha256,
                times: { provenance: facts.timeProvenance, ...(facts.effectiveAt === null ? {} : { effectiveAt: facts.effectiveAt }), ...(facts.expiresAt === null ? {} : { expiresAt: facts.expiresAt }) },
                curator: { decision: 'admit' as const, by: 'registered-fixture-curator', at: registered.admittedAt } };
            const manifest: CorpusManifest = { ...payload, id: await groundingIdOf('manifest', payload) };
            contractMust(await promoteToCorpus(grounding, manifest, bundle));
            versionKeys.set(bundle.version.id, registered.key);
            embeddingCalls += bundle.version.metrics.embeddingCalls; embeddedChildren += bundle.chunks.length;
        }
        const versions = await store.listVersions(), allChunks = await store.listChunks(), allParents = await store.listParents();
        for (const version of versions) {
            const registered = f.sources.flatMap(s => s.versions).find(v => v.key === versionKeys.get(version.id))!;
            if (version.status !== registered.status) throw Error(`Document ${registered.key}: actual ${version.status}, registered ${registered.status}.`);
        }
        const active = new Set(versions.filter(v => v.status === 'active').map(v => v.id));
        const corpus = { sources: (await store.listSources()).length, versions: versions.length,
            activeChildren: allChunks.filter(c => active.has(c.versionId)).length, activeParents: allParents.filter(p => active.has(p.versionId)).length,
            retainedChunks: allChunks.length, retainedParents: allParents.length, embeddingCalls, embeddedChildren };
        return { db, store, grounding, embedder, versionKeys, corpus, active, allChunks, allParents, close: () => db.close() };
    } catch (error) { await db.close(); throw error; }
}
export async function measurePrihaLocal(loaded: LoadedPrihaFixture, profile: GroundingProfile,
    onTiming?: (value: PrihaLocalTiming) => void): Promise<PrihaLocalReport> {
    const f = loaded.fixture, rows: PrihaLocalRow[] = [];
    for (const granularity of f.granularities) {
        const host = await createPrihaCorpus(loaded, profile, granularity);
        try {
            const { store, grounding, embedder, versionKeys, corpus, active, allChunks } = host;
            const chunks = new Map(allChunks.map(c => [c.id, c]));
            const covered = (records: Array<DocumentChunk | DocumentParent>, expected: string[]) => expected.filter(id => {
                const element = f.elements.find(e => e.key === id)!;
                return records.some(record => versionKeys.get(record.versionId) === element.version && normalized(record.text).includes(normalized(element.quote)));
            });
            for (const lane of (granularity.parentTokens === null ? ['semantic'] : ['semantic', 'lexical', 'fused']) as Array<'semantic' | 'lexical' | 'fused'>) {
                const treatment = granularity.parentTokens === null ? 'flat-semantic' as const : 'local-hybrid' as const;
                const key = treatment + '/' + granularity.id + '/' + lane;
                const session = contractMust(await grounding.createSession({ conversationId: key, profileId: profile.id, profileRevision: profile.revision }));
                const retriever = createLocalRetriever({ store, manifests: grounding, embedder, ranker: createRrfRanker(), session,
                    now: () => f.cutoff, budgets: { contextTokens: Math.floor(f.hypothesis.maxContextChars / 4) },
                    lanes: { semantic: lane !== 'lexical', lexical: lane !== 'semantic' } });
                const cases: PrihaLocalCase[] = [];
                for (const query of loaded.localQueries) {
                    const question = f.questions.find(q => q.key === query.question)!;
                    const expectedSupport = [...new Set(question.claims.flatMap(id => f.supportByLane.find(s => s.claim === id)!.local))];
                    const started = performance.now(); let rebuildMs = 0, retrieved: DocumentChunk[] = [], supplied: Array<DocumentChunk | DocumentParent> = [];
                    let census: PrihaLocalCensus, issue: PrihaLocalCase['issue'] = null;
                    if (treatment === 'flat-semantic') {
                        const [vector] = await embedder.embed([query.text]);
                        const result = await collectDocumentEvidence(store, vector, { model: embedder.model, dims: 128 }, GROUNDING_DEFAULTS);
                        census = { activeVersions: active.size, children: corpus.activeChildren, semantic: 0, lexical: 0, skipped: 0, deduplicated: 0,
                            diversityDropped: 0, parentsOverBudget: 0, selected: 0, issues: 0, rebuilds: 0, rebuildMs: null, generation: 0,
                            sourceRevision: await canonicalSha256([...active].sort()), contextTokens: 0 };
                        if (!result.ok) { issue = { code: result.error.code, path: '/flat', detail: result.error.message }; census.issues++; }
                        else {
                            retrieved = result.evidence.ranked.map(r => r.chunk);
                            supplied = [...new Map(result.evidence.ranked.flatMap(r => r.context.map(c => [c.id, c] as const))).values()];
                            census.semantic = retrieved.length; census.selected = retrieved.length; census.skipped = result.skipped;
                            census.contextTokens = result.evidence.estimatedTokens; census.deduplicated = result.evidence.duplicateExpansions;
                        }
                    } else {
                        const result = await retriever.retrieve({ id: query.id, text: query.text }, { k: GROUNDING_DEFAULTS.k, minScore: GROUNDING_DEFAULTS.minScore,
                            maxPerSource: GROUNDING_DEFAULTS.maxPerSource, contextTokens: Math.floor(f.hypothesis.maxContextChars / 4) });
                        rebuildMs = result.census.rebuildMs; census = { ...result.census, rebuildMs: null };
                        if (!result.ok) issue = { code: result.issue.code, path: result.issue.path, detail: result.issue.detail };
                        else {
                            retrieved = result.candidates.map(candidate => chunks.get('chunkId' in candidate.address ? candidate.address.chunkId : '')!);
                            if (retrieved.some(chunk => !chunk)) throw Error('The actual retriever returned an unknown chunk.');
                            supplied = result.parents;
                        }
                    }
                    const retrievedSupport = covered(retrieved, expectedSupport), suppliedSupport = covered(supplied, expectedSupport);
                    const support = expectedSupport.length, childHits = retrievedSupport.length, parentHits = suppliedSupport.length;
                    cases.push({ id: query.id, question: query.question, suite: query.suite, query: query.text, expectedSupport, retrievedSupport, suppliedSupport,
                        childIds: retrieved.map(c => c.id), parentIds: supplied.filter(c => 'childIds' in c).map(c => c.id), childHits, parentHits, support,
                        childRecall: support ? childHits / support : 0, parentRecovery: support ? parentHits / support : 0, census, issue });
                    onTiming?.({ row: key, query: query.id, ms: performance.now() - started, rebuildMs });
                }
                rows.push({ key, treatment, granularity: granularity.id, lane, rankerId: treatment === 'flat-semantic' ? 'cosine/1' : 'rrf/1', corpus, cases, metrics: metrics(cases) });
            }
        } finally { await host.close(); }
    }
    const comparisons = f.granularities.filter(g => g.parentTokens !== null).map(g => {
        const score = (lane: string) => rows.find(r => r.granularity === g.id && r.lane === lane)!.metrics.childRecall;
        const semantic = score('semantic'), lexical = score('lexical'), fused = score('fused');
        return { granularity: g.id, semantic, lexical, fused, fusedBeatsOrTiesBoth: fused >= semantic && fused >= lexical,
            latencyBudgetMs: f.budgets.maxMs, latency: 'separate-receipt' as const };
    });
    return { status: 'executed', queryId: await canonicalSha256(loaded.localQueries), corpusAddressId: await canonicalSha256(loaded.corpusAddresses), corpusAddresses: loaded.corpusAddresses, queries: loaded.localQueries, rows, comparisons,
        failed: rows.reduce((n, r) => n + r.metrics.issues, 0), providerRequests: 0, networkRequests: 0, latency: 'separate-receipt' };
}
/** Nondeterministic wall time is kept outside the reproducible score document. */
export async function prihaLocalTimingReceipt(report: { reportId: string; registration: { registrationId: string }; source: { sha256: string }; local: PrihaLocalReport }, samples: PrihaLocalTiming[]) {
    const rows = report.local.rows.map(row => {
        const matching = samples.filter(s => s.row === row.key), summary = latency(matching.map(s => s.ms));
        const budgetMs = report.local.comparisons[0]?.latencyBudgetMs ?? 0;
        return { row: row.key, ...summary, rebuildMs: matching.reduce((n, s) => n + s.rebuildMs, 0), budgetMs,
            passed: matching.length === row.cases.length && summary.p95Ms !== null && summary.p95Ms <= budgetMs };
    });
    const body = { document: 'priha-local-latency', reportId: report.reportId, registrationId: report.registration.registrationId,
        sourceSha256: report.source.sha256, clock: 'performance.now', rows, samples };
    return { ...body, receiptId: await canonicalSha256(body) };
}
