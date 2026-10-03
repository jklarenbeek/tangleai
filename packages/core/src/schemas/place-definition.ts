/** Place contracts compose the temporal owner's definitions without copying them. */
import temporal from '../../schemas/temporal.schema.json' with { type: 'json' };
import type { JsonSchema } from './memory.ts';

const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const object = (properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema => ({
  type: 'object', properties, required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false,
});
const array = (items: JsonSchema, minItems = 0): JsonSchema => ({ type: 'array', items, minItems });
const id = { type: 'string', minLength: 1 }, hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const nullableId = { anyOf: [id, { type: 'null' }] };
const ids = (minItems = 0) => ({ ...array(id, minItems), uniqueItems: true });
const hashes = (minItems = 0) => ({ ...array(hash, minItems), uniqueItems: true });
const query = temporal.$defs.temporalQuery.properties;
const reasonByCode = {
  TPLC1001: 'invalid-shape', TPLC1002: 'invalid-geometry', TPLC1003: 'unsourced-coordinate',
  TPLC1004: 'unknown-entry', TPLC1005: 'ungrounded-mention', TPLC1006: 'ambiguous-place',
  TPLC1007: 'spatial-gate', TPLC1008: 'no-position-at-instant', TPLC1009: 'temporal-refusal',
  TPLC1010: 'storage-failure', TPLC1011: 'budget-exhausted',
} as const;
const answerEvidence = (minimum: number) => ({
  claimIds: hashes(minimum), sourceIds: hashes(minimum), citations: { ...array(ref('sourceSpan'), minimum), uniqueItems: true },
});

export const PLACE_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://tangleai.dev/schemas/place',
  $ref: '#/$defs/gazetteer',
  $defs: {
    ...temporal.$defs,
    position: { type: 'array', items: [{ type: 'number', minimum: -180, maximum: 180 },
      { type: 'number', minimum: -90, maximum: 90 }], minItems: 2, maxItems: 2, additionalItems: false },
    placeGeometry: object({ type: { enum: ['Point'] }, coordinates: ref('position') }),
    placeSource: object({ kind: { enum: ['wikidata', 'geonames'] }, id,
      url: { type: 'string', pattern: '^https?://[^\\s]+$' },
      retrieved: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }),
    placeSourceLatLon: object({ lat: { type: 'number', minimum: -90, maximum: 90 }, lon: { type: 'number', minimum: -180, maximum: 180 } }),
    gazetteerEntry: object({ id, names: { ...array(id, 1), uniqueItems: true }, geometry: ref('placeGeometry'),
      sourceLatLon: ref('placeSourceLatLon'),
      source: ref('placeSource'), confidence: { enum: ['exact', 'settlement', 'region'] } }),
    gazetteer: object({ id, revision: hash, entries: array(ref('gazetteerEntry')) }),
    placeMention: {
      oneOf: [
        object({ ...temporal.$defs.sourceSpan.properties, entryId: id, status: { enum: ['grounded'] }, candidates: ids(1) }),
        object({ ...temporal.$defs.sourceSpan.properties, entryId: { type: 'null' }, status: { enum: ['ambiguous'] }, candidates: ids(2) }),
        object({ ...temporal.$defs.sourceSpan.properties, entryId: { type: 'null' }, status: { enum: ['ungrounded'] }, candidates: { ...ids(), maxItems: 0 } }),
      ],
      $query: { $and: [
        { $lt: ['$.start', '$.end'] },
        { $or: [{ $ne: ['$.status', { $const: 'grounded' }] }, { $exists: { '$index-of': ['$.candidates[*]', '$.entryId'] } }] },
      ] },
    },
    placeIntent: object({ proximity: { type: 'boolean' }, spatial: { type: 'boolean' } }),
    placeCode: { enum: Object.keys(reasonByCode) },
    placeReason: { enum: Object.values(reasonByCode) },
    placeCoverage: object({ occurrences: integer, comparable: integer, semanticCandidates: integer,
      positions: integer, unplaceable: integer, poolTruncated: { type: 'boolean' }, complete: { type: 'boolean' } }),
    placeRefusal: { oneOf: Object.entries(reasonByCode).map(([code, reason]) => object({
      status: { enum: ['refused'] }, code: { enum: [code] }, reason: { enum: [reason] }, detail: id,
      cause: id, coverage: ref('placeCoverage'),
    }, ['cause', 'coverage'])) },
    geohashPrecision: { type: 'integer', minimum: 1, maximum: 12 },
    positionSample: object({ claimId: hash, entryId: id, at: id, until: nullableId, kind: { enum: ['state', 'event'] } }),
    placeOperation: { oneOf: [
      object({ kind: { enum: ['location-at'] }, at: id }),
      object({ kind: { enum: ['location-at-event'] }, eventClaimId: hash }),
      object({ kind: { enum: ['movement'] }, fromClaimId: hash, toClaimId: hash }),
      object({ kind: { enum: ['nearby'] }, entryId: id, radiusMetres: { type: 'number', minimum: 0 }, precision: ref('geohashPrecision') }),
    ] },
    placeQuery: object({ scope: query.scope, subject: id, operation: ref('placeOperation'), knowledge: query.knowledge,
      embeddedBy: query.embeddedBy, embedding: query.embedding, candidatePool: query.candidatePool,
      k: query.k, minScore: query.minScore, expectedHead: query.expectedHead }),
    placeAnswer: { oneOf: [
      object({ kind: { enum: ['location-at', 'location-at-event'] }, entryId: id, ...answerEvidence(1) }),
      object({ kind: { enum: ['movement'] }, fromEntryId: id, toEntryId: id, metres: integer, ...answerEvidence(1) }),
      object({ kind: { enum: ['nearby'] }, entryIds: ids(), ...answerEvidence(0) }),
    ] },
  },
};
