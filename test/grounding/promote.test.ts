import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createGroundingStore } from '@tangleai/store';
import { createMemoryGroundingStore, promoteToCorpus, type CorpusManifest } from '@tangleai/grounding';
import { localCorpus, ok } from '../fixtures/grounding/local-corpus.ts';
it('requires curator provenance and a shared transaction binding before writing', async () => {
    const f = await localCorpus();
    try {
        const bundle = await f.staged(), manifest = await f.manifest(bundle), { curator: _, ...uncurated } = manifest;
        const rejected = await promoteToCorpus(f.grounding, uncurated as CorpusManifest, bundle);
        assert.ok(!rejected.ok); assert.equal(rejected.issue.code, 'TGRD1010');
        assert.deepEqual(await f.store.listSources(), []); assert.equal(await f.grounding.getManifest(manifest.sourceId, manifest.versionId), undefined);
        const unbound = createMemoryGroundingStore(); ok(await unbound.putProfile(f.profile));
        const missing = await promoteToCorpus(unbound, manifest, bundle); assert.ok(!missing.ok); assert.equal(missing.issue.code, 'TGRD1009');
        assert.equal(await unbound.getManifest(manifest.sourceId, manifest.versionId), undefined);
    } finally { await f.db.close(); }
});
it('rolls back corpus and manifest writes together, then promotes exactly once', async () => {
    const f = await localCorpus();
    try {
        const bundle = await f.staged(), manifest = await f.manifest(bundle); let writes = 0;
        const faulted = createGroundingStore(f.db, { applyProbe(step) { if (step.startsWith('put:') && ++writes === 2) throw Error('forced second write'); } });
        const failed = await promoteToCorpus(faulted, manifest, bundle); assert.ok(!failed.ok); assert.equal(failed.issue.code, 'TGRD1009');
        assert.deepEqual(await f.store.listSources(), []); assert.deepEqual(await f.store.listChunks(), []); assert.deepEqual(await f.store.listParents(), []);
        assert.equal(await f.grounding.getManifest(manifest.sourceId, manifest.versionId), undefined);
        const first = await promoteToCorpus(f.grounding, manifest, bundle); assert.ok(first.ok); assert.ok(first.changes > 0);
        const replay = await promoteToCorpus(f.grounding, manifest, bundle); assert.ok(replay.ok); assert.equal(replay.changes, 0);
        assert.deepEqual(await f.grounding.getManifest(manifest.sourceId, manifest.versionId), manifest);
        assert.equal((await f.store.getSource(bundle.source.id))!.activeVersionId, bundle.version.id);
    } finally { await f.db.close(); }
});
it('supersedes both active records atomically and retains old evidence without allowing implicit reactivation', async () => {
    const f = await localCorpus();
    try {
        const first = await f.staged(), before = await f.manifest(first); ok(await promoteToCorpus(f.grounding, before, first));
        const retained = await f.store.listParents(first.version.id); f.change(); const next = await f.staged(), after = await f.manifest(next);
        const faulted = createGroundingStore(f.db, { applyProbe(step) { if (step === 'put:document_parents') throw Error('forced parent failure'); } });
        assert.ok(!(await promoteToCorpus(faulted, after, next)).ok);
        assert.equal((await f.grounding.getManifest(before.sourceId, before.versionId))!.status, 'active');
        assert.equal((await f.store.getSource(first.source.id))!.activeVersionId, first.version.id);
        ok(await promoteToCorpus(f.grounding, after, next));
        assert.equal((await f.grounding.getManifest(before.sourceId, before.versionId))!.status, 'superseded');
        assert.equal((await f.store.getVersion(first.version.id))!.status, 'superseded');
        assert.deepEqual(await f.store.listParents(first.version.id), retained);
        const replayOld = await promoteToCorpus(f.grounding, before, first); assert.ok(!replayOld.ok); assert.equal(replayOld.issue.code, 'TGRD1002');
        const mismatched = await promoteToCorpus(f.grounding, { ...after, contentHash: '0'.repeat(64) }, next);
        assert.ok(!mismatched.ok); assert.equal(mismatched.issue.code, 'TGRD1002');
    } finally { await f.db.close(); }
});
it('refuses changed retained evidence at an existing address without partial writes', async () => {
    const f = await localCorpus();
    try {
        const bundle = await f.staged(), manifest = await f.manifest(bundle);
        ok(await promoteToCorpus(f.grounding, manifest, bundle));
        const before = { chunks: await f.store.listChunks(), parents: await f.store.listParents(),
            elements: await f.store.listElements(bundle.version.id), version: await f.store.getVersion(bundle.version.id) };
        for (const field of ['chunks', 'parents', 'elements'] as const) {
            const changed = structuredClone(bundle);
            changed[field]![0]!.text += ' Forged replacement evidence.';
            const result = await promoteToCorpus(f.grounding, manifest, changed);
            assert.ok(!result.ok, `${field} at a retained address cannot change`);
            assert.match(result.issue.cause?.message ?? result.issue.detail, /retained evidence/i);
            assert.deepEqual({ chunks: await f.store.listChunks(), parents: await f.store.listParents(),
                elements: await f.store.listElements(bundle.version.id), version: await f.store.getVersion(bundle.version.id) }, before);
        }
    } finally { await f.db.close(); }
});
