import { createHashEmbedder } from '@tangleai/models/embed';
import { SafeStaticFetcher, createDocumentIngester, type IngestUrlInput, type StoredDocumentBundle } from '@tangleai/documents';
import { createDocumentStore, createGroundingStore, openTangleDb } from '@tangleai/store';
import { groundingIdOf, loadGroundingProfile, type CorpusManifest, type StoreOutcome } from '@tangleai/grounding';
import profileDocument from './profile-minimal.json' with { type: 'json' };
export const LOCAL_AT = '2026-06-01T00:00:00.000Z';
export const selection = { k: 6, minScore: 0, maxPerSource: 2, contextTokens: 3000 };
export function ok<T>(value: StoreOutcome<T>) { if (!value.ok) throw Error(JSON.stringify(value.issue)); return value.value; }
export async function localCorpus() {
    const db = await openTangleDb(), store = createDocumentStore(db), grounding = createGroundingStore(db), embedder = createHashEmbedder({ dims: 64 });
    const checked = await loadGroundingProfile(profileDocument); if (!checked.valid) throw Error('profile'); const profile = checked.value;
    ok(await grounding.putProfile(profile));
    const session = ok(await grounding.createSession({ conversationId: 'local-test', profileId: profile.id, profileRevision: profile.revision }));
    let body = '<!doctype html><html><body><main><h1>Archive guide</h1>' + Array.from({ length: 12 }, (_, n) => `<h2>Record ${n}</h2><p>${(`The RIVERCARD-${n} archive appointment desk opens at eight and closes at seventeen. Bring the blue form to the harbour records office. `).repeat(8)}</p>`).join('') + '</main></body></html>';
    const requests: Headers[] = [];
    const fetcher = new SafeStaticFetcher({ now: () => LOCAL_AT,
        lookup: async () => [{ address: '93.184.216.34', family: 4 }], limits: { respectRobots: false, perHostDelayMs: 0 },
        fetch: async (_url, init) => { requests.push(new Headers(init?.headers)); return new Response(body, { headers: { 'content-type': 'text/html', etag: 'fixture-tag', 'last-modified': 'Mon, 01 Jan 2099 00:00:00 GMT' } }); },
    });
    const input: IngestUrlInput = { url: 'https://official.harbour.example/archive', strategy: 'parent-child', parentTokens: 350, maxTokens: 100, overlapTokens: 20, allowBrowser: false };
    const ingester = createDocumentIngester({ store, embedder, fetcher, now: () => LOCAL_AT });
    return { db, store, grounding, embedder, profile, session, input, ingester, requests,
        change() { body = body.replaceAll('blue form', 'green form'); },
        async staged() {
            let bundle: StoredDocumentBundle | undefined;
            const staging = { ...store, async activate(value: StoredDocumentBundle) { bundle = value; }, async recordFailure() {} };
            await createDocumentIngester({ store: staging, embedder, fetcher, now: () => LOCAL_AT }).ingest({ ...input, force: true });
            if (!bundle) throw Error('No staged bundle'); return bundle;
        },
        async manifest(bundle: StoredDocumentBundle): Promise<CorpusManifest> {
            const payload = { profileId: profile.id, profileRevision: profile.revision, sourceId: bundle.source.id, versionId: bundle.version.id,
                status: 'active' as const, canonicalUrl: bundle.source.canonicalUrl, institution: 'Harbour District Service Office', authorityTier: 'official' as const,
                jurisdiction: profile.jurisdiction, language: 'en', contentHash: bundle.version.contentHash,
                times: { provenance: 'curator' as const, reviewedAt: LOCAL_AT }, curator: { decision: 'promote' as const, by: 'fixture-curator', at: LOCAL_AT } };
            return { ...payload, id: await groundingIdOf('manifest', payload) };
        },
    };
}
