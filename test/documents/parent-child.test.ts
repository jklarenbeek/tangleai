import { it } from 'node:test';
import assert from 'node:assert/strict';
import { recallDocumentChunks, assertStoredDocumentBundle, ParentChildChunker } from '@tangleai/documents';
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
