/** Ownership indexes only; the grounding package owns the closed record contracts. */
const id = { type: 'string', minLength: 1 }, nullable = { type: ['string', 'null'] };
const collection = {
    key: '/id',
    schema: { type: 'object', required: ['id', 'sessionId', 'profileId', 'profileRevision', 'sourceId', 'status', 'payload'], properties: { id, sessionId: nullable, profileId: id, profileRevision: id, sourceId: nullable, status: nullable, payload: { type: 'object' } } },
    indexes: [{ name: 'by_session', path: '$.sessionId' }, { name: 'by_profile', path: ['$.profileId', '$.profileRevision'] }, { name: 'by_source_status', path: ['$.sourceId', '$.status'] }],
};
export const GROUNDING_COLLECTIONS = {
    grounding_profiles: collection, grounding_manifests: collection, grounding_sessions: collection,
    grounding_intents: collection, grounding_plans: collection, grounding_evidence: collection,
    grounding_web_runs: collection, grounding_conflicts: collection, grounding_answers: collection,
};
