/** Projection state uses the shared outcomes fence; retired heads remain observable. */
import { EMPTY_HEAD, planHeadTransition, type Head } from '@tangleai/outcomes';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import type { GraphProjection } from './contracts.gen.ts';
import { validateLightRagShape } from './schema.ts';
import { validateGraphContribution } from './contribution.ts';
import { projectionIdOf, immutableLightRagJson } from './identity.ts';
import { lightragMust, lightragReject, lightragFailure, type LightRagOutcome } from './errors.ts';
export function projectionContent(projection: GraphProjection): object {
    const { status: _status, head: _head, activatedAt: _activated, supersededAt: _superseded, error: _error, audit: _audit, ...content } = projection;
    return content;
}
export async function validateGraphProjection(value: unknown): Promise<LightRagOutcome<GraphProjection>> {
    try {
        const projection = lightragMust(validateLightRagShape('graphProjection', value));
        if (projection.id !== await projectionIdOf(projection.sourceId, projection.versionId, projection.contributionRevision))
            lightragReject('TLRAG1002', '/id', 'The projection address differs from its source, version and contribution.');
        if (projection.counts.claims !== projection.entityClaimIds.length + projection.relationClaimIds.length || projection.counts.chunks !== projection.chunkIds.length)
            lightragReject('TLRAG1001', '/counts', 'Projection counts differ from their exact membership lists.');
        if ((projection.status === 'staged' || projection.status === 'failed') && (projection.head.versionId !== null || projection.head.revision !== 0))
            lightragReject('TLRAG1006', '/head', 'A never-activated projection cannot manufacture a source fence.');
        if ((projection.status === 'active' || projection.status === 'superseded') && (projection.head.versionId !== projection.id || projection.head.revision < 1))
            lightragReject('TLRAG1006', '/head', 'An activated projection must retain its own nonempty source fence.');
        if (projection.audit?.length && (!equalsJson(projection.audit.at(-1)!.head, projection.head)
            || projection.audit.some((entry, index) => entry.head.versionId !== projection.id || entry.head.revision < 1
                || index > 0 && entry.head.revision <= projection.audit![index - 1].head.revision)))
            lightragReject('TLRAG1006', '/audit', 'Projection audit entries must retain increasing native fences ending at the current projection head.');
        for (const entry of projection.audit ?? []) {
            if (entry.previousHead && !equalsJson(planHeadTransition(entry.previousHead, entry.previousHead, projection.id), entry.head))
                lightragReject('TLRAG1006', '/audit', 'An admission audit must bind its previous native fence.');
            if (entry.document && (entry.document.sourceId !== projection.sourceId || entry.document.versionId !== projection.versionId))
                lightragReject('TLRAG1006', '/audit/document', 'A projection admission cannot bind another document.');
        }
        if (projection.prepared) {
            const cached = lightragMust(await validateGraphContribution(projection.prepared));
            if (cached.sourceId !== projection.sourceId || cached.versionId !== projection.versionId || cached.contributionRevision !== projection.contributionRevision
                || !equalsJson(cached.identities, projection.identities)
                || !equalsJson(cached.plan.input.claims.entities.map(row => row.id).sort(), [...projection.entityClaimIds].sort())
                || !equalsJson(cached.plan.input.claims.relations.map(row => row.id).sort(), [...projection.relationClaimIds].sort())
                || !equalsJson([...cached.completedChunkIds].sort(), [...projection.chunkIds].sort()))
                lightragReject('TLRAG1002', '/prepared', 'Retained preparation must reproduce this exact immutable source contribution.');
        }
        return { valid: true, value: projection };
    } catch (cause) { return lightragFailure(cause); }
}
/** Every projection carries its last fence, including a retired last contribution. */
export function sourceGraphHead(projections: readonly GraphProjection[], sourceId: string): LightRagOutcome<Head> {
    try {
        const selected = projections.filter(row => row.sourceId === sourceId);
        if (selected.filter(row => row.status === 'active').length > 1) lightragReject('TLRAG1006', '/projections', 'A source cannot have two active graph projections.');
        if (!selected.length) return { valid: true, value: { ...EMPTY_HEAD } };
        const revision = Math.max(...selected.map(row => row.head.revision));
        const newest = selected.filter(row => row.head.revision === revision);
        if (new Set(newest.map(row => canonicalizeJson(row.head))).size !== 1)
            lightragReject('TLRAG1006', '/head', 'A source has inconsistent records for its newest head fence.');
        return { valid: true, value: immutableLightRagJson(newest[0].head) };
    } catch (cause) { return lightragFailure(cause); }
}
function checkedHead(actual: Head, expected: Head, target: string): Head {
    try { return planHeadTransition(actual, expected, target); }
    catch (cause) { lightragReject('TLRAG1006', '/expectedHead', 'The graph source head changed before promotion.', cause); }
}
export async function planProjectionActivation(options: {
    projection: GraphProjection; previous?: GraphProjection; actualHead: Head; expectedHead: Head; at: string | null;
}): Promise<LightRagOutcome<{ projection: GraphProjection; nextHead: Head; reactivation: boolean }>> {
    try {
        const draft = lightragMust(await validateGraphProjection(options.projection));
        if (draft.status !== 'staged') lightragReject('TLRAG1006', '/status', 'Only a staged contribution can request activation.');
        const before = options.previous === undefined ? undefined : lightragMust(await validateGraphProjection(options.previous));
        if (before && (before.id !== draft.id || !equalsJson(projectionContent(before), projectionContent(draft))))
            lightragReject('TLRAG1006', '/projection', 'Reactivation requires the identical retained contribution.');
        if (before && before.status !== 'staged' && before.status !== 'superseded')
            lightragReject('TLRAG1006', '/status', 'An active or failed projection cannot be staged or activated again.');
        const nextHead = checkedHead(options.actualHead, options.expectedHead, draft.id);
        const { supersededAt: _superseded, error: _error, audit: _audit, ...payload } = draft;
        const projection = lightragMust(await validateGraphProjection({ ...payload, status: 'active', head: nextHead, activatedAt: options.at }));
        return { valid: true, value: immutableLightRagJson({ projection, nextHead, reactivation: before?.status === 'superseded' }) };
    } catch (cause) { return lightragFailure(cause); }
}
export async function planProjectionRetirement(options: {
    projection: GraphProjection; actualHead: Head; expectedHead: Head; at: string | null;
}): Promise<LightRagOutcome<{ projection: GraphProjection; nextHead: Head }>> {
    try {
        const projection = lightragMust(await validateGraphProjection(options.projection));
        if (projection.status !== 'active' || options.actualHead.versionId !== projection.id)
            lightragReject('TLRAG1006', '/status', 'Retraction requires the currently active source contribution.');
        const nextHead = checkedHead(options.actualHead, options.expectedHead, projection.id);
        const { audit: _audit, ...body } = projection;
        const retired = lightragMust(await validateGraphProjection({ ...body, status: 'superseded', head: nextHead, supersededAt: options.at }));
        return { valid: true, value: immutableLightRagJson({ projection: retired, nextHead }) };
    } catch (cause) { return lightragFailure(cause); }
}
