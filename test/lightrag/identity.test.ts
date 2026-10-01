import { it } from 'node:test';
import assert from 'node:assert/strict';
import { claimIdOf, canonicalEntityIdOf, canonicalRelationIdOf, projectionIdOf, immutableLightRagJson } from '../../packages/lightrag/src/identity.ts';
it('content addresses ignore property order while retaining evidence, type, direction and themes', async () => {
    assert.equal(await claimIdOf({ name: 'Beacon', chunkId: 'a' }), await claimIdOf({ chunkId: 'a', name: 'Beacon' }));
    assert.notEqual(await claimIdOf({ name: 'Beacon', chunkId: 'a' }), await claimIdOf({ name: 'Beacon', chunkId: 'b' }));
    assert.equal(await canonicalEntityIdOf(' Ｂｅａｃｏｎ ', 'LOCATION'), await canonicalEntityIdOf('beacon', 'LOCATION'));
    assert.notEqual(await canonicalEntityIdOf('Beacon', 'LOCATION'), await canonicalEntityIdOf('Beacon', 'CONCEPT'));
    assert.notEqual(await canonicalRelationIdOf('a', 'b', ['training']), await canonicalRelationIdOf('b', 'a', ['training']));
    assert.notEqual(await canonicalRelationIdOf('a', 'b', ['training']), await canonicalRelationIdOf('a', 'b', ['equipment']));
    assert.equal(await canonicalRelationIdOf('a', 'b', ['x', 'Y']), await canonicalRelationIdOf('a', 'b', [' y ', 'x', 'x']));
    assert.notEqual(await projectionIdOf('a', 'v', 'extractor-1'), await projectionIdOf('a', 'v', 'extractor-2'));
});
it('an immutable input cannot retain a caller-owned mutation or a non-JSON member', () => {
    const original = { nested: { id: 'a' } }, snapshot = immutableLightRagJson(original); original.nested.id = 'b';
    assert.equal(snapshot.nested.id, 'a'); assert.equal(Object.isFrozen(snapshot.nested), true);
    assert.throws(() => immutableLightRagJson({ invalid: () => undefined }));
});

it('a supporting claim can distinguish reviewed homonyms with the same normalized name and type', async () => {
    const first = await canonicalEntityIdOf('Beacon', 'ORGANIZATION', 'a'.repeat(64));
    const second = await canonicalEntityIdOf('Ｂｅａｃｏｎ', 'ORGANIZATION', 'b'.repeat(64));
    assert.notEqual(first, second);
    assert.equal(first, await canonicalEntityIdOf(' beacon ', 'ORGANIZATION', 'a'.repeat(64)));
    assert.notEqual(first, await canonicalEntityIdOf('Beacon', 'ORGANIZATION'));
});
