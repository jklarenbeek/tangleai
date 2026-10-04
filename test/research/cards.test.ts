import assert from 'node:assert/strict';
import { it } from 'node:test';
import { openTangleDb } from '@tangleai/store';
import { acquireResearchSources, screenLiterature, executeScholarlyDiscovery, resolveEvidenceCard, toAdmittedArtifact, researchArtifactIdOf } from '@tangleai/research';
import { loadResearchFixture } from '../../benchmark/lib/research-fixture.ts';
import { createResearchDiscoveryFixture } from '../../benchmark/lib/research-discovery.ts';

it('deleting all document_chunks leaves cards resolvable against retained versions and full source bytes', async () => {
  const loaded = await loadResearchFixture(), db = await openTangleDb();
  const host = await createResearchDiscoveryFixture(loaded, loaded.topics[0], db), signal = new AbortController().signal;
  try {
    const found = await executeScholarlyDiscovery(host.options.plan, host.options.provider, signal, host.options.searxngBaseUrl);
    const screening = await screenLiterature(host.options.plan.projectId, host.options.criteria, found.literature);
    const acquired = await acquireResearchSources(found.literature, screening, host.options.documents,
      { signal, promptRevision: host.options.extractionPromptRevision, limits: host.options.acquisition });
    assert.equal(acquired.cards.length, 16); assert.ok((await host.store.listElements(acquired.cards[0].versionId)).length);
    const chunks = await db.collection<{ id: string }>('document_chunks').execute({ $for: { row: '$[*]' }, $return: '$row' });
    assert.ok(Array.isArray(chunks) && chunks.length > 0);
    for (const chunk of chunks as Array<{ id: string }>) await db.collection('document_chunks').delete(chunk.id);
    const sourceBytes = new Map(await Promise.all(acquired.artifacts.map(async a => [await researchArtifactIdOf(a.bytes), a.bytes] as const)));
    for (const card of acquired.cards) {
      assert.match(card.versionId, /^ver-[0-9a-f]{32}$/);
      assert.equal((await resolveEvidenceCard(card, host.store, async id => sourceBytes.get(id)!)).valid, true);
      assert.deepEqual(toAdmittedArtifact(card), { id: card.id, kind: 'evidence-card', locator: card.versionId + '#element=' + card.locator.elementOrder, digest: card.contentHash });
      assert.equal('chunkId' in card, false); assert.equal(card.artifactId, 'art-' + card.contentHash);
    }
    const original = acquired.cards[0], altered = { ...original, excerpt: original.excerpt + ' fabricated text' };
    assert.equal((await resolveEvidenceCard(altered, host.store, async id => sourceBytes.get(id)!)).valid, false);
    assert.equal((await resolveEvidenceCard(original, host.store, async () => new Uint8Array([0]))).valid, false);
    const unavailable = await resolveEvidenceCard(original, host.store, async () => { throw Error('Missing retained body.'); });
    assert.equal(unavailable.valid, false); if (!unavailable.valid) assert.equal(unavailable.issues[0].code, 'TRSH1008');
    // Re-ingestion changes the active version; the old locator remains resolvable.
    const ingested = await host.options.documents.ingester.ingest({ url: found.literature.find(r => r.id === original.literatureId)!.sourcePath,
      force: true, maxTokens: 64, overlapTokens: 0, signal });
    assert.notEqual(ingested.version.id, original.versionId);
    assert.equal((await resolveEvidenceCard(original, host.store, async id => sourceBytes.get(id)!)).valid, true);
  } finally { await host.close(); await db.close(); }
});
it('document errors and extraction limits are retained per source without invented cards', async () => {
  const loaded = await loadResearchFixture(), db = await openTangleDb(), host = await createResearchDiscoveryFixture(loaded, loaded.topics[0], db);
  try {
    const signal = new AbortController().signal, found = await executeScholarlyDiscovery(host.options.plan, host.options.provider, signal, host.options.searxngBaseUrl);
    const screening = await screenLiterature(host.options.plan.projectId, host.options.criteria, found.literature);
    const broken = { ...host.options.documents, ingester: { ingest: async () => { throw Object.assign(new Error('Fixture robots refused.'), { code: 'robots-denied' }); } } };
    const result = await acquireResearchSources(found.literature, screening, broken,
      { signal, promptRevision: host.options.extractionPromptRevision, limits: host.options.acquisition });
    assert.equal(result.cards.length, 0); assert.equal(result.acquisitions.length, 8);
    for (const acquisition of result.acquisitions) { assert.equal(acquisition.status, 'unresolved');
      assert.equal(acquisition.issues[0].code, 'TRSH1008'); assert.equal(acquisition.issues[0].cause?.code, 'robots-denied'); }
  } finally { await host.close(); await db.close(); }
});
