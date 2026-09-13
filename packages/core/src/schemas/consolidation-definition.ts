/** One authored consolidation schema, composed with the existing memory owner. */
import { MEMORY_UNIT_SCHEMA, MEMORY_RELATION_SCHEMA, type JsonSchema } from './memory.ts';
const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
const object = (properties: Record<string, JsonSchema>, optional: string[] = []): JsonSchema => ({
  type: 'object', properties, required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false,
});
const array = (items: JsonSchema, minItems = 0): JsonSchema => ({ type: 'array', items, minItems });
const id = { type: 'string', minLength: 1 }, hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const sourceIds = { ...array(hash, 1), uniqueItems: true };
const { $id: memoryId, ...memory } = MEMORY_UNIT_SCHEMA;
const { $id: relationId, ...relation } = MEMORY_RELATION_SCHEMA;
void memoryId; void relationId;
const memoryProperties = MEMORY_UNIT_SCHEMA.properties as Record<string, JsonSchema>;

export const CONSOLIDATION_SCHEMA = {
  $id: 'https://tangleai.dev/schemas/consolidation.json',
  $ref: '#/$defs/consolidationSource',
  $defs: {
    memorySnapshot: { ...memory, properties: { ...memoryProperties, relations: array(ref('memoryRelationSnapshot')) } },
    memoryRelationSnapshot: relation,
    consolidationJson: { anyOf: [{ type: ['string', 'number', 'boolean', 'null'] },
      array(ref('consolidationJson')), { type: 'object', additionalProperties: ref('consolidationJson') }] },
    consolidationReason: { enum: ['invalid-source', 'invalid-artifact', 'identity-conflict', 'capacity', 'stale-generation',
      'persistence', 'invalid-operation', 'budget', 'unsupported', 'refusal', 'embedding', 'unknown', 'disabled',
      'empty', 'below-count', 'not-due', 'cooldown', 'clock-skew', 'backpressure', 'closed', 'cancelled'] },
    consolidationClaim: object({ text: id, sourceIds }),
    consolidationSynthesis: { anyOf: [object({ status: { enum: ['ok'] }, claims: { ...array(ref('consolidationClaim'), 1), uniqueItems: true } }),
      object({ status: { enum: ['refused'] }, detail: id })] },
    consolidationSupport: { anyOf: [object({ status: { enum: ['ok'] }, supported: array({ type: 'boolean' }, 1) }),
      object({ status: { enum: ['refused'] }, detail: id })] },
    consolidationEmbedding: object({ model: id, dims: { ...integer, minimum: 1 },
      vectors: array(array({ type: 'number' }, 1), 1) }),
    consolidationSynthesisBounds: object({ maxSources: { ...integer, minimum: 1 }, maxInputChars: { ...integer, minimum: 1 },
      maxOutputChars: { ...integer, minimum: 1 }, maxClaimChars: { ...integer, minimum: 1 }, maxClaims: { ...integer, minimum: 1 },
      maxLogicalCalls: integer, maxEmbeddingItems: integer }),
    consolidationRunRequest: object({ scope: id, key: id, sourceIds, expectedGeneration: integer, completedAt: integer,
      tier: { enum: ['semantic', 'combined'] } }, ['tier']),
    consolidationTriggerPolicy: object({ enabled: { type: 'boolean' }, tier: { enum: ['deterministic', 'semantic', 'combined'] },
      countThreshold: { ...integer, minimum: 1 }, intervalMs: { ...integer, minimum: 1 }, cooldownMs: integer,
      maxPending: { ...integer, minimum: 1 }, maxBatchSources: { ...integer, minimum: 1 },
      concurrency: { ...integer, minimum: 1 }, maxQueue: { ...integer, minimum: 1 } }),
    consolidationTriggerRequest: object({ scope: id, key: id, trigger: { enum: ['manual', 'count', 'time'] } }),
    consolidationResolution: { anyOf: [object({ stopped: { enum: [true] }, revision: integer, requestHash: hash, result: ref('consolidationJson') }),
      object({ stopped: { enum: [true] }, revision: integer, requestHash: hash,
        failure: { enum: ['refusal', 'unsupported', 'embedding', 'invalid-artifact', 'cancelled'] } })] },
    consolidationCallAccounting: object({ reservedCalls: integer, completedCalls: integer, refusedCalls: integer,
      failedCalls: integer, unknownCalls: integer, invoked: integer, embeddingItems: integer }),
    consolidationExecutionResult: { anyOf: [object({ status: { enum: ['success'] }, value: ref('consolidationReceipt'),
      operationId: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' }, accounting: ref('consolidationCallAccounting') }),
      object({ status: { enum: ['refused'] }, reason: ref('consolidationReason'), detail: { type: 'string' },
        operationId: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' }, accounting: ref('consolidationCallAccounting') })] },
    consolidationSource: object({ id: hash, scope: id, key: id, sequence: integer, snapshot: ref('memorySnapshot') }),
    consolidationArtifact: { ...object({ id: hash, scope: id, tier: { enum: ['deterministic', 'semantic', 'combined'] },
      recipeHash: hash, text: id, sourceIds, keywords: { ...array(id), uniqueItems: true },
      embedding: memoryProperties.embedding, embeddedBy: memoryProperties.embeddedBy }, ['embedding', 'embeddedBy']), dependencies: MEMORY_UNIT_SCHEMA.dependencies },
    consolidationBuffer: object({ scope: id, revision: integer, generation: integer,
      pending: { ...array(hash), uniqueItems: true }, completedAt: { type: ['integer', 'null'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      pendingSince: { type: ['integer', 'null'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }, ['pendingSince']),
    consolidationReceipt: object({ passId: hash, scope: id, revision: integer, generation: integer,
      sourceCount: integer, artifactIds: { ...array(hash), uniqueItems: true }, writes: integer,
      replayed: { type: 'boolean' }, logicalCalls: integer, embeddingItems: integer }),
    consolidationStep: object({ key: id, kind: { enum: ['synthesis', 'support', 'embedding'] }, requestHash: hash,
      phase: { enum: ['dispatched', 'completed', 'failed', 'unknown'] }, result: ref('consolidationJson'),
      detail: { type: ['string', 'null'] } }),
    consolidationOperation: object({ id: hash, scope: id, key: id, requestHash: hash, revision: integer,
      phase: { enum: ['reserved', 'working', 'prepared', 'completed', 'failed'] }, expectedGeneration: integer,
      sourceIds, recipeHash: hash, maxLogicalCalls: integer, steps: array(ref('consolidationStep')),
      artifacts: array(ref('consolidationArtifact')), receipt: { anyOf: [{ type: 'null' }, ref('consolidationReceipt')] },
      failure: { anyOf: [{ type: 'null' }, ref('consolidationReason')] } }),
  },
};
