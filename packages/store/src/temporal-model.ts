/** Numeric projections are distinct from canonical timestamp strings inside payloads. */
const id = { type: 'string', minLength: 1 };
const integer = { type: 'integer' };
const schema = { type: 'object', required: ['id', 'scope', 'recordType', 'payload'], properties: {
  id, scope: id, recordType: id, payload: { type: 'object' }, versionId: id, subject: id, series: id,
  observedAtEpochMs: integer, knownAtEpochMs: integer, validFromEpochMs: integer, validUntilEpochMs: integer,
} };
export const TEMPORAL_COLLECTIONS = {
  temporal_occurrences: { schema, key: '/id', indexes: [
    { name: 'by_scope_observed', path: ['$.scope', '$.observedAtEpochMs'] },
    { name: 'by_scope_known', path: ['$.scope', '$.knownAtEpochMs'] },
    { name: 'by_scope_id', path: ['$.scope', '$.id'] },
  ] },
  temporal_claims: { schema, key: '/id', indexes: [
    { name: 'by_scope_version_series_at', path: ['$.scope', '$.versionId', '$.subject', '$.series', '$.validFromEpochMs'] },
    { name: 'by_scope_version', path: ['$.scope', '$.versionId'] },
  ] },
  temporal_heads: { schema, key: '/id', indexes: [{ name: 'by_scope', path: '$.scope' }] },
  temporal_operations: { schema, key: '/id', indexes: [{ name: 'by_scope', path: '$.scope' }] },
};
