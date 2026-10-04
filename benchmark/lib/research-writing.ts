/** Writing measurements retain native admissions; gold is used only after execution. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { readFile } from 'node:fs/promises';
import { compileMasRuntime } from '@tangleai/mas';
import { openTangleDb, createMasStore, createResearchStore, createMasSegmentDriver } from '@tangleai/store';
import { researchValue, researchArtifacts, researchRevisionOf, createResearchBinding, prepareResearchWorkflow, initialResearchFrame,
  planProjectCreate, createDiscoveryStageTools, createResearchTaskHandlers, createResearchHostBindings, createResearchExecutionTools,
  createResearchAnalysisTools, createFixtureExecutor, buildClaimLedger, writeResearchDraft, verifyResearchDraft, researchWritingEvidenceHash,
  researchDisclosure, renderMarkdownBundle, rerunBundle, renderLatexBundle, researchWritingRole, researchFileHash,
  type ResearchWritingInputs, type ResearchExportSource, type ResearchManifest, type ResearchCost, type ResearchProject,
  type ResearchFixtureProgram, type ResearchEvaluator, type ResearchAnalysisRuntimePolicy, type ResearchClaimLedger,
  type Draft, type Review, type ResearchRoleIdentity } from '@tangleai/research';
import { researchExampleIdentity, researchExampleTools, researchExampleLimits } from '../../examples/research.ts';
import { createResearchDiscoveryFixture, researchDiscoveryConfiguration } from './research-discovery.ts';
import { researchExecutionFixture } from './research-execution-fixture.ts';
import { researchDecisionResponse, type runResearchDecisionFixture } from './research-decisions.ts';
import { runResearchReasoningFixture } from './research-reasoning.ts';
import { researchWritingResponse } from './research-writing-fixture.ts';
import { researchPairedStatistic } from './research-statistics.ts';
import { researchScore } from './research-oracle.ts';
import { requireResearchShape } from './research-validation.ts';
import { RESEARCH_WRITING_DIMENSIONS } from './research-schema.ts';
import { researchBytesSha256, type LoadedResearchFixture } from './research-fixture.ts';
import type { ResearchFixtureTopic, ResearchWritingRegistration, ResearchSentenceRegistration, ResearchWritingTopic,
  ResearchWritingRow, ResearchWritingControl, ResearchWritingProbe, ResearchReasoningScript, ResearchDecisionRegistration } from './research.types.ts';

const zero = { calls: 0, tokens: 0, ms: 0, physical: 0 };
const bytes = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value));
const same = (left: unknown, right: unknown) => canonicalizeJson(left) === canonicalizeJson(right);
const total = (rows: ResearchCost[]): ResearchCost => rows.reduce((sum, row) => ({ calls: sum.calls + row.calls,
  tokens: sum.tokens + row.tokens, ms: sum.ms + row.ms, physical: sum.physical + row.physical }), { ...zero });
const read = <T>(loaded: LoadedResearchFixture, path: string, definition: string): T =>
  requireResearchShape<T>(definition, JSON.parse(new TextDecoder().decode(loaded.files.get(path)!)));
export const readResearchWritingRegistration = (loaded: LoadedResearchFixture) =>
  read<ResearchWritingRegistration>(loaded, loaded.manifest.writing.registration, 'ResearchWritingRegistration');
const templateWriter = async (): Promise<ResearchRoleIdentity> => ({ roleId: 'research-template-writer',
  promptRevision: await canonicalSha256({ renderer: 'registered-claim-template', sections: 6 }), modelIdentity: 'no-model' });

/** The host compiles TeX in its separate qualification tier; deterministic reports do not depend on installed binaries. */
export async function researchWritingBundle(input: ResearchWritingInputs, provenance: ResearchExportSource['provenance'],
  identity: string, retained?: { ledger: ResearchClaimLedger; draft: Draft; reviews: Review[] }) {
  const ledger = retained?.ledger ?? researchValue(await buildClaimLedger(input));
  const draft = retained?.draft ?? researchValue(await writeResearchDraft(ledger, await templateWriter(), { mode: 'template' }));
  const verification = researchValue(await verifyResearchDraft(input, ledger, draft));
  const body: Omit<ResearchExportSource, 'disclosure'> = { inputs: input, ledger, draft, verification, reviews: retained?.reviews ?? [], provenance };
  let scientific: ResearchManifest | null = null;
  if (input.contract && input.plan && input.analysis) {
    const data = input.contract.datasets;
    const programSourceHash = provenance.tools.find(row => row.name === 'program-source')?.version;
    if (!programSourceHash || !/^[0-9a-f]{64}$/.test(programSourceHash)) throw Error('Scientific writing requires its measured program source identity.');
    const manifest: Omit<ResearchManifest, 'manifestHash'> = { projectId: input.projectId, contractHash: input.contract.contractHash,
      planHash: input.plan.planHash, promptRevision: researchArtifacts.revision, reviewedEvidenceHash: await researchWritingEvidenceHash(body),
      runIdentityId: identity, environment: { executor: 'fixture', version: '1', programSourceHash },
      inputs: input.plan.inputPaths.map((path, index) => ({ path, sha256: data[index].sha256 })), runIds: input.analysis.runIds,
      observationIds: input.observations.map(row => row.id), selectionRule: input.contract.selectionRule,
      baselineSources: input.contract.requiredBaselines.map(row => row.source),
      metricOrigin: { evaluatorId: input.plan.evaluator.id, evaluatorVersion: input.plan.evaluator.version },
      searchedLiterature: input.literature.map(row => row.id), frozenBeforeResults: true };
    scientific = { ...manifest, manifestHash: await canonicalSha256(manifest) };
  }
  const source = { ...body, disclosure: researchDisclosure(body, scientific) };
  const bundle = researchValue(await renderMarkdownBundle(source, scientific)), rerun = researchValue(await rerunBundle(bundle.manifest));
  if (!same(bundle.files, rerun.files)) throw Error('Writing bundle failed exact file reconstruction.');
  const tex = researchValue(await renderLatexBundle(bundle.manifest));
  const { id: _receiptId, ...receipt } = bundle.receipt;
  receipt.latex = { state: 'skipped', reason: 'Deterministic report emits TeX; host compilation is measured separately by the LaTeX qualification tier.',
    files: await Promise.all(Object.entries(tex.files).sort(([a], [b]) => a.localeCompare(b)).map(async ([path, text]) => ({ path, sha256: await researchFileHash(text) }))) };
  return { ...bundle, receipt: { id: 'export-receipt-' + await researchRevisionOf(receipt), ...receipt } };
}

/** This baseline stops after native discovery. No experiment or result cost is hidden outside its receipt. */
export async function runResearchRetrievalWriting(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic) {
  const identity = await researchExampleIdentity(), config = await researchDiscoveryConfiguration(topic);
  const binding = await createResearchBinding(topic.contract, { identity, promptRevision: researchArtifacts.revision,
    evaluator: topic.plan.evaluator, reservation: zero, toolVersions: [{ name: 'scholarly-discovery', version: config.revision }] });
  const limits = { ...researchExampleLimits, ...loaded.manifest.caps };
  const prepared = await prepareResearchWorkflow(topic.contract, { binding, limits, profile: 'research-scripted' });
  const project: ResearchProject = { id: topic.contract.projectId, topic: topic.title, question: topic.title, domainProfile: 'computational',
    owner: 'benchmark', mode: 'gate-only', safetyClass: 'computational', status: 'CREATED', budget: { ...zero, calls: limits.calls,
      tokens: limits.tokens, ms: limits.ms, physical: limits.calls }, createdAt: '2026-01-01T00:00:00.000Z' };
  const now = () => project.createdAt, db = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } });
  let discovery: Awaited<ReturnType<typeof createResearchDiscoveryFixture>> | undefined;
  try {
    const masStore = createMasStore(db, { now }), store = createResearchStore(db, { now });
    discovery = await createResearchDiscoveryFixture(loaded, topic, db, async () => {
      if (!researchValue(await store.snapshot(project.id))?.records.some(row => row.kind === 'QueryPlan' && row.id === config.plan.id))
        throw Error('Retrieval writing dispatched before native query-plan admission.');
    });
    const tools = await createDiscoveryStageTools(researchExampleTools({ binding, contract: topic.contract, plan: topic.plan, masStore }), discovery.options);
    const compiled = compileMasRuntime(prepared.validated, prepared.plan, prepared.snapshot, createResearchHostBindings({ masStore,
      researchStore: store, taskHandlers: createResearchTaskHandlers(store, tools), prepared, now, clock: () => 0 }));
    if (!compiled.valid) throw Error(JSON.stringify(compiled.issues));
    researchValue(await store.createProject(researchValue(planProjectCreate(project))));
    const run = await masStore.createRun({ runId: project.id, workflowId: prepared.workflow.workflowId, workflowVersionId: prepared.workflow.versionId,
      registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision, configRegistryRevision: prepared.catalog.revision,
      profile: 'research-scripted', input: { frame: await initialResearchFrame(project, topic.plan, binding) }, limits });
    if (!run.ok) throw Error(JSON.stringify(run));
    const driver = createMasSegmentDriver(db, masStore, { owner: 'research-writing-retrieval', leaseMs: 1000 }); await driver.enqueue(run.value);
    if (!await driver.drive(prepared.plan.executableRevision, compiled.value.executeSegment, new AbortController().signal)) throw Error('Retrieval segment was not queued.');
    const trace = (await masStore.readTrace(project.id))!, snapshot = researchValue(await store.snapshot(project.id))!;
    if (trace.run.status !== 'waiting_for_input' || snapshot.state.status !== 'LITERATURE_GATE'
      || snapshot.records.some(row => ['ResearchHypothesis', 'ExperimentRun', 'MetricObservation', 'ResearchDecision'].includes(row.kind)))
      throw Error('Retrieval-only writing crossed its native literature boundary: ' + JSON.stringify(trace.run.failure));
    const input: ResearchWritingInputs = { projectId: project.id, scope: 'retrieval-control', contract: null, plan: null, analysis: null, decision: null,
      cards: snapshot.records.filter(row => row.kind === 'EvidenceCard').map(row => row.value),
      literature: snapshot.records.filter(row => row.kind === 'LiteratureRecord').map(row => row.value), observations: [] };
    const attempts = snapshot.attempts.map(row => row.attempt), cost = total(attempts.map(row => row.spend));
    if (cost.calls !== 0 || trace.run.budget.spent.turns !== 0 || trace.attempts.some(row => row.kind === 'agent')) throw Error('Retrieval baseline unexpectedly called a model.');
    const bundle = await researchWritingBundle(input, { runGraph: canonicalizeJson(prepared.mermaid), attempts, selection: null,
      prompts: [await templateWriter()], tools: binding.toolVersions, code: ['benchmark/lib/research-writing.ts'], data: [], seeds: [],
      environments: ['native-discovery-replay'], interventions: [], cost }, identity.identityId);
    return { bundle, identity };
  } finally { await discovery?.close(); await db.close(); }
}

export async function researchStoppedWriting(result: Awaited<ReturnType<typeof runResearchDecisionFixture>>) {
  const scientific = result.execution!, decision = scientific.decisions.find(row => row.id === scientific.finalDecisionId)!,
    analysis = scientific.analyses.find(row => row.id === scientific.finalAnalysisId)!, evidence = result.writingEvidence;
  const input: ResearchWritingInputs = { projectId: scientific.contract.projectId, scope: 'stopped-run-audit', contract: scientific.contract,
    plan: scientific.plan, decision, analysis, cards: evidence.cards, literature: evidence.literature,
    observations: scientific.observations.filter(row => analysis.observationIds.includes(row.id)) };
  return researchWritingBundle(input, { runGraph: evidence.runGraph, attempts: scientific.attempts,
    selection: scientific.selections.find(row => row.id === decision.details!.selectionId)!, prompts: [await templateWriter()],
    tools: [{ name: 'research-catalog', version: researchArtifacts.revision }, { name: 'program-source', version: evidence.programSourceHash }],
    code: scientific.plan.conditions.map(row => row.programId),
    data: scientific.contract.datasets.map(row => row.id), seeds: scientific.contract.replicatePolicy.seeds,
    environments: [...new Set(scientific.manifests.map(row => row.imageDigest))], interventions: evidence.interventions, cost: scientific.cost }, result.identity.identityId);
}

export async function probeResearchWriting(loaded: LoadedResearchFixture, registration: ResearchWritingRegistration, bundle: Awaited<ReturnType<typeof researchWritingBundle>>) {
  const probes: ResearchWritingProbe[] = [];
  for (const probe of registration.refusals) {
    if (!loaded.files.has(probe.source)) throw Error('Writing refusal source is absent from the licensed registration.');
    const { inputs, ledger: original, draft: originalDraft } = bundle.manifest.source, claims = structuredClone(original.claims);
    const target = claims.find(row => probe.id === 'wrong-number' ? row.kind === 'metric' : row.kind === 'literature');
    if (!target) continue; // The retrieval-only row cannot verify a number it never claims.
    target.section = probe.id === 'wrong-number' ? 'results' : 'methods';
    if (probe.id === 'hallucinated-citation') target.literatureIds = ['invented-source'];
    else if (probe.id === 'missing-citation') target.proof!.citation = null;
    else if (probe.id === 'inflated-claim') target.strength = 'causal';
    else target.metricBinding!.value += 1;
    const ledger = researchValue(await buildClaimLedger(inputs, claims)), draft = researchValue(await writeResearchDraft(ledger, originalDraft.writer, { mode: 'template' }));
    const verification = researchValue(await verifyResearchDraft(inputs, ledger, draft)), actual = verification.claims.find(row => row.claimId === target.id)!;
    const observedCode = actual.issues[0]?.code ?? null;
    probes.push({ id: probe.id, expectedCode: probe.expectedCode, observedCode, state: actual.status,
      matched: verification.state === 'refused' && actual.status === probe.expectedState && observedCode === probe.expectedCode });
  }
  return probes;
}

export async function scoreResearchWriting(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic, registration: ResearchWritingRegistration,
  bundle: Awaited<ReturnType<typeof researchWritingBundle>>, terminal: ResearchWritingTopic['terminal']): Promise<ResearchWritingTopic> {
  const path = loaded.manifest.writing.claims.find(row => row.topicId === topic.id)!.path;
  const declared = read<ResearchSentenceRegistration>(loaded, path, 'ResearchSentenceRegistration'), source = bundle.manifest.source;
  if (declared.topicId !== topic.id) throw Error('Sentence-level registration names another topic.');
  const required = declared.required.map(expected => {
    const originalRecord = loaded.literature.find(row => row.id === expected.literatureId);
    const claim = source.ledger.claims.find(claim => expected.observationCondition !== null
      ? claim.metricBinding?.condition === expected.observationCondition
      : claim.proof?.quote?.includes(expected.text) && source.inputs.literature.some(record => claim.literatureIds.includes(record.id)
        && Object.entries(originalRecord?.canonicalIds ?? {}).some(([key, id]) => id !== null && id !== ''
          && Object.entries(record.canonicalIds).some(([actualKey, actual]) => actualKey === key && same(actual, id)))));
    const actualState = claim ? source.verification.claims.find(row => row.claimId === claim.id)!.status : 'missing' as const;
    return { id: expected.id, claimId: claim?.id ?? null, expectedState: expected.expectedState, actualState };
  });
  const scores = (filter: (expected: ResearchSentenceRegistration['required'][number]) => boolean) => {
    const rows = required.filter((_row, index) => filter(declared.required[index]));
    return researchScore(rows.filter(row => row.actualState === row.expectedState).length, rows.length);
  };
  const probes = await probeResearchWriting(loaded, registration, bundle), actions = source.provenance.interventions;
  return requireResearchShape<ResearchWritingTopic>('ResearchWritingTopic', { topicId: topic.id, scope: source.inputs.scope, terminal,
    bundle: bundle.manifest, receipt: bundle.receipt, required, probes, citationIdentity: scores(row => row.literatureId !== null),
    claimSupport: scores(() => true), numericMapping: scores(row => row.observationCondition !== null),
    claimValidity: researchScore(source.verification.claims.filter(row => row.status === 'supported').length, source.ledger.claims.length),
    bundleRerun: researchScore(1, 1), refusalConformance: researchScore(probes.filter(row => row.matched).length, probes.length),
    cost: source.provenance.cost, interventions: { total: actions.length, approvals: actions.filter(row => row.action === 'approve').length,
      substantive: actions.filter(row => row.substantive).length },
    failures: { program: source.provenance.attempts.filter(row => row.stage === 'EXECUTE' && row.stopReason !== 'completed').length,
      verification: probes.filter(row => !row.matched).length, leakage: 0, confound: 0, budget: 0, provider: 0,
      unsupported: required.filter(row => row.actualState !== 'supported').length },
    resultClaims: source.ledger.claims.filter(row => row.kind === 'metric').length });
}
export function aggregateResearchWriting(id: ResearchWritingRow['id'], topics: ResearchWritingTopic[]): ResearchWritingRow {
  const scores = Object.fromEntries(RESEARCH_WRITING_DIMENSIONS.map(name => [name, researchScore(topics.reduce((sum, row) => sum + row[name].passed, 0),
    topics.reduce((sum, row) => sum + row[name].total, 0))]));
  const sum = <K extends 'interventions' | 'failures'>(key: K) => Object.fromEntries(Object.keys(topics[0][key]).map(field => [field,
    topics.reduce((n, row) => n + Object.entries(row[key]).find(([name]) => name === field)![1], 0)]));
  return requireResearchShape<ResearchWritingRow>('ResearchWritingRow', { id, state: 'measured', scope: 'writing', topics, ...scores,
    cost: total(topics.map(row => row.cost)), interventions: sum('interventions'), failures: sum('failures') });
}

export async function runResearchWritingControl(loaded: LoadedResearchFixture, registration: ResearchWritingRegistration) {
  const control = registration.control, topic = read<ResearchFixtureTopic>(loaded, control.topicPath, 'ResearchFixtureTopic');
  const script = read<ResearchReasoningScript>(loaded, control.scriptPath, 'ResearchReasoningScript');
  const execution = await researchExecutionFixture(loaded, topic);
  const programSourceHash = researchBytesSha256(await readFile(new URL('./research-writing.ts', import.meta.url)));
  const policy = { ...execution.policy, imageDigest: 'sha256:' + await canonicalSha256({ control, programSourceHash }), dependencyLockHash: await canonicalSha256({ control, script }) };
  const programs: Record<string, ResearchFixtureProgram> = Object.fromEntries((['baseline', 'candidate'] as const).map(condition => [control.programIds[condition], async ({ seed }) => {
    const index = topic.contract.replicatePolicy.seeds.indexOf(seed);
    if (index < 0) throw Error('Writing control cannot execute an unregistered seed.');
    return { kind: 'clusters', centroids: [[control[condition][index]]], assignments: [0], iterations: 1 };
  }]));
  const evaluator: ResearchEvaluator<null> = { ...control.evaluator, evaluate: async ({ rawOutput }) => {
    if (rawOutput.kind !== 'clusters' || rawOutput.centroids.length !== 1 || rawOutput.centroids[0].length !== 1)
      return { valid: false, issues: [{ code: 'TRSH1002', path: '/rawOutput', detail: 'Writing coordinate control requires its exact raw output shape.' }] };
    return { valid: true, value: [{ metric: control.metric.id, value: rawOutput.centroids[0][0], unit: control.metric.unit }] };
  } };
  const analysisRegistration = read<ResearchDecisionRegistration>(loaded, loaded.manifest.analysis.registration, 'ResearchDecisionRegistration');
  const analysisPolicy: ResearchAnalysisRuntimePolicy = { analystIdentityId: analysisRegistration.analystIdentityId,
    reviewerIdentityId: analysisRegistration.reviewerIdentityId, statisticId: analysisRegistration.statisticId };
  const executor = createFixtureExecutor(programs, { now: () => 0 });
  return runResearchReasoningFixture<ResearchWritingControl>(loaded, topic, 'single-agent', { policy, revision: await canonicalSha256(registration), script, decisions: [['Proceed']],
    analysis: analysisPolicy, reviewResponse: researchDecisionResponse, writing: { policy: control.policy, limits: control.limits,
      reservation: control.reservation, response: researchWritingResponse },
    async tools(base, store) {
      const execute = base.execute, verify = base.verify;
      const bounded = await createResearchExecutionTools({ ...base, async execute(operation, access) {
        const result = await execute(operation, access);
        if (operation.stage === 'create') result.artifacts.push({ bytes: loaded.files.get(topic.datasetPath)!, mediaType: 'application/json' });
        return result;
      }, verify(operation, result, access) { return verify(operation, operation.stage === 'create' ? { ...result, artifacts: result.artifacts.slice(0, 1) } : result, access); } },
      { researchStore: store, policy, executor, evaluators: [evaluator], hiddenLabels: null, evaluatorBytes: bytes(control.evaluator) });
      return createResearchAnalysisTools(bounded, { researchStore: store, policy: analysisPolicy, statistic: researchPairedStatistic });
    },
    async collect(store, masStore, reasoning, native) {
      const snapshot = researchValue(await store.snapshot(topic.contract.projectId))!, trace = (await masStore.readTrace(topic.contract.projectId))!;
      if (snapshot.state.status !== 'COMPLETE' || trace.run.status !== 'completed') throw Error('Writing control did not complete its native workflow.');
      const contract = snapshot.records.find(row => row.kind === 'ResearchContract' && row.value.contractHash === snapshot.state.contractHash)!.value as ResearchWritingInputs['contract'];
      const plan = snapshot.records.find(row => row.kind === 'ExperimentPlan' && row.value.planHash === snapshot.state.planHash)!.value as ResearchWritingInputs['plan'];
      const decision = snapshot.records.filter(row => row.kind === 'ResearchDecision').map(row => row.value).at(-1)!;
      const analysis = snapshot.records.filter(row => row.kind === 'Analysis').map(row => row.value).find(row => row.id === decision.details!.analysisId)!;
      const input: ResearchWritingInputs = { projectId: topic.contract.projectId, scope: 'research-draft', contract, plan, decision, analysis,
        cards: snapshot.records.filter(row => row.kind === 'EvidenceCard').map(row => row.value),
        literature: snapshot.records.filter(row => row.kind === 'LiteratureRecord').map(row => row.value),
        observations: snapshot.records.filter(row => row.kind === 'MetricObservation').map(row => row.value).filter(row => analysis.observationIds.includes(row.id)) };
      const draft = snapshot.records.filter(row => row.kind === 'Draft').map(row => row.value).at(-1)!,
        ledger = snapshot.records.filter(row => row.kind === 'ResearchClaimLedger').map(row => row.value).find(row => row.id === draft.ledgerId)!;
      const reviews = snapshot.records.filter(row => row.kind === 'Review').map(row => row.value).filter(row => row.draftId === draft.id);
      const attempts = snapshot.attempts.map(row => row.attempt), cost = total(attempts.map(row => row.spend)), traceBytes = bytes(trace).length;
      const runs = snapshot.records.filter(row => row.kind === 'ExperimentRun');
      if (cost.calls !== native.requests.length || cost.calls !== trace.run.budget.spent.turns || cost.tokens !== trace.run.budget.spent.tokens
        || cost.physical !== cost.calls + runs.length || traceBytes > control.limits.traceBytes) throw Error('Writing control cost or trace bound does not reconcile.');
      const writingPolicy = { ...control.policy, modelIdentity: reasoning.runIdentityId };
      const bundle = await researchWritingBundle(input, { runGraph: native.runGraph, attempts,
        selection: snapshot.records.filter(row => row.kind === 'ResearchBranchSelection').map(row => row.value).find(row => row.id === decision.details!.selectionId)!,
        prompts: [draft.writer, researchWritingRole('critic-peer-review-review', writingPolicy), researchWritingRole('judge-red-team-resilience', writingPolicy)],
        tools: [{ name: 'research-catalog', version: researchArtifacts.revision }, { name: 'program-source', version: programSourceHash }],
        code: [control.source, ...Object.values(control.programIds)],
        data: contract!.datasets.map(row => row.id), seeds: contract!.replicatePolicy.seeds, environments: [policy.imageDigest],
        interventions: snapshot.records.filter(row => row.kind === 'Intervention').map(row => row.value), cost }, reasoning.runIdentityId, { ledger, draft, reviews });
      return requireResearchShape<ResearchWritingControl>('ResearchWritingControl', { id: control.id, nativeStatus: trace.run.status, state: snapshot.state,
        runIdentityId: reasoning.runIdentityId, workflowVersionId: reasoning.workflowVersionId, traceBytes, bundle: bundle.manifest, receipt: bundle.receipt,
        requests: native.requests, interactions: trace.interactions, writerCalls: attempts.filter(row => row.stage === 'WRITE').reduce((n, row) => n + row.spend.calls, 0),
        reviewCalls: attempts.filter(row => row.stage === 'VERIFY').reduce((n, row) => n + row.spend.calls, 0), cost });
    },
  });
}
