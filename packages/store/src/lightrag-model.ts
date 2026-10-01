/** Physical keys/indexes; graph contracts are validated by their domain owner. */
const id = { type: 'string', minLength: 1 }, nullable = { type: ['string', 'null'] };
const record = { type: 'object', additionalProperties: false,
    required: ['id', 'sourceId', 'versionId', 'projectionId', 'normalizedName', 'status', 'sourceEntityId', 'targetEntityId', 'payload'],
    properties: { id, sourceId: nullable, versionId: nullable, projectionId: nullable, normalizedName: nullable,
        status: nullable, sourceEntityId: nullable, targetEntityId: nullable, payload: { type: 'object' } } };
const collection = (indexes: Array<{ name: string; path: string | string[] }>) => ({ key: '/id', schema: record, indexes });
export const LIGHTRAG_COLLECTIONS = {
    lightrag_projections: collection([{ name: 'by_source_status', path: ['$.sourceId', '$.status'] }, { name: 'by_version', path: '$.versionId' }]),
    lightrag_chunk_profiles: collection([{ name: 'by_projection', path: '$.projectionId' }, { name: 'by_version', path: '$.versionId' }]),
    lightrag_entity_claims: collection([{ name: 'by_source_version', path: ['$.sourceId', '$.versionId'] }, { name: 'by_projection', path: '$.projectionId' }, { name: 'by_normalized_name', path: '$.normalizedName' }]),
    lightrag_relation_claims: collection([{ name: 'by_source_version', path: ['$.sourceId', '$.versionId'] }, { name: 'by_projection', path: '$.projectionId' }]),
    lightrag_entities: collection([{ name: 'by_normalized_name', path: '$.normalizedName' }, { name: 'by_status', path: '$.status' }]),
    lightrag_relations: collection([{ name: 'by_source_entity', path: '$.sourceEntityId' }, { name: 'by_target_entity', path: '$.targetEntityId' }, { name: 'by_status', path: '$.status' }]),
};
