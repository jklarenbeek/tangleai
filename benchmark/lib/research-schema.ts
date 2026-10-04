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
  claimsSupported: array(text, { uniqueItems: true }), verificationIssues: array(external('ResearchIssue')),
  workflow: nullable(ref('ResearchWorkflowMeasurement')), completePathControl: nullable(ref('ResearchWorkflowMeasurement')) };
const rowProperties = { id: names(RESEARCH_ROW_IDS), state: { const: 'measured' }, scope: { const: 'full-lifecycle' }, ...measurement,
  topics: array(ref('ResearchTopicResult'), { minItems: 3, maxItems: 3 }) };
export const RESEARCH_REASONING_DIMENSIONS = ['hypothesisValidity', 'evidenceLinkage', 'designIntegrity', 'hiddenIsolation', 'refusalConformance'] as const;
const reasoningMeasurements = { ...Object.fromEntries(RESEARCH_REASONING_DIMENSIONS.map(name => [name, ref('ResearchScore')])),
  interventions: measurement.interventions, cost: external('ResearchCost'), failures, usage: ref('ResearchModelUsage') };
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
  queries.push({ $every: { row: '$.rows[?(@.scope=="full-lifecycle")]' }, $satisfies: { $and: [
    { $eq: ['$row.' + dimension + '.passed', { $sum: '$row.topics[*].' + dimension + '.passed' }] },
    { $eq: ['$row.' + dimension + '.total', { $sum: '$row.topics[*].' + dimension + '.total' }] },
  ] } });
}
for (const dimension of RESEARCH_REASONING_DIMENSIONS) queries.push({ $every: { row: '$.rows[?(@.scope=="pre-execution")]' }, $satisfies: { $and: [
  { $eq: ['$row.' + dimension + '.passed', { $sum: '$row.topics[*].' + dimension + '.passed' }] },
  { $eq: ['$row.' + dimension + '.total', { $sum: '$row.topics[*].' + dimension + '.total' }] },
] } });
for (const member of ['roles', 'completion', 'normalization', 'repair', 'physical', 'promptTokens', 'completionTokens', 'unknownTokenRequests', 'traceBytes'])
  queries.push({ $every: { row: '$.rows[?(@.scope=="pre-execution")]' }, $satisfies:
    { $eq: ['$row.usage.' + member, { $sum: '$row.topics[*].usage.' + member }] } });
queries.push({ $every: { row: '$.rows[?(@.scope=="pre-execution")]' }, $satisfies: {
  $every: { topic: '$row.topics[*]' }, $satisfies: { $and: [
    { $eq: ['$topic.state.status', 'DESIGN_GATE'] },
    { $eq: ['$topic.state.contractHash', '$topic.contract.contractHash'] },
    { $eq: ['$topic.state.planHash', '$topic.plan.planHash'] },
    { $eq: ['$topic.plan.contractHash', '$topic.contract.contractHash'] },
    { $eq: ['$topic.usage.physical', { $add: [{ $add: ['$topic.usage.completion', '$topic.usage.normalization'] }, '$topic.usage.repair'] }] },
    { $eq: ['$topic.usage.physical', { $count: '$topic.requests[*]' }] },
    { $eq: ['$topic.cost.physical', '$topic.usage.physical'] },
    { $eq: ['$topic.cost.calls', '$topic.usage.physical'] },
    { $eq: ['$topic.cost.tokens', { $add: ['$topic.usage.promptTokens', '$topic.usage.completionTokens'] }] },
    { $le: ['$topic.usage.traceBytes', '$.registration.caps.traceBytes'] },
    { $le: [{ $count: '$topic.visibleCardIds[*]' }, '$topic.availableCards'] },
    ...['calls', 'tokens', 'ms', 'physical'].map(dimension => ({ $eq: ['$topic.cost.' + dimension, { $sum: '$topic.attempts[*].spend.' + dimension }] })),
  ] },
} });
for (const [group, members] of Object.entries({ cost: ['calls', 'tokens', 'ms', 'physical'],
  interventions: ['total', 'substantive', 'approvals'], failures: ['program', 'verification', 'leakage', 'confound', 'budget', 'provider', 'unsupported'] })) {
  for (const member of members) queries.push({ $every: { row: '$.rows[?(@.state=="measured")]' }, $satisfies:
    { $eq: ['$row.' + group + '.' + member, { $sum: '$row.topics[*].' + group + '.' + member }] } });
}
queries.push({ $eq: [['$.ceilings[*].topicId'], ['$.registration.topics[*]']] });
queries.push({ $every: { row: '$.disclosure[*]' }, $satisfies: { $eq: [['$row.items[*].item'], [...RESEARCH_DISCLOSURES]] } });
const analysisGate = { $and: [
  { $eq: [{ $count: '$.analysis.rows[*]' }, 2] }, { $eq: [{ $count: '$.analysis.probes[*]' }, 5] },
  { $eq: [{ $count: '$.analysis.repair[*]' }, 2] },
  { $every: { probe: '$.analysis.probes[*]' }, $satisfies: '$probe.matched' },
  { $every: { row: '$.analysis.rows[*]' }, $satisfies: { $and: ['confoundDetection', 'negativeResultHandling', 'branchSelectionCompliance']
    .map(name => ({ $eq: ['$row.' + name + '.value', 1] })) } },
] };
queries.push({ $eq: ['$.gate.analysis', analysisGate] });
queries.push({ $every: { probe: '$.analysis.probes[*]' }, $satisfies: { $eq: ['$probe.matched', { $eq: ['$probe.expected', '$probe.decision.kind'] }] } });
queries.push({ $every: { row: '$.analysis.rows[*]' }, $satisfies: { $and: [
  { $eq: [['$row.topics[*].topicId'], ['$.registration.topics[*]']] },
  ...['calls', 'tokens', 'ms', 'physical'].map(key => ({ $eq: ['$row.cost.' + key, { $sum: '$row.topics[*].cost.' + key }] })),
] } });
for (const path of ['$.analysis.rows[*].topics[*]', '$.analysis.repair[*]']) queries.push({ $every: { topic: path }, $satisfies: { $and: [
  { $eq: ['$topic.nativeStatus', 'completed'] }, { $eq: ['$topic.state.status', 'STOPPED'] },
  { $eq: ['$topic.state.contractHash', '$topic.contract.contractHash'] }, { $eq: ['$topic.state.planHash', '$topic.plan.planHash'] },
  { $le: ['$topic.traceBytes', '$.registration.caps.traceBytes'] },
  { $eq: ['$topic.cost.physical', { $add: ['$topic.cost.calls', { $count: '$topic.runs[*]' }] }] },
  { $eq: ['$topic.reviewCalls', { $sum: '$topic.attempts[?(@.stage=="DECIDE")].spend.calls' }] },
  { $some: { decision: '$topic.decisions[*]' }, $satisfies: { $and: [
    { $eq: ['$decision.id', '$topic.finalDecisionId'] }, { $eq: ['$decision.kind', 'Stop'] },
    { $eq: ['$decision.details.analysisId', '$topic.finalAnalysisId'] },
  ] } },
  ...['calls', 'tokens', 'ms', 'physical'].map(key => ({ $eq: ['$topic.cost.' + key, { $sum: '$topic.attempts[*].spend.' + key }] })),
] } });
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
      bundles: array(record({ id: external('ResearchId'), expected: ref('ResearchRefusal') }), { minItems: 26, maxItems: 26 }) }),
    identity: { $ref: 'https://tangleai.dev/schemas/run-identity#/$defs/identityEnvelope' },
    ceilings: array(record({ topicId: external('ResearchId'), literatureRecall: ref('ResearchScore'),
      literaturePrecision: ref('ResearchScore'), citationIdentity: ref('ResearchScore'), registryAccuracy: ref('ResearchScore') }),
    { minItems: 3, maxItems: 3 }),
    rows: array({ oneOf: [ref('ResearchMeasuredRow'), ref('ResearchReasoningRow'), ref('ResearchExecutionRow'), ref('ResearchMissingRow')] }, { minItems: 8, maxItems: 8 }),
    execution: record({ registrationHash: external('Sha256'), control: nullable(ref('ResearchExecutionRow')),
      failureProbes: array(record({ id: names(['program-throw', 'cancelled']), topic: ref('ResearchExecutionTopic') }), { maxItems: 2 }) }),
    analysis: record({ registrationHash: external('Sha256'), rows: array(ref('ResearchAnalysisRow'), { maxItems: 2 }),
      probes: array(ref('ResearchDecisionProbe'), { maxItems: 5 }), repair: array(ref('ResearchAnalysisTopic'), { maxItems: 2 }) }),
    discovery: array(ref('ResearchDiscoveryMeasurement'), { maxItems: 3 }),
    bundles: array(record({ id: external('ResearchId'), expected: ref('ResearchRefusal'),
      observed: nullable(ref('ResearchRefusal')), refusedAsRegistered: { type: 'boolean' } }), { minItems: 26, maxItems: 26 }),
    disclosure: array(record({ rowId: names(RESEARCH_ROW_IDS), items: external('DisclosureChecklist') }), { minItems: 8, maxItems: 8 }),
    gate: record({ registration: { type: 'boolean' }, oracle: { type: 'boolean' }, bundles: { type: 'boolean' }, analysis: { type: 'boolean' }, networkCalls: { const: 0 } }),
    decision: names(['conformant', 'drift']), limitations: array(text, { minItems: 1 }), reportId: external('Sha256'),
  }),
  $defs: {
    ResearchDecisionRegistration: record({ id: { const: 'research-decisions-v1' }, licence: external('ResearchLicence'),
      analystIdentityId: external('ResearchId'), reviewerIdentityId: external('ResearchId'), statisticId: text,
      repair: record({ topicId: { const: 'kmeans-seeding' }, programId: text, fault: text }),
      control: record({ attemptCap: positive, seedBatchSize: positive, rule: external('ResearchBranchSelectionRule') }),
      branching: record({ attemptCap: positive, seedBatchSize: positive, rule: external('ResearchBranchSelectionRule') }),
      cases: array(record({ id: names(['success', 'bug', 'degenerate', 'confound', 'negative']), baseline: array(number, { minItems: 5, maxItems: 5 }),
        candidate: nullable(array(number, { minItems: 5, maxItems: 5 })), variationCheck: { type: 'boolean' }, confounded: { type: 'boolean' },
        expected: names(['Proceed', 'Refine', 'Pivot', 'Stop']) }), { minItems: 5, maxItems: 5 }) }),
    ResearchDecisionProbe: record({ id: text, expected: names(['Proceed', 'Refine', 'Pivot', 'Stop']), matched: { type: 'boolean' },
      review: external('ResearchExecutionWireArtifact'), analysis: external('Analysis'), decision: external('ResearchDecision'), selection: external('ResearchBranchSelection'),
      contract: external('ResearchContract'), plan: external('ExperimentPlan'), branches: array(external('ExperimentBranch')),
      manifests: array(external('ExecutionManifest')), runs: array(external('ExperimentRun')), observations: array(external('MetricObservation')),
      cost: external('ResearchCost') }),
    ResearchAnalysisTopic: record({ topicId: external('ResearchId'), nativeStatus: names(['completed', 'failed']), state: external('ResearchState'),
      runIdentityId: external('Sha256'), workflowVersionId: external('Sha256'), contract: external('ResearchContract'), plan: external('ExperimentPlan'),
      attempts: array(external('StageAttempt')), branches: array(external('ExperimentBranch')), manifests: array(external('ExecutionManifest')),
      runs: array(external('ExperimentRun')), observations: array(external('MetricObservation')), analyses: array(external('Analysis')),
      reviews: array(external('ResearchExecutionWireArtifact')), decisions: array(external('ResearchDecision')), selections: array(external('ResearchBranchSelection')), cost: external('ResearchCost'),
      finalAnalysisId: external('ResearchId'), finalDecisionId: external('ResearchId'), traceBytes: count, reviewCalls: count }),
    ResearchAnalysisRow: record({ id: names(['fixed-single-agent', 'fixed-plus-branching']), topics: array(ref('ResearchAnalysisTopic'), { minItems: 3, maxItems: 3 }),
      confoundDetection: ref('ResearchScore'), negativeResultHandling: ref('ResearchScore'), branchSelectionCompliance: ref('ResearchScore'), cost: external('ResearchCost') }),
    ResearchExecutionRegistration: record({ id: { const: 'research-execution-v1' }, licence: external('ResearchLicence'),
      imageDigest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' }, dependencyLockHash: external('Sha256'),
      resources: external('ExecutionManifestResources'), topics: array(record({ topicId: external('ResearchId'), attemptCap: positive,
        control: array(names(['Stop']), { minItems: 1, maxItems: 1 }), branching: array(names(['Refine', 'Stop']), { minItems: 1, maxItems: 3 }),
        designResources: external('ResearchCost') }), { minItems: 3, maxItems: 3 }) }),
    ResearchExecutionRefusalFixture: record({ id: text, expected: ref('ResearchRefusal'),
      patch: array(record({ op: { const: 'replace' }, path: text, value: {} }), { minItems: 1, maxItems: 1 }) }),
    ResearchExecutionTopic: record({ topicId: external('ResearchId'), nativeStatus: names(['completed', 'failed']), state: external('ResearchState'),
      runIdentityId: external('Sha256'), workflowVersionId: external('Sha256'), executableRevision: external('Sha256'),
      contract: external('ResearchContract'), plan: external('ExperimentPlan'),
      attempts: array(external('StageAttempt'), { minItems: 1 }), branches: array(external('ExperimentBranch'), { minItems: 1 }),
      workspaces: array(external('WorkspaceManifest'), { minItems: 1 }), manifests: array(external('ExecutionManifest'), { minItems: 1 }),
      runs: array(external('ExperimentRun'), { minItems: 1 }), observations: array(external('MetricObservation')),
      artifacts: array(external('ResearchExecutionWireArtifact'), { minItems: 1 }),
      usage: ref('ResearchModelUsage'), cost: external('ResearchCost'), rerunCost: external('ResearchCost'), failures,
      interactions: array({ $ref: 'https://tangleai.dev/schemas/mas-runtime#/$defs/masInteraction' }),
      interventions: measurement.interventions, rerunRate: ref('ResearchScore'), registryAccuracy: ref('ResearchScore'),
      tracesCompleteness: ref('ResearchScore'), expectedRuns: positive, partialBranches: count, traceBytes: count }),
    ResearchExecutionRow: record({ id: names(['fixed-single-agent', 'fixed-plus-branching']), state: { const: 'measured' }, scope: { const: 'execution' },
      topics: array(ref('ResearchExecutionTopic'), { minItems: 3, maxItems: 3 }), cost: external('ResearchCost'), rerunCost: external('ResearchCost'), failures,
      interventions: measurement.interventions, rerunRate: ref('ResearchScore'), registryAccuracy: ref('ResearchScore'), tracesCompleteness: ref('ResearchScore') }),
    ResearchReasoningScript: record({ topicId: external('ResearchId'), licence: external('ResearchLicence'), model: { const: 'scripted-v1' },
      synthesis: external('SynthesisProposal'), hypotheses: external('HypothesisSetProposal'), design: external('ResearchDesignProposal'),
      participants: record(Object.fromEntries(['innovator', 'pragmatist', 'contrarian', 'screener'].map(name => [name, external('HypothesisSetProposal')]))),
      cases: array(record({ id: names(['infeasible-plan', 'confounded-plan', 'hidden-read', 'malformed']), proposal: { type: 'object' },
        expected: ref('ResearchRefusal') }), { minItems: 4, maxItems: 4 }),
      noveltyTranscripts: array(record({ method: { const: 'GET' }, url: text, body: { type: 'null' }, headers: { type: 'object', additionalProperties: { type: 'string' } },
        response: record({ status: { const: 200 }, headers: { type: 'object', additionalProperties: { type: 'string' } }, body: text }) },
      ['method', 'url', 'body', 'response']), { minItems: 4, maxItems: 4 }) }),
    ResearchModelUsage: record(Object.fromEntries(['roles', 'completion', 'normalization', 'repair', 'physical', 'promptTokens', 'completionTokens', 'unknownTokenRequests', 'traceBytes'].map(name => [name, count]))),
    ResearchReasoningTopic: record({ topicId: external('ResearchId'), ...reasoningMeasurements,
      nativeStatus: { const: 'waiting_for_input' }, state: external('ResearchState'), bindingId: external('Sha256'), runIdentityId: external('Sha256'),
      workflowVersionId: external('Sha256'), registryRevision: external('Sha256'), executableRevision: external('Sha256'),
      attempts: array(external('StageAttempt'), { minItems: 6, maxItems: 6 }), manifests: array(external('InputManifest'), { minItems: 6, maxItems: 6 }),
      artifacts: array(external('ArtifactAdmission'), { minItems: 1 }), interactions: array({ $ref: 'https://tangleai.dev/schemas/mas-runtime#/$defs/masInteraction' }),
      synthesis: external('Synthesis'), hypotheses: array(external('ResearchHypothesis'), { minItems: 2 }), hypothesisSet: external('HypothesisSet'),
      contract: external('ResearchContract'), plan: external('ExperimentPlan'), novelty: external('NoveltyReport'),
      visibleCardIds: array(external('ResearchId'), { minItems: 1, uniqueItems: true }), availableCards: positive,
      requests: array(record({ role: text, phase: names(['completion', 'normalization', 'repair']), sha256: external('Sha256'), hiddenPaths: count }), { minItems: 1 }),
      executedPacks: array(text, { minItems: 1, uniqueItems: true }),
      probes: array(record({ id: text, kind: { const: 'independent-verifier' }, calls: { const: 0 }, expected: ref('ResearchRefusal'),
        observed: nullable(ref('ResearchRefusal')), matched: { type: 'boolean' } }), { minItems: 4, maxItems: 4 }),
      discoveryReplay: record({ requests: count, misses: count, networkCalls: { const: 0 } }),
      noveltyReplay: record({ requests: count, misses: count, networkCalls: { const: 0 } }),
    }),
    ResearchReasoningRow: record({ id: names(['fixed-single-agent', 'fixed-plus-debate']), state: { const: 'measured' }, scope: { const: 'pre-execution' },
      ...reasoningMeasurements, topics: array(ref('ResearchReasoningTopic'), { minItems: 3, maxItems: 3 }) }),
    ResearchDiscoveryMeasurement: record({ topicId: external('ResearchId'), receipt: external('DiscoveryReceipt'),
      literature: array(external('LiteratureRecord')), screening: array(external('ScreeningDecision')),
      acquisitions: array(external('SourceAcquisition')), evidence: array(external('EvidenceCard')),
      literatureRecall: ref('ResearchScore'), literaturePrecision: ref('ResearchScore'), absentRelevant: count,
      providerOutcomes: record({ complete: count, incomplete: count, refused: count, attempts: count, counts: external('DiscoveryProviderCounts') }),
      replay: record({ requests: count, misses: count, networkCalls: count }),
      cards: record({ total: count, resolvable: count, unresolvable: count }) }),
    ResearchWorkflowMeasurement: record({ kind: names(['scientific', 'complete-path-control']),
      runId: external('ResearchId'), bindingId: external('Sha256'), runIdentityId: external('Sha256'),
      workflowVersionId: external('Sha256'), registryRevision: external('Sha256'), executableRevision: external('Sha256'),
      nativeStatus: { const: 'completed' }, state: external('ResearchState'),
      attempts: array(external('StageAttempt'), { minItems: 1 }), manifests: array(external('InputManifest'), { minItems: 1 }),
      artifacts: array(external('ArtifactAdmission'), { minItems: 1 }),
      interactions: array({ $ref: 'https://tangleai.dev/schemas/mas-runtime#/$defs/masInteraction' }),
      spend: record({ turns: count, tokens: count, ms: number }), providerCalls: { const: 0 },
      taskExecutions: array(text), duplicateResponses: count, gateBehaviour: ref('ResearchScore') }),
    ResearchLifecycleFixture: record({ id: { const: 'research-lifecycle-v1' }, project: external('ResearchProject'),
      contract: external('ResearchContract'), plan: external('ExperimentPlan'),
      workflow: { $ref: 'https://tangleai.dev/schemas/mas-workflow' }, registry: { $ref: 'https://tangleai.dev/schemas/mas-registry' },
      catalog: record({ revision: external('Sha256'), profiles: array(text), tools: array(text), contexts: array(text),
        limits: { $ref: 'https://tangleai.dev/schemas/mas-workflow#/$defs/workflowLimits' } }),
      executableRevision: external('Sha256'), projectionJson: text,
      cases: array(record({ id: external('ResearchId'), action: names(['run', 'stale-approval', 'overdue-pause', 'overdue-stop']),
        decisions: array(array(names(['Proceed', 'Refine', 'Pivot', 'Stop']))),
        responses: array(names(['approve', 'reject', 'stop'])),
        expected: record({ nativeStatus: names(['completed', 'waiting_for_input', 'failed']), lifecycleStatus: external('ResearchLifecycle'),
          executions: count, approvals: count }) }), { minItems: 1 }) }),
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
      analysis: record({ registration: text }),
      topics: array(record({ id: external('ResearchId'), path: text }), { minItems: 3, maxItems: 3 }),
      literature: record({ records: text, gold: text }),
      programs: array(record({ id: text, source: text, sha256: external('Sha256'), licence: external('ResearchLicence') }), { minItems: 9, maxItems: 9 }),
      datasets: array(text, { minItems: 2, maxItems: 2, uniqueItems: true }),
      bundles: array(record({ id: external('ResearchId'), path: text, expected: ref('ResearchRefusal') }), { minItems: 21, maxItems: 21 }),
      execution: record({ registration: text, refusals: array(record({ id: text, path: text, expected: ref('ResearchRefusal') }), { minItems: 5, maxItems: 5 }) }),
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
    { $and: ['$.gate.registration', '$.gate.oracle', '$.gate.bundles', '$.gate.analysis'] }] }] },
};
