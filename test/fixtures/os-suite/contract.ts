/** The fixture's contract: what the desktop and its assistant may call. */
export const RECORDS = {
  $contract: '0.1', id: 'records',
  operations: {
    'records.describe': { kind: 'read', doc: 'What these records are and which fields they have.', output: { type: 'object' } },
    'records.search': { kind: 'read', doc: 'Records whose name contains the query, case-insensitively.', input: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 100 } } }, output: { type: 'array' } },
    'records.get': { kind: 'read', doc: 'One record by id.', input: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } }, output: { type: 'object' } },
  },
};
