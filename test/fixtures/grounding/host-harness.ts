import assert from 'node:assert/strict';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createDocumentIngester, SafeStaticFetcher } from '@tangleai/documents';
import { createGroundingStore, createDocumentStore, createGroundingSegmentHost, openTangleDb, type TangleDb } from '@tangleai/store';
import { createGroundingHost, createReplayWebTransport, groundingArtifacts, groundingIdOf, loadGroundingProfile,
    type GroundingHost, type GroundingHostOptions } from '@tangleai/grounding';
import type { MasRuntimeObserver, MasChatCompletion } from '@tangleai/mas';
import profileDocument from './profile-minimal.json' with { type: 'json' };
import { webRecord, searchRecord, toolTurn, finishTurn, sufficiencyTurn, SEARCH_BASE, page } from './web-harness.ts';
export const HOST_AT = '2026-06-01T00:00:00.000Z';
export const HOST_QUERY = 'Where is the archive desk?';
export async function groundingHostHarness(input: { db?: TangleDb; path?: string; complex?: boolean; web?: boolean; observer?: MasRuntimeObserver;
    dead?: 'model' | 'embedder' | 'store'; } = {}) {
    const checked = await loadGroundingProfile(profileDocument); assert.ok(checked.valid); const profile = checked.value;
    let epoch = Date.parse(HOST_AT), calls = 0, requests = 0, resolves = 0, webTurns = 0;
    const now = () => HOST_AT, clock = () => 0;
    const embedder = createHashEmbedder({ dims: 64 });
    const records = [await searchRecord(HOST_QUERY, [{ url: page('/archive') }]),
        await webRecord(page('/archive'), '<html><h1>Archive desk</h1><p>The archive desk is in Square Hall.</p></html>'),
        await webRecord(page('/robots.txt'), 'User-agent: *\nAllow: /', 200, [['content-type', 'text/plain']])];
    const replay = await createReplayWebTransport(records, { searxBase: SEARCH_BASE });
    const transport = { ...replay, async fetch(...args: Parameters<typeof replay.fetch>) { requests++; return replay.fetch(...args); } };
    const client = { endpoint: { provider: 'scripted' }, async complete(request: unknown): Promise<MasChatCompletion> {
        calls++; if (input.dead === 'model') throw Error('registered-dead-model');
        const messages = (request as { messages: Array<{ role?: string; content: unknown }> }).messages;
        const stage = groundingArtifacts.prompts.find(row => messages.some(message => message.role === 'system' && typeof message.content === 'string' && message.content.includes(row.role.instructions)))?.id;
        let reply: unknown;
        if (stage === 'grounding-triage') reply = { triage: input.complex ? 'complex' : 'simple', reason: 'Registered administrative question.',
            requiredFields: input.complex ? ['service'] : [], intents: [input.complex ? 'service-navigation' : 'administrative-information'] };
        else if (stage === 'grounding-question') reply = { questions: [{ id: 'q1', text: 'Which service do you mean?' }] };
        else if (stage === 'grounding-resolve') {
            const resolved = resolves++ % 4 >= 2;
            reply = { refinedQuery: HOST_QUERY, resolved, result: { answer: '', disposition: resolved ? 'completed' : 'needs-information',
                claims: [], findings: [], outstandingQuestions: resolved ? [] : ['service'] } };
        } else if (stage === 'grounding-plan') reply = { queries: [{ text: HOST_QUERY, why: 'Locate the named desk.', lanes: { local: !input.web, web: Boolean(input.web) } }] };
        else if (stage === 'grounding-web-agent') {
            const index = webTurns++ % 3;
            return index === 0 ? toolTurn(['web_search', { query: HOST_QUERY }]) : index === 1 ? toolTurn(['web_fetch', { url: page('/archive') }]) : finishTurn();
        } else if (stage === 'grounding-web-sufficiency') return sufficiencyTurn();
        else if (stage === 'grounding-generate') {
            const ids = [...JSON.stringify(messages).matchAll(/evidence-[a-f0-9]{32}/g)].map(match => match[0]);
            assert.ok(ids.length, 'The generated claim needs an actually supplied evidence id.');
            reply = { disposition: 'answer', claims: [{ id: 'archive-location', text: 'The archive desk is in Square Hall.', critical: false, citations: [ids[0]], caveats: [] }] };
        } else throw Error('Unregistered model stage: ' + stage);
        return { message: { role: 'assistant', content: JSON.stringify(reply) }, usage: { prompt_tokens: 7, completion_tokens: 3 } };
    } };
    const open = () => openTangleDb({ ...(input.path ? { path: input.path } : {}), jobs: { now: () => epoch, random: () => 0.5 } });
    let db = input.db ?? await open();
    let grounding = createGroundingStore(db), corpus = createDocumentStore(db);
    if (!(await corpus.listSources()).length && !input.web) {
        const fetcher = new SafeStaticFetcher({ now, lookup: async () => [{ address: '93.184.216.34', family: 4 }],
            limits: { respectRobots: false, perHostDelayMs: 0 }, fetch: async () => new Response('<html><body><main><h1>Archive desk</h1><p>The archive desk is in Square Hall. Bring the blue form.</p></main></body></html>', { headers: { 'content-type': 'text/html' } }) });
        await createDocumentIngester({ store: corpus, embedder, fetcher, now }).ingest({ url: page('/archive'), strategy: 'parent-child',
            parentTokens: 2000, maxTokens: 400, overlapTokens: 50, allowBrowser: false });
        const source = (await corpus.listSources())[0]!, version = (await corpus.listVersions())[0]!;
        const payload = { profileId: profile.id, profileRevision: profile.revision, sourceId: source.id, versionId: version.id,
            status: 'active' as const, canonicalUrl: source.canonicalUrl, institution: 'Harbour District Service Office', authorityTier: 'official' as const,
            jurisdiction: profile.jurisdiction, language: 'en', contentHash: version.contentHash, times: { provenance: 'curator' as const, reviewedAt: HOST_AT },
            curator: { decision: 'promote' as const, by: 'fixture-curator', at: HOST_AT } };
        assert.ok((await grounding.putProfile(profile)).ok);
        assert.ok((await grounding.putManifest({ ...payload, id: await groundingIdOf('manifest', payload) })).ok);
    }
    let segments = createGroundingSegmentHost(db, { now, deadlineFor: afterMs => new Date(epoch + afterMs).toISOString(), jobClock: () => epoch });
    let host: GroundingHost;
    const bindings = () => ({ corpus: input.dead === 'store' ? { ...corpus, async listSources() { throw Error('registered-dead-store'); } } : corpus,
        embedder: input.dead === 'embedder' ? { ...embedder, async embed() { throw Error('registered-dead-embedder'); } } : embedder,
        transport, clientFor: () => ({ client, identity: null }), now, clock, factVocabulary: [] as string[], ...(input.observer ? { observer: input.observer } : {}) });
    const compose = () => createGroundingHost({ ...bindings(), profile, store: grounding, segments });
    host = await compose();
    return { bindings, profile, get db() { return db; }, get host() { return host; }, get grounding() { return grounding; }, get corpus() { return corpus; }, get segments() { return segments; },
        stats: () => ({ calls, requests }), advance: () => { epoch += 1000; },
        async reopen() { assert.ok(input.path); await db.close(); db = await open(); grounding = createGroundingStore(db); corpus = createDocumentStore(db);
            segments = createGroundingSegmentHost(db, { now, deadlineFor: ms => new Date(epoch + ms).toISOString(), jobClock: () => epoch }); host = await compose(); },
        close: () => input.db ? Promise.resolve() : db.close() };
}
