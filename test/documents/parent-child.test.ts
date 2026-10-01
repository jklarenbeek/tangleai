import { it } from 'node:test';
import assert from 'node:assert/strict';
import { recallDocumentChunks, assertStoredDocumentBundle, ParentChildChunker, SafeStaticFetcher, createDocumentIngester } from '@tangleai/documents';
import { nodeDriver } from '@jarenjs/db/node';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createDocumentStore, openTangleDb } from '@tangleai/store';
import { localCorpus } from '../fixtures/grounding/local-corpus.ts';
it('retains true parents, bounds children and embeds only children', async () => {
    const f = await localCorpus();
    try {
        const first = await f.ingester.ingest(f.input), chunks = await f.store.listChunks(first.version.id), parents = await f.store.listParents(first.version.id);
        assert.ok(parents.length > 1); assert.equal(first.version.metrics.parents, parents.length);
        assert.equal(first.version.metrics.embeddingCalls, Math.ceil(chunks.length / 32));
        assert.deepEqual(first.version.chunkerConfig, { parentTokens: 350, maxTokens: 100, overlapTokens: 20 });
        assert.ok(chunks.every(c => c.tokenCount <= 100 && c.parentId === undefined && parents.some(p => p.id === c.parentChunkId && p.childIds.includes(c.id) && p.versionId === c.versionId && c.elementIds.every(id => p.elementIds.includes(id)))));
        assert.ok(chunks.some(c => c.carriedElementIds!.length)); assert.ok(parents.every(p => p.tokenCount <= 350 && !('embedding' in p)));
        const second = await f.ingester.ingest(f.input); assert.equal(second.status, 'unchanged'); assert.equal(second.version.id, first.version.id);
        const [query] = await f.embedder.embed(['RIVERCARD-2 appointment desk']);
        const recall = await recallDocumentChunks(f.store, query, { model: f.embedder.model, dims: 64 }, { k: 4, neighbours: 100 });
        assert.ok(recall.ranked.length); for (const hit of recall.ranked) { assert.equal(hit.context.length, 1); assert.equal(hit.context[0].id, hit.chunk.parentChunkId); }
        f.change(); await f.ingester.ingest(f.input);
        assert.deepEqual(await f.store.listParents(first.version.id), parents);
        assert.equal((await f.store.getVersion(first.version.id))!.status, 'superseded');
        assert.ok((await recallDocumentChunks(f.store, query, { model: f.embedder.model, dims: 64 })).ranked.every(r => r.chunk.versionId !== first.version.id));
    } finally { await f.db.close(); }
});
it('reindexes different parent budgets without conditional reuse and records effective clamping', async () => {
    const f = await localCorpus();
    try {
        const first = await f.ingester.ingest(f.input);
        const next = await f.ingester.ingest({ ...f.input, parentTokens: 500 });
        assert.notEqual(next.version.id, first.version.id); assert.equal(next.status, 'ingested');
        assert.equal(f.requests.at(-1)!.get('if-none-match'), null);
        assert.equal(new ParentChildChunker({ parentTokens: 1, maxTokens: 10, overlapTokens: 100 }).parentTokens, 16);
        assert.throws(() => new ParentChildChunker({ parentTokens: NaN, maxTokens: 100, overlapTokens: 10 }));
    } finally { await f.db.close(); }
});
it('refuses dangling parent membership before any corpus activation', async () => {
    const f = await localCorpus();
    try {
        const bundle = await f.staged(); bundle.chunks[0].parentChunkId = 'foreign';
        assert.throws(() => assertStoredDocumentBundle(bundle), /true parent/);
        await assert.rejects(() => f.store.activate(bundle), /true parent/);
        assert.deepEqual(await f.store.listSources(), []); assert.deepEqual(await f.store.listParents(), []);
    } finally { await f.db.close(); }
});
it('preserves source paragraph references while expanding explicit parents across repeated headings', async () => {
    const paragraph = (n: number) => `<p>${Array.from({ length: 60 }, (_, i) => `Sentence ${n}-${i} states a distinct fact about relay policy number ${n * 100 + i}.`).join(' ')}</p>`;
    const html = `<!doctype html><html><body><main><h1>Guide</h1><h2>Notes</h2>${paragraph(1)}${paragraph(2)}<h2>Details</h2>${paragraph(3)}<h2>Notes</h2>${paragraph(4)}${paragraph(5)}</main></body></html>`;
    for (const parent of [false, true]) {
        const db = await openTangleDb({ driver: nodeDriver() }), store = createDocumentStore(db), embedder = createHashEmbedder({ dims: 64 });
        try {
            const ingester = createDocumentIngester({ store, embedder, fetcher: new SafeStaticFetcher({
                fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }),
                lookup: async () => [{ address: '93.184.216.34', family: 4 }], limits: { respectRobots: false, perHostDelayMs: 0 },
            }) });
            const out = await ingester.ingest({ url: 'https://docs.example/guide', ...(parent ? { strategy: 'parent-child' as const, parentTokens: 2000, maxTokens: 400, overlapTokens: 50 } : {}) });
            const chunks = await store.listChunks(out.version.id), elements = await store.listElements(out.version.id), parents = await store.listParents(out.version.id);
            const byId = new Map(elements.map(element => [element.id, element]));
            const [query] = await embedder.embed(['relay policy number 105']);
            const recall = await recallDocumentChunks(store, query, { model: embedder.model, dims: 64 }, { k: 3, neighbours: 0 });
            if (parent) {
                const shared = chunks.slice(1).flatMap((chunk, i) => chunk.elementIds.filter(id => chunks[i].elementIds.includes(id)));
                assert.ok(shared.length > 0, 'different primary slices retain the same original paragraph address');
                assert.ok(shared.every(id => byId.get(id)!.text.length > (400 - 50) * 4), 'overlap alone cannot grant primary ownership');
                assert.ok(chunks.every(chunk => parents.some(p => p.id === chunk.parentChunkId && p.childIds.includes(chunk.id))));
                assert.ok(recall.ranked.every(hit => hit.context.length === 1 && hit.context[0].id === hit.chunk.parentChunkId));
            } else {
                const notes = chunks.filter(chunk => chunk.headingPath.join('/') === 'Guide/Notes');
                assert.equal(byId.get(notes[0].parentId!)!.order, 1);
                assert.equal(byId.get(notes.at(-1)!.parentId!)!.order, 6);
                const hit = recall.ranked.find(value => value.chunk.order === 2);
                assert.ok(hit); assert.ok(hit.context.every(chunk => chunk.order <= hit.chunk.order));
            }
        } finally { await db.close(); }
    }
});
