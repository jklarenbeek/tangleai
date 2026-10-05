/** Domain measurements reference the same public lifecycle and observation contracts. */
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: object, more: object = {}) => ({ type: 'array', items, ...more });
const ref = (name: string) => ({ $ref: '#/$defs/' + name });
const external = (name: string) => ({ $ref: 'https://tangleai.dev/schemas/research-records#/$defs/' + name });
const text = { type: 'string', minLength: 1 }, count = { type: 'integer', minimum: 0 }, bool = { type: 'boolean' };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const equal = (a: unknown, b: unknown) => ({ $eq: [a, b] });
export const RESEARCH_DOMAIN_REPORT_ID = 'https://tangleai.dev/schemas/research-domains';
export const RESEARCH_DOMAIN_ROW_IDS = ['computational', 'tabular-statistics'].flatMap(id =>
  ['fixed-pipeline', 'lessons-off', 'lessons-on'].map(mode => 'domain:' + id + '/' + mode));
export const RESEARCH_DOMAINS_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#', $id: RESEARCH_DOMAIN_REPORT_ID,
  ...object({ profiles: array(external('ResearchDomainProfile'), { minItems: 2, maxItems: 2 }),
    identity: { $ref: 'https://tangleai.dev/schemas/run-identity#/$defs/identityEnvelope' },
    rows: array(ref('DomainMeasurementRow'), { minItems: 6, maxItems: 6 }),
    unsupported: object({ id: { const: 'domain:unsupported' }, code: { const: 'TRSH2008' }, missingId: text,
      modelCalls: { const: 0 }, runnerInvocations: { const: 0 }, issue: external('ResearchIssue') }),
    parity: object({ id: { const: 'control-plane-parity' }, sourceHash: external('Sha256'),
      sources: array(object({ path: text, sha256: external('Sha256') }), { minItems: 1 }),
      profileLiterals: { const: 0 }, domainComparisons: { const: 0 } }),
    external: object({ id: text, state: { const: 'not-run' }, reason: { enum: ['submodule-absent', 'manifest-unpinned', 'licence-unaudited'] },
      issues: array(external('ResearchIssue')), modelCalls: { const: 0 }, runnerInvocations: { const: 0 } }),
    gate: object({ binding: bool, controlPlane: bool, registry: bool, comparable: bool }), limitations: array(text, { minItems: 1 }) }),
  $defs: {
    TabularFixtureManifest: object({ document: { const: 'tabular-statistics-fixture' }, revision: external('Sha256'),
      seed: { const: 17753 }, licence: external('ResearchLicence'),
      datasets: array(object({ id: text, path: text }), { minItems: 3, maxItems: 3 }),
      topics: array(object({ id: text, path: text }), { minItems: 4, maxItems: 4 }),
      members: array(object({ path: { type: 'string', pattern: '^(datasets/[a-z-]+\\.csv|topics/[a-z-]+\\.json|rubric\\.json|units\\.json)$' },
        sha256: external('Sha256') }), { minItems: 9, maxItems: 9 }),
      program: object({ source: text, sha256: external('Sha256') }) }),
    TabularResearchTopic: object({ id: external('ResearchId'), title: text, taskFamily: { const: 'group-difference' },
      datasetPath: text, hypothesis: object({ H1: text, H0: text, delta: { type: 'number', minimum: 0 } }),
      contract: external('ResearchContract'), plan: external('ExperimentPlan'), licence: external('ResearchLicence') }),
    DomainLifecycleReceipt: { ...object({ runId: text, bindingId: external('Sha256'), runIdentityId: text,
      workflowVersionId: text, executableRevision: external('Sha256'), status: { const: 'completed' },
      state: external('ResearchState'), attempts: array(external('StageAttempt'), { minItems: 1 }),
      manifests: array(external('InputManifest'), { minItems: 1 }), runs: array(external('ExperimentRun'), { minItems: 1 }),
      observations: array(external('MetricObservation'), { minItems: 1 }), duplicateResponses: count, modelCalls: { const: 0 },
      spend: external('ResearchCost') }), $query: { $and: [
        ...['calls', 'tokens', 'physical', 'ms'].map(name => equal('$.spend.' + name, { $sum: '$.attempts[*].spend.' + name })),
        equal('$.spend.physical', { $count: '$.runs[*]' }), equal('$.modelCalls', '$.spend.calls'),
        equal({ $count: '$.observations[*]' }, { $count: '$.runs[*]' }),
      ] } },
    DomainTopicMeasurement: object({ topicId: text, topicHash: external('Sha256'), contractHash: external('Sha256'), planHash: external('Sha256'),
      lifecycle: ref('DomainLifecycleReceipt'), tabular: nullable(external('TabularStatisticsSummary')),
      result: { enum: ['improvement', 'no-improvement', 'inconclusive', 'SATURATED'] },
      claimSupport: { type: 'number', minimum: 0, maximum: 1 }, registryAccuracy: { const: 1 }, preregistrationIntegrity: { const: 1 } }),
    DomainMeasurementRow: object({ id: { enum: RESEARCH_DOMAIN_ROW_IDS }, profileId: text, profileRevision: external('Sha256'),
      identityStatus: { const: 'run' }, comparisonIdentity: external('Sha256'),
      budget: external('ResearchCost'), spend: external('LessonSpend'), topics: array(ref('DomainTopicMeasurement'), { minItems: 3, maxItems: 4 }),
      lesson: nullable({ $ref: 'https://tangleai.dev/schemas/research-lessons#/$defs/LessonNativeMeasurement' }),
      activated: bool, eligibilityIssues: array(text), limitations: array(text, { minItems: 1 }) }),
  },
  $query: { $and: [equal(['$.rows[*].id'], RESEARCH_DOMAIN_ROW_IDS), equal(['$.identity.rows[*].rowId'], ['$.rows[*].id']),
    equal('$.gate.binding', equal('$.unsupported.code', 'TRSH2008')),
    equal('$.gate.controlPlane', { $and: [equal('$.parity.profileLiterals', 0), equal('$.parity.domainComparisons', 0)] }),
    equal('$.gate.registry', { $every: { row: '$.rows[*]' }, $satisfies: { $every: { topic: '$row.topics[*]' },
      $satisfies: equal('$topic.registryAccuracy', 1) } }),
    equal('$.gate.comparable', { $every: { row: '$.rows[*]' }, $satisfies: { $and:
      ['calls', 'tokens', 'physical', 'ms'].map(name => ({ $le: ['$row.spend.' + name, '$row.budget.' + name] })) } }),
    ...[1, 2, 3, 4, 5].map(i => equal('$.rows[' + i + '].budget', '$.rows[0].budget')),
    ...[0, 3].flatMap(i => [equal('$.rows[' + (i + 1) + '].comparisonIdentity', '$.rows[' + (i + 2) + '].comparisonIdentity'),
      equal(['$.rows[' + (i + 1) + '].topics[*].topicHash'], ['$.rows[' + (i + 2) + '].topics[*].topicHash'])]),
  ] },
};
