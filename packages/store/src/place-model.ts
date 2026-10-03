/** Canonical payloads with native scalar columns for sourced place lookups. */
const id = { type: 'string', minLength: 1 };
export const PLACE_COLLECTIONS = {
  place_gazetteer: {
    schema: { type: 'object', additionalProperties: false,
      required: ['id', 'gazetteerId', 'revision', 'recordType', 'payload'],
      properties: { id, gazetteerId: id, revision: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        recordType: { enum: ['gazetteer', 'entry'] }, payload: { type: 'object' },
        lon: { type: 'number', minimum: -180, maximum: 180 }, lat: { type: 'number', minimum: -90, maximum: 90 },
        cell6: { type: 'string', minLength: 6, maxLength: 6 } } },
    key: '/id',
    indexes: [
      { name: 'by_gazetteer', path: '$.gazetteerId' },
      { name: 'by_gazetteer_cell', path: ['$.gazetteerId', '$.cell6'] },
    ],
  },
};
