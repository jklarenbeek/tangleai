import { it } from 'node:test';
import assert from 'node:assert/strict';
import { claimIdOf, canonicalEntityIdOf, canonicalRelationIdOf, canonicalGraphRevisionOf } from '../../packages/lightrag/src/identity.ts';
import { foldEntityName } from '../../packages/lightrag/src/normalize.ts';
import { validateGraphClaim, validateCanonicalEntity, validateCanonicalRelation } from '../../packages/lightrag/src/integrity.ts';
import type { GraphEntityClaim, GraphRelationClaim, GraphEntity, GraphRelation } from '../../packages/lightrag/src/contracts.gen.ts';
const modelIdentity = { provider: 'fixture', model: 'scripted' }, embeddedBy = { model: 'hash', dims: 2 };
const address = { sourceId: 'source', versionId: 'version', chunkId: 'chunk', ordinal: 0, promptRevision: 'b'.repeat(64), modelIdentity, extractedAt: null };
async function entityClaim(name: string, type: GraphEntityClaim['type'] = 'ORGANIZATION'): Promise<GraphEntityClaim> {
    const body = { ...address, name, normalizedName: foldEntityName(name), type, description: name + ' has a recorded role.' };
    return { ...body, id: await claimIdOf(body) };
}
async function entity(claim: GraphEntityClaim, identityClaimId?: string): Promise<GraphEntity> {
    const body = { id: await canonicalEntityIdOf(claim.name, claim.type, identityClaimId), name: claim.name, normalizedName: claim.normalizedName,
        aliases: [], types: [claim.type], profile: claim.description, supportClaimIds: [claim.id], supportChunkIds: [claim.chunkId],
        embedding: [1, 0], embeddedBy, status: 'active' as const, ...(identityClaimId === undefined ? {} : { identityClaimId }) };
    return { ...body, revision: await canonicalGraphRevisionOf(body) };
}
async function edge(a: GraphEntity, b: GraphEntity): Promise<{ claim: GraphRelationClaim; row: GraphRelation }> {
    const body = { ...address, sourceName: a.name, targetName: b.name, normalizedSource: a.normalizedName, normalizedTarget: b.normalizedName,
        description: 'An equipment-sharing agreement.', themes: ['equipment'], strength: 0.8 };
    const claim = { ...body, id: await claimIdOf(body) };
    const value = { id: await canonicalRelationIdOf(a.id, b.id, body.themes), sourceEntityId: a.id, targetEntityId: b.id, themes: body.themes,
        strength: body.strength, profile: body.description, supportClaimIds: [claim.id], supportChunkIds: [claim.chunkId], embedding: [1, 0], embeddedBy, status: 'active' as const };
    return { claim, row: { ...value, revision: await canonicalGraphRevisionOf(value) } };
}
function code(result: { valid: boolean; issues?: Array<{ code: string }> }): string | undefined { return result.issues?.[0].code; }
it('claims resolve to the exact source version and immutable bytes before they can support a canonical', async () => {
    const claim = await entityClaim('Beacon'), chunks = [{ id: claim.chunkId, sourceId: claim.sourceId, versionId: claim.versionId }];
    assert.equal((await validateGraphClaim('entity', claim, chunks)).valid, true);
    assert.equal(code(await validateGraphClaim('entity', claim, [])), 'TLRAG1003');
    assert.equal(code(await validateGraphClaim('entity', claim, [{ ...chunks[0], versionId: 'foreign' }])), 'TLRAG1003');
    assert.equal(code(await validateGraphClaim('entity', { ...claim, description: 'Unbound replacement' }, chunks)), 'TLRAG1002');
    assert.equal(code(await validateGraphClaim('entity', claim, [chunks[0], chunks[0]])), 'TLRAG1003');
});
it('canonical evidence is the exact union of supported claims, and vectors carry one compatible identity', async () => {
    const claim = await entityClaim('Beacon'), row = await entity(claim);
    assert.equal((await validateCanonicalEntity(row, [claim], { expectedEmbeddedBy: embeddedBy })).valid, true);
    assert.equal(code(await validateCanonicalEntity({ ...row, supportClaimIds: [] }, [claim])), 'TLRAG1001');
    assert.equal(code(await validateCanonicalEntity(row, [])), 'TLRAG1003');
    assert.equal(code(await validateCanonicalEntity({ ...row, supportChunkIds: ['foreign'] }, [claim])), 'TLRAG1003');
    assert.equal(code(await validateCanonicalEntity({ ...row, embedding: [1] }, [claim])), 'TLRAG1002');
    assert.equal(code(await validateCanonicalEntity(row, [claim], { expectedEmbeddedBy: { ...embeddedBy, model: 'foreign' } })), 'TLRAG1002');
});
it('a homonym discriminator must be backed by one of the new canonical’s own claims', async () => {
    const claim = await entityClaim('Beacon'), legitimate = await entity(claim, claim.id), forged = await entity(claim, 'f'.repeat(64));
    assert.equal((await validateCanonicalEntity(legitimate, [claim])).valid, true);
    assert.equal(code(await validateCanonicalEntity(forged, [claim])), 'TLRAG1003');
});
it('a same-name different-type claim cannot be laundered into another canonical', async () => {
    const organization = await entityClaim('Beacon'), place = await entityClaim('Beacon', 'LOCATION'), row = await entity(organization);
    const forged = { ...row, supportClaimIds: [place.id] }; forged.revision = await canonicalGraphRevisionOf(forged);
    assert.equal(code(await validateCanonicalEntity(forged, [place])), 'TLRAG1006');
});
it('reversed endpoints and a different theme remain distinct even after every content address is rehashed', async () => {
    const aClaim = await entityClaim('Cedar'), bClaim = await entityClaim('Willow'), a = await entity(aClaim), b = await entity(bClaim), original = await edge(a, b);
    assert.equal((await validateCanonicalRelation(original.row, [original.claim], [a, b])).valid, true);
    const reversed = { ...original.row, sourceEntityId: b.id, targetEntityId: a.id, id: await canonicalRelationIdOf(b.id, a.id, original.row.themes) };
    reversed.revision = await canonicalGraphRevisionOf(reversed);
    assert.equal(code(await validateCanonicalRelation(reversed, [original.claim], [a, b])), 'TLRAG1006');
    const changed = { ...original.row, themes: ['funding'], id: await canonicalRelationIdOf(a.id, b.id, ['funding']) }; changed.revision = await canonicalGraphRevisionOf(changed);
    assert.equal(code(await validateCanonicalRelation(changed, [original.claim], [a, b])), 'TLRAG1006');
    assert.equal(code(await validateCanonicalRelation(original.row, [original.claim], [a])), 'TLRAG1003');
});
