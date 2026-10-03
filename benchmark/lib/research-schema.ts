/** Closed fixture contracts; the report references one record-definition owner. */
import { researchSchema } from '@tangleai/research';

type Schema = Record<string, unknown>;
const record = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const array = (items: Schema, extra: Schema = {}): Schema => ({ type: 'array', items, ...extra });
const ref = (name: string): Schema => ({ $ref: '#/$defs/' + name });
const text: Schema = { type: 'string', minLength: 1 };
const count: Schema = { type: 'integer', minimum: 0 };
const positive: Schema = { type: 'integer', minimum: 1 };
const number: Schema = { type: 'number' };
const names = (values: readonly string[]): Schema => ({ enum: [...values] });
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
export const RESEARCH_RECORD_ID = 'https://tangleai.dev/schemas/research-records';
export const RESEARCH_REPORT_ID = 'https://tangleai.dev/schemas/research';
export const RESEARCH_ROW_IDS = ['artifact-oracle', 'no-model-runner', 'single-pass-retrieve-draft', 'fixed-single-agent',
  'fixed-plus-debate', 'fixed-plus-branching', 'gate-only-full', 'full-auto-full'] as const;
export const RESEARCH_DIMENSIONS = ['preregistrationIntegrity', 'literatureRecall', 'literaturePrecision',
  'citationIdentity', 'claimSupport', 'registryAccuracy', 'rerunRate', 'confoundDetection',
  'negativeResultHandling', 'branchSelectionCompliance', 'gateBehaviour', 'tracesCompleteness'] as const;
export const RESEARCH_DISCLOSURES = ['human-review', 'runnable-implementation', 'reconstructible-execution',
  'novelty-audit', 'attempt-selection-registration', 'baseline-audit', 'independent-verification', 'frozen-hypotheses'] as const;

export const RESEARCH_RECORD_SCHEMA = researchSchema;

const external = (name: string): Schema => ({ $ref: RESEARCH_RECORD_ID + '#/$defs/' + name });
const score: Schema = { ...record({ passed: count, total: positive, value: { type: 'number', minimum: 0, maximum: 1 } }),
  $query: { $and: [{ $le: ['$.passed', '$.total'] }, { $eq: ['$.value', { $div: ['$.passed', '$.total'] }] }] } };
const dimensions = Object.fromEntries(RESEARCH_DIMENSIONS.map(name => [name, ref('ResearchScore')]));
const failures = record(Object.fromEntries(['program', 'verification', 'leakage', 'confound', 'budget', 'provider', 'unsupported']
  .map(name => [name, count])));
const measurement = {
  ...dimensions, interventions: record({ total: count, substantive: count, approvals: count }),
  cost: external('ResearchCost'), failures, completion: ref('ResearchScore'),
};
const topicProperties = { topicId: external('ResearchId'), ...measurement,
  result: names(['improvement', 'inconclusive', 'no-improvement', 'SATURATED', 'failed']), bundleHash: external('Sha256'),
  bundle: external('ResearchBundle'),
  observations: array(external('MetricObservation')), claimsExpected: array(text, { minItems: 1, uniqueItems: true }),
  claimsSupported: array(text, { uniqueItems: true }), verificationIssues: array(external('ResearchIssue')) };
const rowProperties = { id: names(RESEARCH_ROW_IDS), state: { const: 'measured' }, ...measurement,
  topics: array(ref('ResearchTopicResult'), { minItems: 3, maxItems: 3 }) };
const queries: unknown[] = [
  { $eq: [['$.rows[*].id'], [...RESEARCH_ROW_IDS]] },
  { $eq: [['$.identity.rows[*].rowId'], ['$.rows[*].id']] },
  { $eq: [{ $count: '$.bundles[*]' }, { $count: '$.registration.bundles[*]' }] },
  { $eq: [['$.bundles[*].id'], ['$.registration.bundles[*].id']] },
  { $eq: [{ $count: '$.registration.topics[*]' }, { $count: { $distinct: '$.registration.topics[*]' } }] },
  { $eq: [{ $count: '$.registration.bundles[*].id' }, { $count: { $distinct: '$.registration.bundles[*].id' } }] },
  { $every: { row: '$.rows[?(@.state=="measured")]' }, $satisfies: { $eq: [['$row.topics[*].topicId'], ['$.registration.topics[*]']] } },
  { $every: { bundle: '$.bundles[*]' }, $satisfies: { $eq: ['$bundle.refusedAsRegistered',
    { $and: [{ $eq: ['$bundle.expected.code', '$bundle.observed.code'] }, { $eq: ['$bundle.expected.path', '$bundle.observed.path'] }] }] } },
  { $every: { bundle: '$.bundles[*]' }, $satisfies: { $some: { registered: '$.registration.bundles[*]' }, $satisfies: { $and: [
    { $eq: ['$bundle.id', '$registered.id'] }, { $eq: ['$bundle.expected', '$registered.expected'] },
  ] } } },
  { $eq: ['$.gate.bundles', { $every: { bundle: '$.bundles[*]' }, $satisfies: '$bundle.refusedAsRegistered' }] },
  { $eq: [['$.disclosure[*].rowId'], ['$.rows[*].id']] },
];
for (const dimension of [...RESEARCH_DIMENSIONS, 'completion']) {
  queries.push({ $every: { row: '$.rows[?(@.state=="measured")]' }, $satisfies: { $and: [
    { $eq: ['$row.' + dimension + '.passed', { $sum: '$row.topics[*].' + dimension + '.passed' }] },
    { $eq: ['$row.' + dimension + '.total', { $sum: '$row.topics[*].' + dimension + '.total' }] },
  ] } });
}
for (const [group, members] of Object.entries({ cost: ['calls', 'tokens', 'ms', 'physical'],
  interventions: ['total', 'substantive', 'approvals'], failures: ['program', 'verification', 'leakage', 'confound', 'budget', 'provider', 'unsupported'] })) {
  for (const member of members) queries.push({ $every: { row: '$.rows[?(@.state=="measured")]' }, $satisfies:
    { $eq: ['$row.' + group + '.' + member, { $sum: '$row.topics[*].' + group + '.' + member }] } });
}
queries.push({ $eq: [['$.ceilings[*].topicId'], ['$.registration.topics[*]']] });
queries.push({ $every: { row: '$.disclosure[*]' }, $satisfies: { $eq: [['$row.items[*].item'], [...RESEARCH_DISCLOSURES]] } });
export const RESEARCH_REPORT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#', $id: RESEARCH_REPORT_ID,
  ...record({
    benchmark: { const: 'research' }, schemaVersion: { const: 1 },
    source: record({ head: { type: 'string', pattern: '^[0-9a-f]{40}$' }, clean: { type: 'boolean' },
      files: array(record({ path: text, sha256: external('Sha256') }), { minItems: 1 }), sha256: external('Sha256') }),
    suite: record({ packages: array(record({ name: text, version: text }), { minItems: 1 }) }),
    registration: record({ id: { const: 'research-computational-v1' }, revision: external('Sha256'),
      topics: array(external('ResearchId'), { minItems: 3, maxItems: 3 }),
      caps: record({ calls: { const: 128 }, tokens: { const: 131072 }, ms: { const: 120000 },
        concurrency: { const: 4 }, contextChars: { const: 65536 }, traceBytes: { const: 1048576 } }),
      replicatePolicy: external('ReplicatePolicy'),
      bundles: array(record({ id: external('ResearchId'), expected: ref('ResearchRefusal') }), { minItems: 21, maxItems: 21 }) }),
    identity: { $ref: 'https://tangleai.dev/schemas/run-identity#/$defs/identityEnvelope' },
    ceilings: array(record({ topicId: external('ResearchId'), literatureRecall: ref('ResearchScore'),
      literaturePrecision: ref('ResearchScore'), citationIdentity: ref('ResearchScore'), registryAccuracy: ref('ResearchScore') }),
    { minItems: 3, maxItems: 3 }),
    rows: array({ oneOf: [ref('ResearchMeasuredRow'), ref('ResearchMissingRow')] }, { minItems: 8, maxItems: 8 }),
    bundles: array(record({ id: external('ResearchId'), expected: ref('ResearchRefusal'),
      observed: nullable(ref('ResearchRefusal')), refusedAsRegistered: { type: 'boolean' } }), { minItems: 21, maxItems: 21 }),
    disclosure: array(record({ rowId: names(RESEARCH_ROW_IDS), items: external('DisclosureChecklist') }), { minItems: 8, maxItems: 8 }),
    gate: record({ registration: { type: 'boolean' }, oracle: { type: 'boolean' }, bundles: { type: 'boolean' }, networkCalls: { const: 0 } }),
    decision: names(['conformant', 'drift']), limitations: array(text, { minItems: 1 }), reportId: external('Sha256'),
  }),
  $defs: {
    ResearchBlobs: record({ id: text, kind: { const: 'blobs' },
      points: array(record({ id: text, vector: array(number, { minItems: 2, maxItems: 2 }) }), { minItems: 1 }) }),
    ResearchCorpus: record({ id: text, kind: { const: 'corpus' },
      documents: array(record({ id: text, text: { type: 'string', pattern: '^[a-z ]+$' } }), { minItems: 1 }),
      queries: array(record({ id: text, text: { type: 'string', pattern: '^[a-z ]+$' } }), { minItems: 1 }) }),
    ResearchDataset: { oneOf: [ref('ResearchBlobs'), ref('ResearchCorpus')] },
    ResearchHiddenLabels: record({ topicId: external('ResearchId'), relevantLiterature: array(text, { minItems: 1, uniqueItems: true }),
      requiredClaims: array(record({ id: text, kind: names(['literature', 'metric', 'interpretation']),
        text, literatureId: nullable(text), observationCondition: nullable(text), strength: names(['descriptive', 'causal']) }), { minItems: 1 }),
      queryGold: array(record({ queryId: text, relevantIds: array(text, { minItems: 1, uniqueItems: true }) })),
      metricTolerance: { type: 'number', minimum: 0 }, registeredTruth: names(['improvement', 'SATURATED']) }),
    ResearchFixtureTopic: record({ id: external('ResearchId'), title: text, datasetPath: text, hiddenPath: text,
      contract: external('ResearchContract'), plan: external('ExperimentPlan'), licence: external('ResearchLicence') }),
    ResearchFixtureManifest: record({ id: { const: 'research-computational-v1' }, version: { const: 1 },
      topics: array(record({ id: external('ResearchId'), path: text }), { minItems: 3, maxItems: 3 }),
      literature: record({ records: text, gold: text }),
      programs: array(record({ id: text, source: text, sha256: external('Sha256'), licence: external('ResearchLicence') }), { minItems: 9, maxItems: 9 }),
      datasets: array(text, { minItems: 2, maxItems: 2, uniqueItems: true }),
      bundles: array(record({ id: external('ResearchId'), path: text, expected: ref('ResearchRefusal') }), { minItems: 21, maxItems: 21 }),
      oracles: array(record({ topicId: external('ResearchId'), path: text }), { minItems: 3, maxItems: 3 }),
      caps: record({ calls: { const: 128 }, tokens: { const: 131072 }, ms: { const: 120000 },
        concurrency: { const: 4 }, contextChars: { const: 65536 }, traceBytes: { const: 1048576 } }),
      replicatePolicy: external('ReplicatePolicy'), licence: external('ResearchLicence'),
      members: array(record({ path: text, sha256: external('Sha256'), licence: external('ResearchLicence') }), { minItems: 1 }),
      revision: external('Sha256') }),
    ResearchScore: score,
    ResearchRefusal: record({ code: { type: 'string', pattern: '^TRSH10(0[1-9]|10)$' }, path: { type: 'string' } }),
    ResearchTopicResult: record(topicProperties),
    ResearchMeasuredRow: record(rowProperties),
    ResearchMissingRow: record({ id: names(RESEARCH_ROW_IDS), state: names(['implementation-missing', 'not-run']), reason: text }),
  },
  $query: { $and: [...queries, { $eq: [{ $eq: ['$.decision', 'conformant'] },
    { $and: ['$.gate.registration', '$.gate.oracle', '$.gate.bundles'] }] }] },
};
