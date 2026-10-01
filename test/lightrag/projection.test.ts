import { it } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_HEAD } from '@tangleai/outcomes';
import { projectionIdOf } from '../../packages/lightrag/src/identity.ts';
import { lightragMust } from '../../packages/lightrag/src/errors.ts';
import { planProjectionActivation, planProjectionRetirement, sourceGraphHead } from '../../packages/lightrag/src/projection.ts';
import type { GraphProjection } from '../../packages/lightrag/src/contracts.gen.ts';
async function staged(): Promise<GraphProjection> {
    const revision = 'a'.repeat(64);
    return { id: await projectionIdOf('s', 'v', revision), sourceId: 's', versionId: 'v', contributionRevision: revision,
        head: { ...EMPTY_HEAD }, status: 'staged', identities: { extraction: 'fixture/1', chunker: { version: 'fixture/1', config: { maxTokens: 100, overlapTokens: 32 } },
            embedder: { model: 'hash', dims: 2 }, prompts: {}, model: { provider: 'fixture', model: 'scripted' } },
        counts: { claims: 0, entities: 0, relations: 0, canonicalsTouched: 0, chunks: 0 }, spend: { calls: 0, tokens: 0, ms: 0 }, entityClaimIds: [], relationClaimIds: [], chunkIds: [] };
}
it('a retired source retains its native revision fence and reactivates only identical contribution content', async () => {
    const draft = await staged(), first = lightragMust(await planProjectionActivation({ projection: draft, actualHead: EMPTY_HEAD, expectedHead: EMPTY_HEAD, at: null }));
    assert.equal(first.nextHead.revision, 1); assert.equal(first.reactivation, false);
    const retired = lightragMust(await planProjectionRetirement({ projection: first.projection, actualHead: first.nextHead, expectedHead: first.nextHead, at: null }));
    assert.equal(retired.nextHead.revision, 2); assert.deepEqual(lightragMust(sourceGraphHead([retired.projection], 's')), retired.nextHead);
    const revived = lightragMust(await planProjectionActivation({ projection: draft, previous: retired.projection, actualHead: retired.nextHead, expectedHead: retired.nextHead, at: null }));
    assert.equal(revived.reactivation, true); assert.equal(revived.nextHead.revision, 3); assert.equal(revived.projection.id, first.projection.id);
    const changed = structuredClone(draft); changed.spend.calls = 1;
    const refused = await planProjectionActivation({ projection: changed, previous: retired.projection, actualHead: retired.nextHead, expectedHead: retired.nextHead, at: null });
    assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TLRAG1006');
});
it('stale version or revision returns the original outcomes fence refusal as its cause', async () => {
    const draft = await staged(), first = lightragMust(await planProjectionActivation({ projection: draft, actualHead: EMPTY_HEAD, expectedHead: EMPTY_HEAD, at: null }));
    for (const expectedHead of [EMPTY_HEAD, { ...first.nextHead, revision: 0 }, { versionId: 'f'.repeat(64), revision: first.nextHead.revision }]) {
        const refused = await planProjectionRetirement({ projection: first.projection, actualHead: first.nextHead, expectedHead, at: null });
        assert.equal(refused.valid, false);
        if (!refused.valid) { assert.equal(refused.issues[0].code, 'TLRAG1006'); assert.equal(refused.issues[0].cause?.code, 'OUTC1013'); }
    }
});
it('active to staged, failed to active, and two simultaneous active source projections are refused', async () => {
    const draft = await staged(), first = lightragMust(await planProjectionActivation({ projection: draft, actualHead: EMPTY_HEAD, expectedHead: EMPTY_HEAD, at: null }));
    for (const previous of [first.projection, { ...draft, status: 'failed' as const }]) {
        const refused = await planProjectionActivation({ projection: draft, previous, actualHead: first.nextHead, expectedHead: first.nextHead, at: null });
        assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TLRAG1006');
    }
    assert.equal(sourceGraphHead([first.projection, first.projection], 's').valid, false);
});
