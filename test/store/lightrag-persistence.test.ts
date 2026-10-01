import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '@jarenjs/db';
import { TANGLE_DB_MODEL, pickDriver, createDbMemoryStore, createDocumentStore, createTemporalDbStore } from '@tangleai/store';
import { createMemoryUnit } from '@tangleai/memory';
import { LIGHTRAG_COLLECTIONS } from '../../packages/store/src/lightrag-model.ts';
import { createLightRagDbPersistence, lightRagReadDocument } from '../../packages/store/src/lightrag-store.ts';
import { lightRagStored } from '../../packages/lightrag/src/persistence.ts';
import type { GraphEntityClaim, GraphRelation } from '../../packages/lightrag/src/contracts.gen.ts';
import { buildTemporalFixture } from '../../benchmark/lib/temporal-runtime-fixtures.ts';
import { TEMPORAL_FIXTURES } from '../fixtures/temporal.ts';
const model = { ...TANGLE_DB_MODEL, collections: { ...TANGLE_DB_MODEL.collections, ...LIGHTRAG_COLLECTIONS } };
const claim: GraphEntityClaim = { id: 'a'.repeat(64), sourceId: 's', versionId: 'v', chunkId: 'c', ordinal: 0,
    name: 'Beacon', normalizedName: 'beacon', type: 'LOCATION', description: 'A coastal landing.',
    promptRevision: 'b'.repeat(64), modelIdentity: { provider: 'fixture', model: 'scripted' }, extractedAt: null };
it('the six SQL collections preserve membership and roll back every failed write', async () => {
    const db = await openStore(model, { driver: pickDriver() }); let fail = false;
    const persistence = createLightRagDbPersistence(db, { applyProbe: step => { if (fail && step === 'put:entity_claims') throw Error('forced rollback'); } });
    try {
        const original = lightRagStored('entity_claims', claim, 'first');
        await persistence.transaction(scope => scope.put('entity_claims', original));
        const before = await persistence.read(scope => scope.query('entity_claims', {}));
        fail = true;
        await assert.rejects(persistence.transaction(scope => scope.put('entity_claims', lightRagStored('entity_claims', claim, 'second'))), /forced rollback/);
        assert.deepEqual(await persistence.read(scope => scope.query('entity_claims', {})), before);
        fail = false; await persistence.transaction(scope => scope.put('entity_claims', lightRagStored('entity_claims', claim, 'second')));
        assert.equal((await persistence.read(scope => scope.query('entity_claims', { projectionId: 'second' }))).length, 1);
        assert.deepEqual(await persistence.read(scope => scope.query('entity_claims', { ids: [] })), []);
        assert.equal((await db.integrityCheck()).ok, true);
    } finally { await db.close(); }
});
it('SQL adjacency includes both directions while keeping unrelated edges out', async () => {
    const db = await openStore(model, { driver: pickDriver() }), persistence = createLightRagDbPersistence(db);
    const relation = (id: string, sourceEntityId: string, targetEntityId: string): GraphRelation => ({
        id, sourceEntityId, targetEntityId, themes: ['transport'], strength: 1, profile: 'An evidenced transport link.',
        supportClaimIds: [claim.id], supportChunkIds: ['c'], embedding: [1, 0], embeddedBy: { model: 'fixture', dims: 2 }, status: 'active', revision: 'c'.repeat(64),
    });
    try {
        await persistence.transaction(async scope => {
            for (const row of [relation('1'.repeat(64), 'a', 'b'), relation('2'.repeat(64), 'b', 'a'), relation('3'.repeat(64), 'c', 'd')])
                await scope.put('relations', lightRagStored('relations', row));
        });
        const rows = await persistence.read(scope => scope.query('relations', { entityIds: ['a'], status: 'active' }));
        assert.deepEqual(rows.map(row => row.id), ['1'.repeat(64), '2'.repeat(64)]);
        assert.deepEqual(await persistence.read(scope => scope.query('relations', { entityIds: [] })), []);
        assert.ok(await db.collection('lightrag_relations').explain(lightRagReadDocument({ entityIds: ['a'], status: 'active' })));
    } finally { await db.close(); }
});
it('the additive graph model preserves existing memories, document sources and temporal state on real reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lightrag-model-')), path = join(directory, 'state.db');
    const oldModel = { ...TANGLE_DB_MODEL, collections: Object.fromEntries(Object.entries(TANGLE_DB_MODEL.collections).filter(([name]) => !name.startsWith('lightrag_'))) };
    const old = await openStore(oldModel, { path, driver: pickDriver() });
    const memory = createMemoryUnit({ text: 'Retain the authored state.', evidence: 'fixture', at: '2024-01-01T00:00:00Z' });
    const source = { id: 'source', requestedUrl: 'https://fixture.example/a', finalUrl: 'https://fixture.example/a', canonicalUrl: 'https://fixture.example/a',
        title: 'A retained source', mimeType: 'text/markdown', fetchMode: 'static' as const, status: 'ready' as const, fetchedAt: '2024-01-01T00:00:00Z' };
    let snapshot: unknown;
    const { expected: _, ...fixture } = TEMPORAL_FIXTURES.find(row => row.id === 'T01')!, built = await buildTemporalFixture(fixture);
    assert.equal(built.status, 'success'); if (built.status !== 'success') throw Error('Temporal fixture did not build.');
    try {
        await createDbMemoryStore(old.collection('memories')).put(memory); await createDocumentStore(old).putSource(source);
        const temporal = createTemporalDbStore(old), applied = await temporal.apply(built.value.bundle, { key: 'before-graph', expectedHead: null });
        assert.equal(applied.status, 'success'); snapshot = await temporal.snapshot(built.value.bundle.projection.scope);
    } finally { await old.close(); }
    const db = await openStore(model, { path, driver: pickDriver() });
    try {
        assert.deepEqual(await createDbMemoryStore(db.collection('memories')).get(memory.id), memory);
        assert.deepEqual(await createDocumentStore(db).getSource(source.id), source);
        assert.deepEqual(await createTemporalDbStore(db).snapshot(built.value.bundle.projection.scope), snapshot);
        const persistence = createLightRagDbPersistence(db);
        await persistence.transaction(scope => scope.put('entity_claims', lightRagStored('entity_claims', claim, 'first')));
        assert.equal((await persistence.read(scope => scope.query('entity_claims', {}))).length, 1);
        assert.equal((await db.integrityCheck()).ok, true);
    } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});
