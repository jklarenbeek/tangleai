/** Six logical collections; hosts supply the transaction owner and physical queries. */
import type { GraphProjection, GraphChunkProfile, GraphEntityClaim, GraphRelationClaim, GraphEntity, GraphRelation } from './contracts.gen.ts';
export interface LightRagTables {
    projections: GraphProjection; chunk_profiles: GraphChunkProfile;
    entity_claims: GraphEntityClaim; relation_claims: GraphRelationClaim;
    entities: GraphEntity; relations: GraphRelation;
}
export type LightRagTable = keyof LightRagTables;
export const LIGHTRAG_TABLES: readonly LightRagTable[] = Object.freeze([
    'projections', 'chunk_profiles', 'entity_claims', 'relation_claims', 'entities', 'relations',
]);
export interface LightRagIndexes {
    id: string; sourceId: string | null; versionId: string | null; projectionId: string | null;
    normalizedName: string | null; status: string | null;
    sourceEntityId: string | null; targetEntityId: string | null;
}
export type LightRagStored<K extends LightRagTable = LightRagTable> = LightRagIndexes & { payload: LightRagTables[K] };
export type LightRagReadQuery = Partial<Pick<LightRagIndexes, 'sourceId' | 'versionId' | 'projectionId' | 'status'>> & {
    ids?: readonly string[]; claimIds?: readonly string[]; normalizedNames?: readonly string[]; entityIds?: readonly string[];
};
export interface LightRagReadView {
    get<K extends LightRagTable>(table: K, id: string): Promise<LightRagStored<K> | undefined>;
    query<K extends LightRagTable>(table: K, query: LightRagReadQuery): Promise<LightRagStored<K>[]>;
}
export interface LightRagWriteView extends LightRagReadView {
    put<K extends LightRagTable>(table: K, row: LightRagStored<K>): Promise<void>;
}
export interface LightRagPersistence {
    read<T>(task: (view: LightRagReadView) => Promise<T>): Promise<T>;
    transaction<T>(task: (view: LightRagWriteView) => Promise<T>): Promise<T>;
}
/** Physical membership is separate from immutable claim content, avoiding a hash cycle. */
export function lightRagStored<K extends LightRagTable>(table: K, payload: LightRagTables[K], projectionId?: string): LightRagStored<K> {
    const value = payload as unknown as Record<string, unknown>;
    const member = table === 'entity_claims' || table === 'relation_claims' || table === 'chunk_profiles';
    if (member && !projectionId) throw new TypeError('A graph contribution member requires its projection id.');
    return {
        id: member ? projectionId + ':' + String(value.id ?? value.chunkId) : String(value.id),
        sourceId: typeof value.sourceId === 'string' ? value.sourceId : null,
        versionId: typeof value.versionId === 'string' ? value.versionId : null,
        projectionId: table === 'projections' ? String(value.id) : projectionId ?? null,
        normalizedName: typeof value.normalizedName === 'string' ? value.normalizedName : null,
        status: typeof value.status === 'string' ? value.status : null,
        sourceEntityId: typeof value.sourceEntityId === 'string' ? value.sourceEntityId : null,
        targetEntityId: typeof value.targetEntityId === 'string' ? value.targetEntityId : null,
        payload,
    };
}
