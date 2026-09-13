/** Physical projection only; full immutable contracts are checked by memory. */
const id = { type: 'string', minLength: 1 };
const schema = { type: 'object', required: ['id', 'scope', 'payload'], properties: { id, scope: id, payload: { type: 'object' } } };
const collection = { schema, key: '/id', indexes: [{ name: 'by_scope_id', path: ['$.scope', '$.id'] }] };
export const CONSOLIDATION_COLLECTIONS = {
  consolidation_sources: collection, consolidation_artifacts: collection,
  consolidation_buffers: collection, consolidation_operations: collection,
};
