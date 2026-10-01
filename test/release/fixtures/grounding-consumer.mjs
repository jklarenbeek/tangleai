import assert from 'node:assert/strict';
import { join } from 'node:path';
import { qualifyGroundingBrowser } from './grounding-browser.mjs';
import { createMemoryGroundingStore, loadGroundingProfile, evaluateProfileRules, createQueryOptimizer, createGroundingHost, createGroundingReader, createReplayWebTransport, groundingIdOf, groundingArtifacts } from '@tangleai/grounding';
import { createGroundingStore, createGroundingClarificationHost, createGroundingSegmentHost, createDocumentStore, openTangleDb } from '@tangleai/store';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createDocumentIngester, SafeStaticFetcher } from '@tangleai/documents';
import schema from '@tangleai/grounding/schemas/grounding' with { type: 'json' };
import profileDocument from '@tangleai/grounding/profiles/priha-hk' with { type: 'json' };
assert.match(import.meta.resolve('@tangleai/grounding'), /\.js$/);
assert.equal(schema.$id, 'https://tangleai.dev/schemas/governed-grounding');
const loaded = await loadGroundingProfile(profileDocument); assert.ok(loaded.valid);
assert.equal(evaluateProfileRules(loaded.value, { text: 'RED FLAG' }).emergency, 'emergency-route');
const root = process.env.TANGLE_FIXTURE_DIRECTORY; assert.ok(root);
const db = await openTangleDb({ path: join(root, 'grounding.db'), jobs: { now: () => 1000, random: () => 0.5 } });
try {
    const ids = [];
    for (const store of [createMemoryGroundingStore(), createGroundingStore(db)]) {
        const first = await store.putProfile(loaded.value), repeat = await store.putProfile(loaded.value);
        assert.ok(first.ok); assert.equal(first.changes, 1); assert.ok(repeat.ok); assert.equal(repeat.changes, 0);
        const start = await store.createSession({ conversationId: 'installed', profileId: loaded.value.id, profileRevision: loaded.value.revision }); assert.ok(start.ok);
        const triage = await store.transitionSession(start.value.id, { kind: 'triage' }, start.value.revision); assert.ok(triage.ok);
        const stale = await store.transitionSession(start.value.id, { kind: 'triage' }, start.value.revision); assert.equal(stale.ok, false); assert.equal(stale.issue.code, 'TGRD1002');
        ids.push(triage.value.id);
    }
    assert.equal(ids[0], ids[1]);
    const store = createGroundingStore(db), profile = loaded.value;
    const created = await store.createSession({ conversationId: 'installed-clarification', profileId: profile.id, profileRevision: profile.revision }); assert.ok(created.ok);
    const unresolved = { resolved: false, refinedQuery: 'Which service?', result: { answer: '', disposition: 'needs-information', claims: [], findings: [], outstandingQuestions: ['service'] } };
    const question = { questions: [{ id: 'q1', text: profile.clarification.requiredFields[0].question }] };
    const resolved = { resolved: true, refinedQuery: 'Voucher service information', result: { answer: '', disposition: 'completed', claims: [], findings: [], outstandingQuestions: [] } };
    const replies = [{ triage: 'complex', reason: 'Unknown service.', requiredFields: ['service'], intents: ['service-navigation'] }, unresolved, unresolved, question, question, resolved, resolved];
    let calls = 0;
    const client = { endpoint: { provider: 'scripted' }, async complete() { assert.ok(calls < replies.length); return {
        message: { role: 'assistant', content: JSON.stringify(replies[calls++]) }, usage: { prompt_tokens: 7, completion_tokens: 3 } }; } };
    const optimizer = createQueryOptimizer({ profile, store, clock: () => 0, factVocabulary: ['metformin'],
        clarification: createGroundingClarificationHost(db, { now: () => '2026-06-01T00:00:00.000Z', deadlineFor: () => '2026-06-02T00:00:00.000Z' }),
        clients: { triage: { client, identity: null }, plan: { client, identity: null } } });
    const start = await optimizer.triage(created.value, 'Which service?'); assert.ok(start.ok);
    const wait = await optimizer.clarify(start.value.session); assert.ok(wait.ok); assert.equal(wait.value.disposition, 'clarification');
    const ready = await optimizer.resume(wait.value.session, { interactionId: wait.value.interactionId, expectedRevision: wait.value.interactionRevision,
        responseKey: 'installed-answer', value: { answers: { q1: 'The voucher service.' } } });
    assert.ok(ready.ok); assert.equal(ready.value.disposition, 'ready'); assert.equal(ready.value.intent.answered.service, 'The voucher service.');
    assert.equal(calls, 7); assert.equal(ready.value.spend.calls, 7); assert.equal(ready.value.spend.tokens, 70);
    const web = await qualifyGroundingBrowser(store); assert.equal(web.webCalls, 4); assert.equal(web.webRequests, 3); assert.equal(web.webCandidates, 1); assert.equal(web.answerCalls, 1); assert.equal(web.answerDisposition, 'answer');
    const corpus = createDocumentStore(db), embedder = createHashEmbedder({ dims: 64 }), now = () => '2026-06-01T00:00:00.000Z';
    const fetcher = new SafeStaticFetcher({ now, lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        limits: { respectRobots: false, perHostDelayMs: 0 }, fetch: async () => new Response('<html><main><h1>Archive</h1><p>The archive desk is in Square Hall.</p></main></html>', { headers: { 'content-type': 'text/html' } }) });
    await createDocumentIngester({ store: corpus, embedder, fetcher, now }).ingest({ url: 'https://official.harbour.example/archive', strategy: 'parent-child',
        parentTokens: 2000, maxTokens: 400, overlapTokens: 50, allowBrowser: false });
    const source = (await corpus.listSources())[0], version = (await corpus.listVersions())[0];
    const manifest = { profileId: profile.id, profileRevision: profile.revision, sourceId: source.id, versionId: version.id, status: 'active',
        canonicalUrl: source.canonicalUrl, institution: 'Harbour District Service Office', authorityTier: 'official', jurisdiction: profile.jurisdiction,
        language: 'en', contentHash: version.contentHash, times: { provenance: 'curator', reviewedAt: now() }, curator: { decision: 'promote', by: 'installed-fixture', at: now() } };
    assert.ok((await store.putManifest({ ...manifest, id: await groundingIdOf('manifest', manifest) })).ok);
    let flowCalls = 0;
    const flowClient = { endpoint: { provider: 'scripted' }, async complete(request) {
        flowCalls++;
        const stage = groundingArtifacts.prompts.find(row => request.messages.some(message => message.role === 'system' && typeof message.content === 'string' && message.content.includes(row.role.instructions)))?.id;
        const replies = {
            'grounding-triage': { triage: 'simple', reason: 'Administrative lookup.', requiredFields: [], intents: ['administrative-information'] },
            'grounding-plan': { queries: [{ text: 'Where is the archive desk?', why: 'Locate archive.', lanes: { local: true, web: false } }] },
            'grounding-generate': { disposition: 'answer', claims: [{ id: 'archive', text: 'The archive desk is in Square Hall.', critical: false,
                citations: [JSON.stringify(request.messages).match(/evidence-[a-f0-9]{32}/)?.[0]], caveats: [] }] },
        };
        assert.ok(replies[stage], 'Unexpected installed flow stage: ' + stage);
        return { message: { role: 'assistant', content: JSON.stringify(replies[stage]) }, usage: { total_tokens: 10 } };
    } };
    const transport = await createReplayWebTransport([], { searxBase: 'https://search.harbour.example' });
    const segments = createGroundingSegmentHost(db, { now, jobClock: () => 1000, deadlineFor: () => '2026-06-02T00:00:00.000Z' });
    const host = await createGroundingHost({ store, corpus, segments, profile, embedder, transport, clientFor: () => ({ client: flowClient, identity: null }),
        now, clock: () => 0, factVocabulary: [] });
    const reply = await host.start({ text: 'Where is the archive desk?', conversationId: 'installed-flow' });
    assert.equal(reply.disposition, 'answer', JSON.stringify(reply)); assert.equal(reply.answer.text, 'The archive desk is in Square Hall.');
    assert.equal(flowCalls, 3); assert.equal(reply.trace.calls, flowCalls); assert.equal(transport.stats().requests, 0);
    assert.deepEqual(await host.enqueue(reply.sessionId), reply); assert.equal(flowCalls, 3);
    assert.deepEqual(await createGroundingReader({ store, mas: segments.store }).get(reply.sessionId), reply);
    assert.equal((await host.evidence(reply.sessionId)).candidates[0].lane, 'local');
    const refusal = await host.start({ text: 'RED FLAG', conversationId: 'installed-refusal' });
    assert.equal(refusal.disposition, 'refusal'); assert.equal(refusal.trace.calls, 0); assert.equal(flowCalls, 3);
    console.log(JSON.stringify({ web, flowCalls, groundingInstalled: true, profiles: 1, repeatWrites: 0, backends: 2, revision: loaded.value.revision }));
} finally { await db.close(); }
