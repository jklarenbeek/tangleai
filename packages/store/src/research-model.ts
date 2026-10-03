/** Payload projection only; the generated research contracts own record validation. */
const id = { type: 'string', minLength: 1 };
const schema = { type: 'object', required: ['id', 'scope', 'payload'], properties: { id, scope: id, payload: { type: 'object' } } };
const collection = { schema, key: '/id', indexes: [{ name: 'by_scope_id', path: ['$.scope', '$.id'] }] };
export const RESEARCH_COLLECTIONS = {
  research_projects: collection, research_records: collection, research_artifacts: collection,
  research_attempts: collection, research_state: collection,
};
