/** Physical projection only; the real write gate is the package's validation at the store boundary. */
const id = { type: 'string', minLength: 1 };
const schema = { type: 'object', required: ['id', 'scope', 'payload'], properties: { id, scope: id, payload: { type: 'object' } } };
const collection = { schema, key: '/id', indexes: [{ name: 'by_scope_id', path: ['$.scope', '$.id'] }] };
/** One row per scope key, so the head is addressed by the scope it fences. */
const head = { schema, key: '/id', indexes: [{ name: 'by_scope', path: '$.scope' }] };
export const TRACE2SKILL_COLLECTIONS = {
  skill_bundles: collection, skill_files: collection, skill_heads: head,
  trace2skill_runs: collection, trace2skill_tasks: collection, trace2skill_rollouts: collection,
  trace2skill_analyses: collection, trace2skill_patches: collection, trace2skill_merges: collection,
  trace2skill_candidates: collection, trace2skill_evaluations: collection,
};
