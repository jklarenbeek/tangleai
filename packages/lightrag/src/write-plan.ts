/** Ordered writes bind immutable contribution bytes to one native source-head transition. */
import { equalsJson as same } from '@jarenjs/core/object';
import type { Head } from '@tangleai/outcomes';
import { sameIdentity } from '@tangleai/context/ledger';
import type { GraphProjection, GraphContributionPlan, ProjectionWritePlan, LightRagWrite, GraphDocumentBinding } from './contracts.gen.ts';
import { planContribution } from './plan.ts';
import { validateLightRagShape } from './schema.ts';
import { validateGraphProjection, planProjectionActivation, planProjectionRetirement, sourceGraphHead } from './projection.ts';
import { contributionRevisionOf, lightragRevisionOf, immutableLightRagJson } from './identity.ts';
import { lightragMust, lightragReject, lightragFailure, type LightRagOutcome } from './errors.ts';
import { bindProjectionPreparations } from './preparation-bindings.ts';
const ids = (values: readonly string[]) => [...new Set(values)].sort();
export interface ProjectionPlanOptions {
    projection: GraphProjection; contribution: GraphContributionPlan; projections: readonly GraphProjection[];
    actualHead: Head; expectedHead: Head; at: string | null;
    document?: GraphDocumentBinding; profilePolicy?: 'prepared' | 'retained-evidence';
    compactPreparations?: boolean;
}
export function planProjectionWrites(options: ProjectionPlanOptions): Promise<LightRagOutcome<ProjectionWritePlan>> { return buildWrites('activate', options); }
export function planRetraction(options: ProjectionPlanOptions): Promise<LightRagOutcome<ProjectionWritePlan>> { return buildWrites('retract', options); }
async function buildWrites(operation: ProjectionWritePlan['operation'], options: ProjectionPlanOptions): Promise<LightRagOutcome<ProjectionWritePlan>> {
    try {
        const request = lightragMust(await validateGraphProjection(options.projection)), priorProjections: GraphProjection[] = [];
        const document = options.document === undefined ? undefined : lightragMust(validateLightRagShape('graphDocumentBinding', options.document));
        if (document && (document.sourceId !== request.sourceId || document.versionId !== request.versionId))
            lightragReject('TLRAG1006', '/document', 'The write plan must bind the projection document source and version.');
        const admission = { ...(document ? { document, previousHead: options.actualHead } : {}), ...(options.profilePolicy ? { profilePolicy: options.profilePolicy } : {}) };

        for (const row of options.projections) {
            const checked = lightragMust(await validateGraphProjection(row));
            if (checked.sourceId !== request.sourceId) lightragReject('TLRAG1006', '/projections', 'The source fence cannot include another source.');
            priorProjections.push(checked);
        }
        priorProjections.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        if (new Set(priorProjections.map(row => row.id)).size !== priorProjections.length) lightragReject('TLRAG1006', '/projections', 'A source projection address occurs twice.');
        const observed = lightragMust(sourceGraphHead(priorProjections, request.sourceId));
        if (!same(observed, options.actualHead)) lightragReject('TLRAG1006', '/actualHead', 'The supplied source head differs from the retained projection snapshot.');
        const contribution = lightragMust(await planContribution(options.contribution.input));
        if (!same(contribution, options.contribution)) lightragReject('TLRAG1002', '/contribution', 'The contribution plan differs from its independently recomputed writes.');
        if (!sameIdentity(contribution.input.embeddedBy, request.identities.embedder)) lightragReject('TLRAG1002', '/identities/embedder', 'Projection and canonical vector identities must agree.');
        const active = priorProjections.find(row => row.status === 'active'), retained = priorProjections.find(row => row.id === request.id);
        const newClaims = [...contribution.input.claims.entities, ...contribution.input.claims.relations], introduced = new Set(newClaims.map(row => row.id));
        const retired = ids((active ? [...active.entityClaimIds, ...active.relationClaimIds] : []).filter(id => !introduced.has(id)));
        if (!same(retired, ids(contribution.input.retiredClaimIds))) lightragReject('TLRAG1006', '/retiredClaimIds', 'Replacement must withdraw exactly the prior source contribution not retained by the incoming one.');
        const writes: LightRagWrite[] = []; let projection: GraphProjection, nextHead: Head, reactivation = false;
        if (operation === 'activate') {
            for (const claim of newClaims) if (claim.sourceId !== request.sourceId || claim.versionId !== request.versionId
                || !same(claim.modelIdentity, request.identities.model) || !Object.values(request.identities.prompts).includes(claim.promptRevision))
                lightragReject('TLRAG1006', '/claims', 'A contribution claim differs from the projection source, version, prompt or model identity.');
            const profileChunks = ids(contribution.input.profiles.map(row => row.chunkId));
            if (contribution.input.profiles.some(row => row.versionId !== request.versionId
                || contribution.input.chunks.find(chunk => chunk.id === row.chunkId)?.sourceId !== request.sourceId
                || !Object.values(request.identities.prompts).includes(row.promptRevision))
                || !same(ids(request.chunkIds), profileChunks) || newClaims.some(row => !profileChunks.includes(row.chunkId))
                || !same(ids(request.entityClaimIds), ids(contribution.input.claims.entities.map(row => row.id)))
                || !same(ids(request.relationClaimIds), ids(contribution.input.claims.relations.map(row => row.id))))
                lightragReject('TLRAG1006', '/projection', 'Projection membership differs from its exact contribution.');
            const revision = await contributionRevisionOf({ sourceId: request.sourceId, versionId: request.versionId,
                claims: contribution.input.claims, profiles: contribution.input.profiles, identities: request.identities });
            if (revision !== request.contributionRevision) lightragReject('TLRAG1002', '/contributionRevision', 'The contribution differs from its immutable source revision.');
            const activation = lightragMust(await planProjectionActivation({ projection: request, ...(retained ? { previous: retained } : {}),
                actualHead: options.actualHead, expectedHead: options.expectedHead, at: options.at }));
            ({ projection, nextHead, reactivation } = activation);
            if (!reactivation && (request.counts.entities !== contribution.input.candidates.entities.length
                || request.counts.relations !== contribution.input.candidates.relations.length
                || request.counts.canonicalsTouched !== contribution.touchedEntityIds.length + contribution.touchedRelationIds.length))
                lightragReject('TLRAG1001', '/counts', 'The new projection census differs from the measured prepared contribution.');
            writes.push({ table: 'projections', row: request });
            if (!reactivation) {
                for (const row of contribution.input.claims.entities) writes.push({ table: 'entity_claims', projectionId: request.id, row });
                for (const row of contribution.input.claims.relations) writes.push({ table: 'relation_claims', projectionId: request.id, row });
                for (const row of contribution.input.profiles) writes.push({ table: 'chunk_profiles', projectionId: request.id, row });
            }
        } else {
            if (newClaims.length || contribution.input.profiles.length || !retained || !same(retained, request))
                lightragReject('TLRAG1006', '/projection', 'Retraction must name its exact active projection and introduce no contribution members.');
            const retirement = lightragMust(await planProjectionRetirement({ projection: request, actualHead: options.actualHead, expectedHead: options.expectedHead, at: options.at }));
            ({ projection, nextHead } = retirement);
        }
        projection = lightragMust(await validateGraphProjection({ ...projection, audit: [...(retained?.audit ?? []), { operation, head: nextHead, contributionPlanRevision: contribution.revision, reviews: contribution.input.reviews, at: options.at, ...admission }] }));
        for (const row of contribution.canonicals.entities) if (contribution.touchedEntityIds.includes(row.id)) writes.push({ table: 'entities', row });
        for (const row of contribution.canonicals.relations) if (contribution.touchedRelationIds.includes(row.id)) writes.push({ table: 'relations', row });
        if (operation === 'activate' && active && active.id !== request.id) writes.push({ table: 'projections', row: { ...active, status: 'superseded', supersededAt: options.at } });
        writes.push({ table: 'projections', row: projection });
        // Retained preparation is already bound by request/priorProjections.
        // Repeating it in both projection writes can exceed the JSON string
        // limit for an otherwise admissible source. The apply owner restores
        // those exact bytes from the checked snapshots before physical writes.
        const compactWrites = writes.map(write => {
            if (write.table !== 'projections') return write;
            const { prepared: _prepared, ...row } = write.row;
            return { ...write, row };
        });
        const snapshots = options.compactPreparations ? await bindProjectionPreparations(request, priorProjections, contribution) : { request, priorProjections };
        const body = { operation, ...snapshots, contribution, actualHead: options.actualHead, expectedHead: options.expectedHead, nextHead,
            at: options.at, reactivation, writes: compactWrites, ...(document ? { document } : {}), ...(options.profilePolicy ? { profilePolicy: options.profilePolicy } : {}) };
        return { valid: true, value: immutableLightRagJson(lightragMust(validateLightRagShape('projectionWritePlan', { ...body, revision: await lightragRevisionOf(body) }))) };
    } catch (cause) { return lightragFailure(cause); }
}
