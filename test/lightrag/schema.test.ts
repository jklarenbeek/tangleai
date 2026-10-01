import { it } from 'node:test';
import assert from 'node:assert/strict';
import { validateLightRagShape, lightRagSchema } from '../../packages/lightrag/src/schema.ts';
const hash = 'a'.repeat(64);
const claim = { id: hash, sourceId: 'source', versionId: 'version', chunkId: 'chunk', ordinal: 0,
    name: 'Beacon', normalizedName: 'beacon', type: 'LOCATION', description: 'A coastal landing.',
    promptRevision: hash, modelIdentity: { provider: 'fixture', model: 'scripted' }, extractedAt: null };
it('claim shapes are closed, JSON-only and credential-free at every identity boundary', () => {
    assert.equal(validateLightRagShape('graphEntityClaim', claim).valid, true);
    for (const value of [{ ...claim, apiKey: 'no' }, { ...claim, modelIdentity: { ...claim.modelIdentity, apiKey: 'no' } },
        { ...claim, ordinal: -1 }, { ...claim, extractedAt: '2026-02-31T00:00:00Z' }, { ...claim, extractedAt: new Date() },
        { ...claim, callback: () => undefined }]) assert.equal(validateLightRagShape('graphEntityClaim', value).valid, false);
});
it('a canonical cannot exist without its support, vector identity or merged-row target', () => {
    const entity = { id: hash, name: 'Beacon', normalizedName: 'beacon', aliases: [], types: ['LOCATION'],
        profile: 'A coastal landing.', supportClaimIds: [hash], supportChunkIds: ['chunk'], embedding: [1, 0],
        embeddedBy: { model: 'hash', dims: 2 }, status: 'active', revision: hash };
    assert.equal(validateLightRagShape('graphEntity', entity).valid, true);
    for (const value of [{ ...entity, supportClaimIds: [] }, { ...entity, supportChunkIds: [] },
        { ...entity, status: 'merged' }, { ...entity, status: 'active', mergedInto: hash }]) {
        const result = validateLightRagShape('graphEntity', value);
        assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TLRAG1001');
    }
});
it('every object record refuses undeclared properties and all ten refusal codes are declared', () => {
    const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) { value.forEach(visit); return; }
        const record = value as Record<string, unknown>;
        if (record.type === 'object') assert.equal(record.additionalProperties, false);
        Object.values(record).forEach(visit);
    };
    visit(lightRagSchema);
    for (let n = 1001; n <= 1010; n++) assert.equal(validateLightRagShape('lightRagIssue', { code: 'TLRAG' + n, path: '', detail: 'Named failure.' }).valid, true);
});
