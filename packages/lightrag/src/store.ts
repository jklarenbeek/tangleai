/** Logical graph reads never expose an uncommitted or implicitly staged contribution. */
import { cloneJson } from '@jarenjs/core/object';
import { readGraphSnapshotWithin,type GraphSnapshotRequest } from './snapshot.ts';
import type { GraphProjection, GraphEntity, GraphRelation, GraphChunkProfile, GraphClaimSet, GraphContributionSnapshot, ProjectionWritePlan } from './contracts.gen.ts';
import type { LightRagPersistence, LightRagReadView, LightRagReadQuery } from './persistence.ts';
import { createMemoryLightRagPersistence, type MemoryLightRagOptions } from './memory-persistence.ts';
import { applyLightRagWritePlanWithin, type LightRagApplyReceipt } from './apply.ts';
import { lightragFailure, type LightRagOutcome } from './errors.ts';
export interface LightRagVisibility { includeStaged?: boolean; includeSuperseded?: boolean }
export interface LightRagStore {
    readContributionSnapshot(request: GraphSnapshotRequest): Promise<GraphContributionSnapshot>;
    getProjection(id: string): Promise<GraphProjection | undefined>;
    listProjections(filter?: Partial<Pick<GraphProjection, 'sourceId' | 'versionId' | 'status'>>): Promise<GraphProjection[]>;
    activeProjectionFor(sourceId: string): Promise<GraphProjection | undefined>;
    listClaims(projectionId: string, visibility?: LightRagVisibility): Promise<GraphClaimSet>;
    listEntities(filter?: { ids?: readonly string[]; normalizedNames?: readonly string[]; status?: GraphEntity['status'] | 'all' }): Promise<GraphEntity[]>;
    listRelations(filter?: { ids?: readonly string[]; entityIds?: readonly string[]; status?: GraphRelation['status'] | 'all' }): Promise<GraphRelation[]>;
    listChunkProfiles(versionId: string, visibility?: LightRagVisibility): Promise<GraphChunkProfile[]>;
    apply(plan: ProjectionWritePlan): Promise<LightRagOutcome<LightRagApplyReceipt>>;
}
function visible(row: GraphProjection | undefined, options: LightRagVisibility): boolean {
    return row !== undefined && (row.status === 'active' || options.includeStaged === true && row.status === 'staged' || options.includeSuperseded === true && row.status === 'superseded');
}
async function claimsWithin(view: LightRagReadView, projectionId: string, visibility: LightRagVisibility): Promise<GraphClaimSet> {
    if (!visible((await view.get('projections', projectionId))?.payload, visibility)) return { entities: [], relations: [] };
    return { entities: (await view.query('entity_claims', { projectionId })).map(row => row.payload), relations: (await view.query('relation_claims', { projectionId })).map(row => row.payload) };
}
export function createLightRagStoreAdapter(persistence: LightRagPersistence): LightRagStore {
    const projectionRows = (filter: LightRagReadQuery) => persistence.read(async view => (await view.query('projections', filter)).map(row => row.payload));
    return {
        readContributionSnapshot: request => persistence.read(view => readGraphSnapshotWithin(view, request)),
        getProjection: id => persistence.read(async view => (await view.get('projections', id))?.payload),
        listProjections: (filter = {}) => projectionRows(filter),
        async activeProjectionFor(sourceId) { return (await projectionRows({ sourceId, status: 'active' }))[0]; },
        listClaims: (projectionId, visibility = {}) => persistence.read(view => claimsWithin(view, projectionId, visibility)),
        listEntities: (filter = {}) => persistence.read(async view => {
            const { status = 'active', ...rest } = filter;
            return (await view.query('entities', { ...rest, ...(status === 'all' ? {} : { status }) })).map(row => row.payload);
        }),
        listRelations: (filter = {}) => persistence.read(async view => {
            const { status = 'active', ...rest } = filter;
            return (await view.query('relations', { ...rest, ...(status === 'all' ? {} : { status }) })).map(row => row.payload);
        }),
        listChunkProfiles: (versionId, visibility = {}) => persistence.read(async view => {
            const projections = (await view.query('projections', { versionId })).map(row => row.payload).filter(row => visible(row, visibility));
            const profiles = new Map<string, GraphChunkProfile>();
            for (const projection of projections) for (const row of await view.query('chunk_profiles', { projectionId: projection.id })) profiles.set(row.id, row.payload);
            return cloneJson([...profiles.values()]);
        }),
        async apply(plan) {
            try { return { valid: true, value: await persistence.transaction(view => applyLightRagWritePlanWithin(view, plan)) }; }
            catch (cause) { return lightragFailure(cause); }
        },
    };
}
export function createMemoryLightRagStore(options: MemoryLightRagOptions = {}): LightRagStore {
    return createLightRagStoreAdapter(createMemoryLightRagPersistence(options));
}
export const applyPlan = (store: LightRagStore, plan: ProjectionWritePlan): Promise<LightRagOutcome<LightRagApplyReceipt>> => store.apply(plan);
