/** Keyless native host composition using public installed package imports only. */
import { createGroundingHost, createGroundingReader, createReplayWebTransport, groundingArtifacts, groundingIdOf, loadGroundingProfile } from '@tangleai/grounding';
import { createGroundingStore, createDocumentStore, createGroundingSegmentHost, type TangleDb } from '@tangleai/store';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createDocumentIngester, SafeStaticFetcher } from '@tangleai/documents';
import type { MasChatClient } from '@tangleai/mas';
import profileDocument from '@tangleai/grounding/profiles/priha-hk' with { type: 'json' };

export async function runGroundingExample(db: TangleDb) {
    const checked = await loadGroundingProfile(profileDocument);
    if (!checked.valid) throw Error(checked.issues[0]!.detail);
    const profile = checked.value, store = createGroundingStore(db), corpus = createDocumentStore(db);
    const embedder = createHashEmbedder({ dims: 64 }), now = () => '2026-06-01T00:00:00.000Z';
    const registered = await store.putProfile(profile); if (!registered.ok) throw Error(registered.issue.detail);
    const url = 'https://official.harbour.example/archive';
    const fetcher = new SafeStaticFetcher({ now, lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        limits: { respectRobots: false, perHostDelayMs: 0 }, fetch: async () => new Response('<html><main><h1>Archive</h1><p>The archive desk is in Square Hall.</p></main></html>',
            { headers: { 'content-type': 'text/html' } }) });
    await createDocumentIngester({ store: corpus, embedder, fetcher, now }).ingest({ url, strategy: 'parent-child', parentTokens: 2000, maxTokens: 400, overlapTokens: 50, allowBrowser: false });
    const source = (await corpus.listSources()).find(row => row.canonicalUrl === url)!;
    const version = (await corpus.listVersions()).find(row => row.sourceId === source.id && row.status === 'active')!;
    const manifest = { profileId: profile.id, profileRevision: profile.revision, sourceId: source.id, versionId: version.id, status: 'active' as const,
        canonicalUrl: source.canonicalUrl, institution: 'Harbour District Service Office', authorityTier: 'official' as const, jurisdiction: profile.jurisdiction,
        language: 'en', contentHash: version.contentHash, times: { provenance: 'curator' as const, reviewedAt: now() },
        curator: { decision: 'promote' as const, by: 'keyless-example', at: now() } };
    const promoted = await store.putManifest({ ...manifest, id: await groundingIdOf('manifest', manifest) });
    if (!promoted.ok) throw Error(promoted.issue.detail);
    let calls = 0;
    const client: MasChatClient = { endpoint: { provider: 'scripted' }, async complete(request) {
        calls++;
        const messages = (request as { messages: Array<{ role?: string; content?: unknown }> }).messages;
        const stage = groundingArtifacts.prompts.find(row => messages.some(message => message.role === 'system' && typeof message.content === 'string' && message.content.includes(row.role.instructions)))?.id;
        const replies: Record<string, unknown> = {
            'grounding-triage': { triage: 'simple', reason: 'Administrative lookup.', requiredFields: [], intents: ['administrative-information'] },
            'grounding-plan': { queries: [{ text: 'Where is the archive desk?', why: 'Locate archive.', lanes: { local: true, web: false } }] },
            'grounding-generate': { disposition: 'answer', claims: [{ id: 'archive', text: 'The archive desk is in Square Hall.', critical: false,
                citations: [JSON.stringify(messages).match(/evidence-[a-f0-9]{32}/)?.[0]], caveats: [] }] },
        };
        if (!stage || !replies[stage]) throw Error('Unexpected keyless example stage.');
        return { message: { role: 'assistant', content: JSON.stringify(replies[stage]) }, usage: { total_tokens: 10 } };
    } };
    const transport = await createReplayWebTransport([], { searxBase: 'https://search.harbour.example' });
    const segments = createGroundingSegmentHost(db, { now, jobClock: () => 1000, deadlineFor: () => '2026-06-02T00:00:00.000Z' });
    const host = await createGroundingHost({ store, corpus, segments, profile, embedder, transport, clientFor: () => ({ client, identity: null }),
        now, clock: () => 0, factVocabulary: [] });
    const reply = await host.start({ text: 'Where is the archive desk?', conversationId: 'keyless-example' });
    const replay = await host.enqueue(reply.sessionId), read = await createGroundingReader({ store, mas: segments.store }).get(reply.sessionId);
    const evidence = await host.evidence(reply.sessionId), refusal = await host.start({ text: 'RED FLAG', conversationId: 'keyless-example-refusal' });
    return { reply, replay, read, evidence, refusal, calls, requests: transport.stats().requests };
}
