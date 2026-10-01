import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryLightRagPersistence } from '../../packages/lightrag/src/memory-persistence.ts';
import { lightRagStored } from '../../packages/lightrag/src/persistence.ts';
import type { GraphEntityClaim } from '../../packages/lightrag/src/contracts.gen.ts';
const claim: GraphEntityClaim = { id: 'a'.repeat(64), sourceId: 's', versionId: 'v', chunkId: 'c', ordinal: 0,
    name: 'Beacon', normalizedName: 'beacon', type: 'LOCATION', description: 'A coastal landing.',
    promptRevision: 'b'.repeat(64), modelIdentity: { provider: 'fixture', model: 'scripted' }, extractedAt: null };
it('physical projection membership never changes the immutable claim payload or its content address', async () => {
    const a = lightRagStored('entity_claims', claim, 'first'), b = lightRagStored('entity_claims', claim, 'second');
    assert.notEqual(a.id, b.id); assert.deepEqual(a.payload, b.payload); assert.equal(a.payload.id, claim.id);
    const persistence = createMemoryLightRagPersistence();
    await persistence.transaction(async scope => { await scope.put('entity_claims', a); await scope.put('entity_claims', b); });
    const rows = await persistence.read(scope => scope.query('entity_claims', { projectionId: 'first' }));
    assert.equal(rows.length, 1); assert.equal(rows[0].payload.id, claim.id);
});
it('uncommitted writes stay invisible, rollback preserves prior bytes and readers cannot mutate retained rows', async () => {
    let release!: () => void, announce!: () => void, fail = false;
    const ready = new Promise<void>(resolve => { announce = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; });
    const persistence = createMemoryLightRagPersistence({ applyProbe: async step => {
        if (fail && step === 'put:entity_claims') { announce(); await barrier; throw Error('forced rollback'); }
    } });
    const first = lightRagStored('entity_claims', claim, 'first');
    await persistence.transaction(scope => scope.put('entity_claims', first));
    fail = true;
    const failed = persistence.transaction(scope => scope.put('entity_claims', lightRagStored('entity_claims', claim, 'second')));
    const assertion = assert.rejects(failed, /forced rollback/);
    await ready; const before = await persistence.read(scope => scope.query('entity_claims', {})); assert.equal(before.length, 1);
    release(); await assertion;
    const after = await persistence.read(scope => scope.query('entity_claims', {})); assert.deepEqual(after, before);
    after[0].payload.description = 'Caller mutation';
    assert.equal((await persistence.read(scope => scope.get('entity_claims', first.id)))!.payload.description, claim.description);
});
