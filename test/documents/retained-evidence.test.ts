import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createDocumentStore, openTangleDb } from '@tangleai/store';
import { SafeStaticFetcher, createDocumentIngester, recallDocumentChunks } from '@tangleai/documents';

async function fixture() {
    const paragraph = (n: number) => `<p>${Array.from({ length: 60 }, (_, i) => `Sentence ${n}-${i} states a distinct fact about relay policy number ${n * 100 + i}.`).join(' ')}</p>`;
    let html = `<!doctype html><html><body><main><h1>Guide</h1><h2>Notes</h2>${paragraph(1)}${paragraph(2)}<h2>Details</h2>${paragraph(3)}<h2>Notes</h2>${paragraph(4)}${paragraph(5)}</main></body></html>`;
    const db = await openTangleDb(), store = createDocumentStore(db), embedder = createHashEmbedder({ dims: 64 });
    const ingester = createDocumentIngester({ store, embedder, now: () => '2026-06-01T00:00:00.000Z', fetcher: new SafeStaticFetcher({
        fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), now: () => '2026-06-01T00:00:00.000Z',
        lookup: async () => [{ address: '93.184.216.34', family: 4 }], limits: { respectRobots: false, perHostDelayMs: 0 },
    }) });
    const first = await ingester.ingest({ url: 'https://docs.example/guide' });
    return { db, store, embedder, ingester, first, change() { html = html.replace('policy number 105', 'revised policy number 905'); } };
}
it('a repeated heading path resolves to the preceding heading', async () => {
    const f = await fixture();
    try {
        const chunks = await f.store.listChunks(f.first.version.id), elements = await f.store.listElements(f.first.version.id);
        const firstNotes = elements.find(e => e.role === 'heading' && e.text === 'Notes')!;
        assert.equal(firstNotes.order, 1);
        assert.equal(chunks[2].parentId, firstNotes.id);
    } finally { await f.db.close(); }
});
it('expansion never picks a later chunk through a shared overlap element id', async () => {
    const f = await fixture();
    try {
        const [query] = await f.embedder.embed(['relay policy number 105']);
        const recall = await recallDocumentChunks(f.store, query, { model: f.embedder.model, dims: 64 }, { k: 3, neighbours: 0 });
        const hit = recall.ranked.find(row => row.chunk.order === 2)!;
        assert.ok(hit); assert.deepEqual(hit.context.map(c => c.order), [0, 2]);
    } finally { await f.db.close(); }
});
it('superseded chunks and elements are retained and excluded from recall', async () => {
    const f = await fixture();
    try {
        const chunks = await f.store.listChunks(f.first.version.id), elements = await f.store.listElements(f.first.version.id);
        f.change(); const second = await f.ingester.ingest({ url: 'https://docs.example/guide' });
        assert.notEqual(second.version.id, f.first.version.id);
        assert.equal((await f.store.getVersion(f.first.version.id))!.status, 'superseded');
        assert.deepEqual(await f.store.listChunks(f.first.version.id), chunks);
        assert.deepEqual(await f.store.listElements(f.first.version.id), elements);
        const [query] = await f.embedder.embed(['relay policy number 105']);
        const recall = await recallDocumentChunks(f.store, query, { model: f.embedder.model, dims: 64 }, { k: 100 });
        assert.ok(recall.ranked.every(row => row.chunk.versionId === second.version.id));
    } finally { await f.db.close(); }
});
