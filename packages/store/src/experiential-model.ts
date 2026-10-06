/** Physical projections; the experiential package owns their domain contracts. */
const id = { type: 'string', minLength: 1 };
const schema = { type: 'object', required: ['id', 'scope', 'payload'], properties: { id, scope: id, payload: { type: 'object' } } };
const collection = { schema, key: '/id', indexes: [{ name: 'by_scope_id', path: ['$.scope', '$.id'] }] };
export const EXPERIENTIAL_COLLECTIONS = {
  experiential_experiences: collection, experiential_assessments: collection, experiential_datasets: collection,
  experiential_training_runs: collection, experiential_artifacts: collection, experiential_evaluations: collection,
  experiential_gate_policies: collection, experiential_approvals: collection, experiential_deployments: collection,
  experiential_pins: collection, experiential_retention_decisions: collection, experiential_events: collection, experiential_heads: collection,
};
