/** Physical projection only; the immutable contracts are checked by the evolve package. */
const id = { type: 'string', minLength: 1 };

/**
 * A record row carries the two things the physical layer must sort and
 * filter by — the write sequence and the experiment it belongs to —
 * beside the payload it does not interpret.
 */
const record = {
  schema: {
    type: 'object',
    required: ['id', 'scope', 'seq', 'payload'],
    properties: { id, scope: id, seq: { type: 'integer', minimum: 0 }, experimentId: { type: 'string' }, payload: { type: 'object' } },
  },
  key: '/id',
  indexes: [{ name: 'by_scope_seq', path: ['$.scope', '$.seq'] }],
};

/** A semantic uniqueness key: one composite address naming one record id. */
const key = {
  schema: { type: 'object', required: ['id', 'target'], properties: { id, target: id } },
  key: '/id',
};

/** The mutable, revision-fenced experiment row, addressed by experimentId. */
const experiment = {
  schema: {
    type: 'object',
    required: ['id', 'revision', 'payload'],
    properties: { id, revision: { type: 'integer', minimum: 0 }, payload: { type: 'object' } },
  },
  key: '/id',
  indexes: [{ name: 'by_revision', path: '$.revision' }],
};

/**
 * Declared here because the suite's external-effect store needs a
 * collection to exist before anything can persist an intent. Nothing in
 * this order writes it.
 */
const effect = { schema: { type: 'object', required: ['id'], properties: { id } }, key: '/id' };

export const EVOLVE_COLLECTIONS = {
  evolve_records: record,
  evolve_keys: key,
  evolve_experiments: experiment,
  evolve_effects: effect,
};
