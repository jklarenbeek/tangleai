/** Deferred external adapter contracts; upstream compatibility requires a pinned audited slice. */
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: object, more: object = {}) => ({ type: 'array', items, ...more });
const text = { type: 'string', minLength: 1 }, sha256 = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const external = (name: string) => ({ $ref: 'https://tangleai.dev/schemas/research-records#/$defs/' + name });
const manifestFields = { source: text,
    licence: object({ spdx: text, textSha256: sha256, auditedBy: text, auditedAt: { type: 'string', format: 'date-time' }, terms: array(text, { minItems: 1 }) }),
    slice: object({ name: { enum: ['ml-core-25', 'paper-45', 'tree-55'] }, topicIds: array({ type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$' }, { minItems: 1, maxItems: 55, uniqueItems: true }) }),
    protocol: object({ judge: text, attempts: { type: 'integer', minimum: 1, maximum: 8 }, selection: { enum: ['all', 'best-of-n'] } }),
    localOnly: array(text, { uniqueItems: true }) };
export const ARC_MANIFEST_SCHEMA = { $schema: 'http://json-schema.org/draft-07/schema#', $id: 'https://tangleai.dev/schemas/arc-bench-manifest',
  oneOf: [object({ ...manifestFields, commit: { type: 'string', pattern: '^[a-f0-9]{40}$' } }), object({ ...manifestFields, archiveSha256: sha256 })] };
export const ARC_TOPIC_SCHEMA = { $schema: 'http://json-schema.org/draft-07/schema#', $id: 'https://tangleai.dev/schemas/arc-bench-topic',
  ...object({ id: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$' }, title: text, question: text,
    taskFamily: text, contract: external('ResearchContract'), plan: external('ExperimentPlan') }) };
