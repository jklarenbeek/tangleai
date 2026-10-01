import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRetriever, createRrfRanker, promoteToCorpus, type LocalRetrieverOptions } from '@tangleai/grounding';
import { createPrihaContractFixture } from '../../benchmark/lib/priha-contracts.ts';
import { localCorpus, LOCAL_AT, selection, ok } from '../fixtures/grounding/local-corpus.ts';
const settings = (f: Awaited<ReturnType<typeof localCorpus>>, extra: Partial<LocalRetrieverOptions> = {}): LocalRetrieverOptions => ({
    store: f.store, manifests: f.grounding, embedder: f.embedder, session: f.session, ranker: createRrfRanker(), budgets: { contextTokens: 3000 }, now: () => LOCAL_AT, clock: () => 0, ...extra,
});
it('merges both raw lanes and reuses the index until the active version set changes', async () => {
    const f = await localCorpus();
    try {
        await f.ingester.ingest(f.input); let ticks = 0;
        const retriever = createLocalRetriever(settings(f, { clock: () => ticks++ }));
        const query = { id: 'query-fixture', text: 'RIVERCARD-2 archive appointment desk' };
        const first = await retriever.retrieve(query, selection); assert.ok(first.ok); assert.ok(first.candidates.length); assert.ok(first.census.deduplicated > 0);
        assert.equal(first.census.rebuilds, 1); assert.equal(first.census.rebuildMs, 1); assert.equal(first.census.generation, 1);
        assert.equal(new Set(first.candidates.map(c => 'chunkId' in c.address && c.address.chunkId)).size, first.candidates.length);
        assert.ok(first.candidates.some(c => c.scores.semantic !== undefined && c.scores.lexical !== undefined && c.scores.fusion !== undefined && c.scores.rank !== undefined));
        assert.ok(first.candidates.every(c => c.rankerId === 'rrf/1' && c.authority.tier === 'unverified' && c.authority.institution === undefined));
        assert.ok(first.candidates.every(c => c.times.provenance === null && !c.times.publishedAt && !c.times.effectiveAt));
        const replay = await retriever.retrieve(query, selection); assert.ok(replay.ok); assert.equal(replay.census.rebuilds, 0); assert.deepEqual(replay.candidates, first.candidates);
        const fixture = await createPrihaContractFixture(f.profile, f.session); let session = ok(await f.grounding.transitionSession(f.session.id, { kind: 'triage' }, f.session.revision));
        ok(await f.grounding.putIntent(fixture.intent)); ok(await f.grounding.putPlan(fixture.plan));
        session = ok(await f.grounding.transitionSession(session.id, { kind: 'plan', intentId: fixture.intent.id, planId: fixture.plan.id }, session.revision));
        assert.ok((await f.grounding.putEvidence(first.candidates)).ok);
        const forged = structuredClone(first.candidates[0]); forged.id = 'forged-time'; forged.times.effectiveAt = LOCAL_AT;
        const refused = await f.grounding.putEvidence([forged]); assert.ok(!refused.ok); assert.equal(refused.issue.code, 'TGRD1005');
        f.change(); await f.ingester.ingest(f.input); const changed = await retriever.retrieve(query, selection); assert.ok(changed.ok);
        assert.equal(changed.census.generation, 2); assert.equal(changed.census.rebuilds, 1); assert.notEqual(changed.census.sourceRevision, first.census.sourceRevision);
    } finally { await f.db.close(); }
});
it('counts semantic identity skips, parent budgets and explicit no-evidence outcomes', async () => {
    const f = await localCorpus();
    try {
        await f.ingester.ingest(f.input);
        const retriever = createLocalRetriever(settings(f, { embedder: { ...f.embedder, model: 'other-space' } }));
        const query = { id: 'q', text: 'RIVERCARD-2 archive' };
        const mismatch = await retriever.retrieve(query, selection); assert.ok(mismatch.ok); assert.equal(mismatch.census.skipped, mismatch.census.children); assert.ok(mismatch.candidates.length);
        const bounded = await retriever.retrieve(query, { ...selection, contextTokens: 0 }); assert.ok(bounded.ok); assert.equal(bounded.reason, 'no-evidence'); assert.ok(bounded.census.parentsOverBudget > 0);
        const absent = await createLocalRetriever(settings(f, { lanes: { semantic: false, lexical: true } })).retrieve({ id: 'missing', text: 'unfindablezqxv' }, selection);
        assert.ok(absent.ok); assert.deepEqual(absent.candidates, []); assert.equal(absent.reason, 'no-evidence');
    } finally { await f.db.close(); }
});
it('reports lexical bounds and embedder failures as counted issues', async () => {
    const f = await localCorpus();
    try {
        await f.ingester.ingest(f.input);
        const bounded = await createLocalRetriever(settings(f, { lexical: { limits: { maxQueryBytes: 3 } } })).retrieve({ id: 'q', text: 'archive desk' }, selection);
        assert.ok(!bounded.ok); assert.equal(bounded.issue.code, 'TGRD1007'); assert.equal(bounded.issue.path, '/lexical'); assert.equal(bounded.census.issues, 1);
        assert.match(bounded.issue.cause!.message, /bound/);
        const failed = await createLocalRetriever(settings(f, { embedder: { ...f.embedder, async embed() { throw new RangeError('provider vector range'); } } })).retrieve({ id: 'q', text: 'archive desk' }, selection);
        assert.ok(!failed.ok); assert.equal(failed.issue.code, 'TGRD1009'); assert.equal(failed.issue.path, '/retrieval'); assert.equal(failed.census.issues, 1);
    } finally { await f.db.close(); }
});
it('rejects ranker changes to evidence, provenance or raw lane scores', async () => {
    const f = await localCorpus();
    try {
        await f.ingester.ingest(f.input);
        for (const field of ['text', 'provenance', 'score'] as const) {
            const ranker = { id: 'bad', version: '1', async rank(_text: string, rows: Parameters<ReturnType<typeof createRrfRanker>['rank']>[1]) {
                assert.ok(Object.isFrozen(rows[0].chunk)); const result = await createRrfRanker().rank('', rows);
                const changed = structuredClone(result);
                if (field === 'text') changed[0].chunk.text = 'invented evidence';
                if (field === 'provenance') changed[0].source.canonicalUrl = 'https://invented.example';
                if (field === 'score') changed[0].scores.semantic = 123;
                return changed;
            } };
            const result = await createLocalRetriever(settings(f, { ranker })).retrieve({ id: 'q', text: 'archive desk' }, selection);
            assert.ok(!result.ok); assert.equal(result.issue.code, 'TGRD1009'); assert.equal(result.issue.path, '/ranker');
        }
    } finally { await f.db.close(); }
});
it('uses only the exact curated profile revision and declared time facts', async () => {
    const f = await localCorpus();
    try {
        const bundle = await f.staged(), manifest = await f.manifest(bundle); ok(await promoteToCorpus(f.grounding, manifest, bundle));
        const result = await createLocalRetriever(settings(f)).retrieve({ id: 'q', text: 'archive desk' }, selection); assert.ok(result.ok); assert.ok(result.candidates.length);
        assert.deepEqual(result.candidates[0].times, manifest.times); assert.equal(result.candidates[0].authority.tier, 'official');
        const foreign = await createLocalRetriever(settings(f, { session: { ...f.session, profileRevision: 'f'.repeat(64) } })).retrieve({ id: 'q', text: 'archive desk' }, selection);
        assert.ok(!foreign.ok); assert.equal(foreign.issue.code, 'TGRD1004');
    } finally { await f.db.close(); }
});
