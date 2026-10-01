/** Both persistence adapters share the same checked atomic graph write boundary. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { equalsJson as same } from '@jarenjs/core/object';
import { planHeadTransition } from '@tangleai/outcomes';
import type { GraphProjection, GraphEntityClaim, GraphRelationClaim, ProjectionWritePlan, LightRagWrite, GraphContributionPlan } from './contracts.gen.ts';
import type { LightRagReadView, LightRagWriteView, LightRagStored, LightRagTable } from './persistence.ts';
import { lightRagStored } from './persistence.ts';
import { validateLightRagShape } from './schema.ts';
import { validateGraphProjection, sourceGraphHead } from './projection.ts';
import { planProjectionWrites, planRetraction } from './write-plan.ts';
import { lightragMust, lightragReject } from './errors.ts';
import { immutableLightRagJson } from './identity.ts';
const unique = (values: readonly string[]) => [...new Set(values)].sort();
const order = <T extends { id: string }>(rows: readonly T[]) => [...rows].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export interface LightRagApplyReceipt { projectionId: string; head: ProjectionWritePlan['nextHead']; writes: number; newClaims: number; reactivation: boolean; replayed: boolean }
/** Supply the checked plan to restore preparation omitted from projection writes. */
export function storedLightRagWrite(write: LightRagWrite, plan?: Pick<ProjectionWritePlan, 'request' | 'priorProjections'>): LightRagStored {
    if (write.table === 'projections' && write.row.prepared === undefined && plan) {
        const source = write.row.id === plan.request.id ? plan.request : plan.priorProjections.find(row => row.id === write.row.id);
        if (source?.prepared) return lightRagStored('projections', { ...write.row, prepared: source.prepared });
    }
    return lightRagStored(write.table, write.row, 'projectionId' in write ? write.projectionId : undefined);
}
async function projectionsFor(view: LightRagReadView, sourceId: string): Promise<GraphProjection[]> {
    const rows = await view.query('projections', { sourceId }), projections: GraphProjection[] = [];
    for (const row of rows) {
        const projection = lightragMust(await validateGraphProjection(row.payload));
        if (!same(row, lightRagStored('projections', projection))) lightragReject('TLRAG1002', '/projections', 'Physical projection metadata differs from its payload.');
        projections.push(projection);
    }
    lightragMust(sourceGraphHead(projections, sourceId)); return order(projections);
}
async function unchangedResult(view: LightRagReadView, plan: ProjectionWritePlan): Promise<boolean> {
    const final = new Map<string, { table: LightRagTable; stored: LightRagStored }>();
    for (const write of plan.writes) { const stored = storedLightRagWrite(write, plan); final.set(write.table + ':' + stored.id, { table: write.table, stored }); }
    for (const row of final.values()) if (!same(await view.get(row.table, row.stored.id) ?? null, row.stored)) return false;
    return contributionResultMatchesWithin(view, plan.request.id, plan.contribution, plan.operation === 'activate');
}
/** A replay checks the complete resulting canonical and immutable member bytes. */
export async function contributionResultMatchesWithin(view: LightRagReadView, projectionId: string, contribution: GraphContributionPlan, members = true): Promise<boolean> {
    for (const [table, rows] of [['entities', contribution.canonicals.entities], ['relations', contribution.canonicals.relations]] as const)
        for (const row of rows) if (!same(await view.get(table, row.id) ?? null, lightRagStored(table, row))) return false;
    if (members) for (const [table, rows] of [['entity_claims', contribution.input.claims.entities], ['relation_claims', contribution.input.claims.relations], ['chunk_profiles', contribution.input.profiles]] as const)
        for (const row of rows) { const stored = lightRagStored(table, row, projectionId); if (!same(await view.get(table, stored.id) ?? null, stored)) return false; }
    return true;
}
async function checkCanonicalSnapshot(view: LightRagReadView, plan: ProjectionWritePlan): Promise<void> {
    const input = plan.contribution.input, withdrawn = new Set(input.retiredClaimIds), mergeIds = new Set(input.merges.flat());
    const names = unique([
        ...input.claims.entities.map(row => row.normalizedName),
        ...input.claims.relations.flatMap(row => [row.normalizedSource, row.normalizedTarget]),
        ...input.existing.claims.entities.filter(row => withdrawn.has(row.id)).map(row => row.normalizedName),
        ...input.existing.claims.relations.filter(row => withdrawn.has(row.id)).flatMap(row => [row.normalizedSource, row.normalizedTarget]),
        ...input.existing.canonicals.entities.filter(row => mergeIds.has(row.id)).map(row => row.normalizedName),
    ]);
    const expectedEntities = new Map(input.existing.canonicals.entities.map(row => [row.id, row])), expectedRelations = new Map(input.existing.canonicals.relations.map(row => [row.id, row]));
    const roots = await view.query('entities', { normalizedNames: names });
    for (const row of roots) if (!same(expectedEntities.get(row.id) ?? null, row.payload)) lightragReject('TLRAG1006', '/existing/entities', 'A matching canonical was added or changed after contribution preparation.');
    const adjacentIds = unique([...roots.map(row => row.id), ...input.candidates.entities.map(row => row.id), ...mergeIds]);
    for (const row of await view.query('relations', { entityIds: adjacentIds })) if (!same(expectedRelations.get(row.id) ?? null, row.payload))
        lightragReject('TLRAG1006', '/existing/relations', 'An adjacent relation was added or changed after contribution preparation.');
    for (const [table, rows] of [['entities', input.existing.canonicals.entities], ['relations', input.existing.canonicals.relations]] as const) for (const row of rows) {
        const actual = await view.get(table, row.id);
        if (!same(actual ?? null, lightRagStored(table, row))) lightragReject('TLRAG1006', '/existing/' + table, 'An expected canonical no longer has the prepared bytes.');
    }
    for (const [table, rows, expected] of [['entities', plan.contribution.canonicals.entities, expectedEntities], ['relations', plan.contribution.canonicals.relations, expectedRelations]] as const)
        for (const row of rows) if (!expected.has(row.id) && await view.get(table, row.id)) lightragReject('TLRAG1006', '/canonicals', 'A new canonical address is already occupied.');
}
async function checkClaimSnapshot(view: LightRagReadView, plan: ProjectionWritePlan): Promise<void> {
    const input = plan.contribution.input;
    for (const [table, claims] of [['entity_claims', input.existing.claims.entities], ['relation_claims', input.existing.claims.relations]] as const) {
        const reads = new Map<string, LightRagStored[]>();
        for (const claim of claims as readonly (GraphEntityClaim | GraphRelationClaim)[]) {
            const key = canonicalizeJson([claim.sourceId, claim.versionId]);
            let rows = reads.get(key);
            if (!rows) { rows = await view.query(table, { sourceId: claim.sourceId, versionId: claim.versionId }); reads.set(key, rows); }
            const matches = rows.filter(row => 'id' in row.payload && row.payload.id === claim.id);
            if (!matches.length) lightragReject('TLRAG1003', '/existing/claims', 'A prepared claim is absent from retained projection membership.');
            for (const row of matches) if (row.projectionId === null || !same(row, lightRagStored(table, claim, row.projectionId)))
                lightragReject('TLRAG1002', '/existing/claims', 'A retained immutable claim differs from the prepared evidence.');
        }
    }
    const sources = unique([...input.existing.claims.entities, ...input.existing.claims.relations, ...input.claims.entities, ...input.claims.relations].map(row => row.sourceId));
    const activeEntities = new Set<string>(), activeRelations = new Set<string>();
    for (const sourceId of sources) {
        if (sourceId === plan.request.sourceId) {
            if (plan.operation === 'activate') { for (const id of plan.request.entityClaimIds) activeEntities.add(id); for (const id of plan.request.relationClaimIds) activeRelations.add(id); }
        } else {
            const active = (await projectionsFor(view, sourceId)).find(row => row.status === 'active');
            for (const id of active?.entityClaimIds ?? []) activeEntities.add(id); for (const id of active?.relationClaimIds ?? []) activeRelations.add(id);
        }
    }
    for (const [rows, active] of [[plan.contribution.canonicals.entities, activeEntities], [plan.contribution.canonicals.relations, activeRelations]] as const)
        for (const row of rows) if (row.status === 'active' && row.supportClaimIds.some(id => !active.has(id)))
            lightragReject('TLRAG1006', '/supportClaimIds', 'An active canonical cannot depend on staged or superseded-only claims.');
    if (plan.reactivation) {
        for (const [table, rows] of [['entity_claims', input.claims.entities], ['relation_claims', input.claims.relations], ['chunk_profiles', input.profiles]] as const)
            for (const row of rows) {
                const expected = lightRagStored(table, row, plan.request.id);
                if (!same(await view.get(table, expected.id) ?? null, expected)) lightragReject('TLRAG1003', '/reactivation', 'Reactivation requires every identical retained contribution member.');
            }
    }
}
/** The host must call this inside its transaction; a refusal unwinds that scope. */
export async function checkLightRagWritePlanWithin(view: LightRagReadView, value: ProjectionWritePlan): Promise<{ plan: ProjectionWritePlan; replay: LightRagApplyReceipt | null }> {
    const plan = lightragMust(validateLightRagShape('projectionWritePlan', value));
    const recompute = plan.operation === 'activate' ? planProjectionWrites : planRetraction;
    const reproduced = lightragMust(await recompute({ projection: plan.request, contribution: plan.contribution, projections: plan.priorProjections,
        actualHead: plan.actualHead, expectedHead: plan.expectedHead, at: plan.at, document: plan.document, profilePolicy: plan.profilePolicy }));
    if (!same(plan, reproduced)) lightragReject('TLRAG1002', '/writes', 'The write plan differs from its independently reproduced transition.');
    const actualProjections = await projectionsFor(view, plan.request.sourceId), actualHead = lightragMust(sourceGraphHead(actualProjections, plan.request.sourceId));
    if (same(actualHead, plan.nextHead) && await unchangedResult(view, plan)) return { plan, replay: immutableLightRagJson({ projectionId: plan.request.id, head: actualHead, writes: 0, newClaims: 0, reactivation: plan.reactivation, replayed: true }) };
    let next;
    try { next = planHeadTransition(actualHead, plan.expectedHead, plan.request.id); }
    catch (cause) { lightragReject('TLRAG1006', '/expectedHead', 'The source graph head moved before this transaction.', cause); }
    if (!same(next, plan.nextHead) || !same(actualProjections, plan.priorProjections)) lightragReject('TLRAG1006', '/priorProjections', 'The prepared projection states differ from the transaction snapshot.');
    await checkCanonicalSnapshot(view, plan); await checkClaimSnapshot(view, plan);
    return { plan, replay: null };
}
/** The host must call this inside its transaction; a refusal unwinds that scope. */
export async function applyLightRagWritePlanWithin(view: LightRagWriteView, value: ProjectionWritePlan): Promise<LightRagApplyReceipt> {
    const { plan, replay } = await checkLightRagWritePlanWithin(view, value);
    if (replay) return replay;
    let writes = 0, newClaims = 0;
    for (const write of plan.writes) {
        const stored = storedLightRagWrite(write, plan), before = await view.get(write.table, stored.id);
        if (same(before ?? null, stored)) continue;
        if (before && 'projectionId' in write) lightragReject('TLRAG1002', '/members', 'An immutable contribution member cannot be overwritten.');
        await view.put(write.table, stored); writes++;
        if (write.table === 'entity_claims' || write.table === 'relation_claims') newClaims++;
    }
    return immutableLightRagJson({ projectionId: plan.request.id, head: plan.nextHead, writes, newClaims, reactivation: plan.reactivation, replayed: false });
}
