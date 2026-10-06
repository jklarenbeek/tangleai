/** Audit counts derive from individual retained-record checks, including disagreements. */
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: object) => ({ type: 'array', items });
const text = { type: 'string', minLength: 1 }, count = { type: 'integer', minimum: 0 };
const ref = (name: string) => ({ $ref: '#/$defs/' + name });
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const eq = (a: unknown, b: unknown) => ({ $eq: [a, b] });
const states = ['resolved', 'unresolved', 'fabricated', 'missing'];
export const RESEARCH_AUDIT_REPORT_ID = 'https://tangleai.dev/schemas/research-audit';
export const RESEARCH_AUDIT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#', $id: RESEARCH_AUDIT_REPORT_ID,
  ...object({ runs: array(ref('ResearchArtifactAudit')), probes: { ...array(ref('ResearchAuditProbe')), minItems: 2, maxItems: 2 },
    totals: object(Object.fromEntries(['checked', ...states, 'auditDisagreements'].map(name => [name, count]))), limitations: array(text) }),
  $defs: {
    ResearchAuditProbe: { ...object({ id: { enum: ['fabricated-number', 'dangling-citation'] }, source: text,
      state: { enum: ['measured', 'not-run'] }, reason: nullable(text),
      inputSha256: nullable({ $ref: 'https://tangleai.dev/schemas/research-records#/$defs/Sha256' }),
      input: nullable({ $ref: 'https://tangleai.dev/schemas/research-records#/$defs/ResearchExportManifest' }),
      mutation: nullable(object({ path: text, before: text, after: text })), audit: nullable(ref('ResearchArtifactAudit')), matched: { type: 'boolean' } }),
      $query: { $or: [{ $and: [eq('$.state', 'not-run'), eq('$.matched', false),
        ...['input', 'inputSha256', 'mutation', 'audit'].map(key => eq('$.' + key, null)), { $ne: ['$.reason', null] }] },
      { $and: [eq('$.state', 'measured'), eq('$.reason', null),
        ...['input', 'inputSha256', 'mutation', 'audit'].map(key => ({ $ne: ['$.' + key, null] })),
        eq('$.matched', { $and: [{ $gt: ['$.audit.auditDisagreements', 0] }, { $or: [
        { $and: [eq('$.id', 'fabricated-number'), { $gt: ['$.audit.fabricated', 0] }] },
        { $and: [eq('$.id', 'dangling-citation'), { $gt: ['$.audit.unresolved', 0] }] },
      ] }] })] }] } },
    ResearchAuditCheck: object({ kind: { enum: ['artifact', 'metric', 'citation', 'claim', 'intervention', 'seed', 'trace', 'prompt'] },
      state: { enum: states }, path: text, recordIds: array(text), detail: text }),
    ResearchAuditDisagreement: object({ path: text, reported: text, observed: text }),
    ResearchArtifactAudit: { ...object({ id: text, projectId: { anyOf: [text, { type: 'null' }] }, source: text, scope: text,
      checked: count, resolved: count, unresolved: count, fabricated: count, missing: count, auditDisagreements: count,
      checks: array(ref('ResearchAuditCheck')), disagreements: array(ref('ResearchAuditDisagreement')),
      interventions: { anyOf: [{ $ref: 'https://tangleai.dev/schemas/research-records#/$defs/ResearchInterventionReport' }, { type: 'null' }] },
      limitations: array(text) }), $query: { $and: [eq('$.checked', { $count: '$.checks[*]' }),
        ...states.map(state => eq('$.' + state, { $count: '$.checks[?(@.state=="' + state + '")]' })),
        eq('$.auditDisagreements', { $count: '$.disagreements[*]' }),
      ] } },
  },
  $query: { $and: [eq(['$.probes[*].id'], ['fabricated-number', 'dangling-citation']),
    ...['checked', ...states, 'auditDisagreements'].map(name => eq('$.totals.' + name, { $sum: '$.runs[*].' + name }))] },
};
