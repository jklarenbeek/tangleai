/** Both domain instruments use the same native lifecycle, executor and observation registry. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { compileMasRuntime } from '@tangleai/mas';
import { createOutcomeService, createMemoryOutcomeStore } from '@tangleai/outcomes';
import { composeSkillSystem, type SkillSnapshot } from '@tangleai/trace2skill';
import { openTangleDb, createMasStore, createResearchStore, createMasSegmentDriver, ensurePendingMasSegments } from '@tangleai/store';
import { researchValue, researchRevisionOf, immutableResearchJson, createResearchBinding, researchExecutionRevisionOf,
  planProjectCreate, initialResearchFrame, prepareResearchWorkflow, createResearchTaskHandlers, createResearchHostBindings,
  createResearchExecutionTools, createEvaluationRegistry, createResearchWorkspace, injectLessons, researchLessonOutcomeScope,
  type BoundDomainProfile, type ResearchExecutionPolicy, type ResearchExecutor, type ResearchContract, type ExperimentPlan,
  type ResearchProject, type ResearchWorkflowFrame, type ResearchStageResult, type ResearchLessonScope,
  type ExperimentRun, type MetricObservation } from '@tangleai/research';
import { researchExampleIdentity, researchExampleTools, researchExampleLimits } from '../../examples/research.ts';
import type { DomainLifecycleReceipt, DomainTopicMeasurement } from './research-domains.types.ts';

export const DOMAIN_BUDGET = Object.freeze({ calls: 100, tokens: 100000, ms: 600000, physical: 128 });
type Summary = Pick<DomainTopicMeasurement, 'result' | 'tabular'>;
export interface DomainRuntimeInput<Labels> {
  topic: { id: string; title: string; contract: ResearchContract; plan: ExperimentPlan };
  topicHash: string;
  domain: BoundDomainProfile<Labels>;
  scope: ResearchLessonScope;
  policy: ResearchExecutionPolicy;
  executor: ResearchExecutor;
  hiddenLabels: Labels;
  evaluatorBytes: Uint8Array;
  files: ReadonlyMap<string, Uint8Array>;
  summarize(runs: ExperimentRun[], observations: MetricObservation[]): Summary;
}
const bytes = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value));
export async function runResearchDomainLifecycle<Labels>(input: DomainRuntimeInput<Labels>, procedure?: SkillSnapshot): Promise<DomainTopicMeasurement> {
  const { topic, domain, scope, policy } = input, { contract, plan } = topic;
  researchValue(domain.validatePlan(contract, plan));
  const identity = await researchExampleIdentity(), now = () => '2026-01-01T00:00:00.000Z';
  const project: ResearchProject = { id: contract.projectId, topic: topic.title, domainProfile: domain.profile.id,
    question: contract.hypothesisSpace.join('; '), owner: 'domain-instrument', mode: 'gate-only', safetyClass: 'computational',
    status: 'CREATED', budget: DOMAIN_BUDGET, createdAt: now(), lessonContext: { topicId: topic.id, taskFamily: scope.taskFamily,
      input: { topicHash: input.topicHash, contractHash: contract.contractHash, planHash: plan.planHash } } };
  const db = await openTangleDb({ jobs: { now: () => 1000000, random: () => .5 } });
  try {
    const masStore = createMasStore(db, { now }), store = createResearchStore(db, { now });
    researchValue(await store.createProject(researchValue(planProjectCreate(project))));
    let lessons;
    if (procedure) {
      researchValue(await store.lessons.putProcedure(procedure));
      const revision = await researchRevisionOf({ owner: 'domain-no-active-head-control' });
      const outcomes = await createOutcomeService({ store: createMemoryOutcomeStore(), scope: researchLessonOutcomeScope(scope), adapters: [],
        principal: { id: 'domain-reader', authorityId: revision, approve: false, reconcile: false },
        resolver: { revision, async resolve() { throw Error('The no-active-head control must not resolve evidence.'); } },
        authorizeMemoryIds: async ids => ({ allowed: ids.length === 0, authorizationId: revision }) });
      const captured = researchValue(await injectLessons({ store, outcomes, profile: scope, runId: project.id, baseBundleHash: procedure.bundle.id }));
      if (captured.state !== 'off' || captured.refused.OUTC1004 !== 1 || !captured.procedure) throw Error('Baseline procedure capture did not retain its native no-head refusal.');
      lessons = captured.procedure;
      const root = composeSkillSystem('', lessons.snapshot);
      if (!root.valid || !root.value) throw Error('The native procedure consumer refused its retained root.');
    }
    const binding = await createResearchBinding(contract, { identity,
      promptRevision: await researchRevisionOf(domain.prompts.map(row => ({ id: row.id, revision: row.revision }))),
      toolVersions: [{ name: 'research-execution', version: await researchExecutionRevisionOf(policy) }],
      evaluator: plan.evaluator, reservation: { calls: 0, tokens: 0, ms: 10000, physical: plan.conditions.length * contract.replicatePolicy.seeds.length },
      domain: domain.manifest, ...(lessons ? { lessonProcedure: { bundleHash: lessons.snapshot.bundle.id, injection: lessons.injection } } : {}) });
    const prepared = await prepareResearchWorkflow(contract, { binding, profile: 'research-scripted', limits: researchExampleLimits, execution: policy,
      ...(lessons ? { lessons } : {}) });
    const base = researchExampleTools({ binding, contract, plan, masStore });
    const science = async () => {
      const runs = researchValue(await store.listRecords(project.id, 'ExperimentRun')).sort((a, b) => a.condition.localeCompare(b.condition) || a.seed - b.seed);
      const observations = researchValue(await store.listRecords(project.id, 'MetricObservation')).sort((a, b) => a.condition.localeCompare(b.condition) || a.seed - b.seed || a.metric.localeCompare(b.metric));
      const expected = plan.conditions.length * contract.replicatePolicy.seeds.length;
      if (runs.length !== expected || observations.length !== expected * contract.metrics.length || runs.some(row => row.status !== 'ok'))
        throw Error('Domain lifecycle did not retain every registered seed and observation.');
      return { runs, observations, summary: input.summarize(runs, observations) };
    };
    const execute = base.execute, verify = base.verify;
    const tools = await createResearchExecutionTools({ ...base, domain,
      async execute(op, access): Promise<ResearchStageResult> {
        if (['analyze', 'decide', 'write', 'verify'].includes(op.stage)) {
          const actual = await science(), decision = actual.summary.result === 'improvement' ? 'Proceed' as const : 'Stop' as const;
          return { artifacts: [{ mediaType: 'application/vnd.tangleai.domain-results+json', bytes: bytes({ stage: op.stage, ...actual }) }],
            records: op.stage === 'decide' ? [{ kind: 'ResearchDecision', value: { id: topic.id + '-decision', projectId: project.id,
              contractHash: contract.contractHash, kind: decision, reason: 'Retain the registered result: ' + actual.summary.result,
              observationIds: actual.observations.map(row => row.id), exploratory: false } }] : [],
            spend: { calls: 0, tokens: 0, physical: 0, ms: 0 }, ...(op.stage === 'decide' ? { decision } : {}) };
        }
        const result = await execute(op, access);
        if (op.stage === 'create') for (const path of plan.inputPaths) {
          const content = input.files.get(path); if (!content) throw Error('Missing pinned domain input: ' + path);
          result.artifacts.push({ bytes: new Uint8Array(content), mediaType: 'application/octet-stream' });
        }
        return result;
      },
      async verify(op, result, access) {
        if (['analyze', 'decide', 'write', 'verify'].includes(op.stage)) {
          const expected = { stage: op.stage, ...await science() };
          return result.artifacts.length === 1 && equalsJson(JSON.parse(new TextDecoder().decode(result.artifacts[0].bytes)), expected)
            ? { valid: true, value: null } : { valid: false, issues: [{ code: 'TRSH1002', path: '/domain/results', detail: 'Independent registered result reproduction differs.' }] };
        }
        return verify(op, op.stage === 'create' ? { ...result, artifacts: result.artifacts.slice(0, 1) } : result, access);
      },
    }, { researchStore: store, policy, executor: input.executor, evaluators: [domain.evaluator], hiddenLabels: input.hiddenLabels, evaluatorBytes: input.evaluatorBytes });
    const handlers = createResearchTaskHandlers(store, tools);
    const runtime = compileMasRuntime(prepared.validated, prepared.plan, prepared.snapshot,
      createResearchHostBindings({ masStore, researchStore: store, taskHandlers: handlers, prepared, now, clock: () => 0,
        clientFor: () => ({ endpoint: { provider: 'scripted' }, async complete() { throw Error('A deterministic domain lifecycle must never dispatch a model.'); } }) }));
    if (!runtime.valid) throw Error(JSON.stringify(runtime.issues));
    const frame = await initialResearchFrame(project, plan, binding);
    const run = await masStore.createRun({ runId: project.id, workflowId: prepared.workflow.workflowId, workflowVersionId: prepared.workflow.versionId,
      registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision, configRegistryRevision: prepared.catalog.revision,
      profile: 'research-scripted', input: { frame }, limits: researchExampleLimits });
    if (!run.ok) throw Error(JSON.stringify(run));
    const driver = createMasSegmentDriver(db, masStore, { owner: 'domain-instrument', leaseMs: 1000 }); await driver.enqueue(run.value);
    let duplicateResponses = 0;
    for (let i = 0; i < 4; i++) {
      if (!await driver.drive(prepared.plan.executableRevision, runtime.value.executeSegment, new AbortController().signal)) throw Error('Domain segment was not queued.');
      const trace = (await masStore.readTrace(project.id))!;
      if (trace.run.status === 'completed') break;
      if (trace.run.status !== 'waiting_for_input') throw Error('Domain lifecycle refused: ' + JSON.stringify(trace.run.failure));
      const gate = trace.interactions.find(row => row.status === 'waiting')!, prompt = gate.prompt as ResearchWorkflowFrame;
      const response = { decision: 'approve', approvedManifestHash: prompt.gate!.manifestHash, note: '', actor: 'scripted' }, key = 'domain-approval-' + i;
      const accepted = await masStore.respondInteraction(gate.id, response, gate.revision, key);
      if (!accepted.ok || !equalsJson(accepted, await masStore.respondInteraction(gate.id, response, gate.revision, key))) throw Error('Domain approval replay differs.');
      duplicateResponses++; await ensurePendingMasSegments(db, masStore);
    }
    const trace = (await masStore.readTrace(project.id))!, snapshot = researchValue(await store.snapshot(project.id))!, actual = await science();
    const expectedState = actual.summary.result === 'improvement' ? 'COMPLETE' : 'STOPPED';
    if (trace.run.status !== 'completed' || snapshot.state.status !== expectedState)
      throw Error('Domain lifecycle did not reach its registered terminal state: ' + JSON.stringify({ topic: topic.id, expectedState, actual: snapshot.state.status, status: trace.run.status }));
    // Reconstruct the exact retained workspace and re-admit every observation after execution.
    const registry = createEvaluationRegistry([domain.evaluator]);
    const artifacts = new Map<string, Uint8Array>();
    for (const row of snapshot.artifacts) artifacts.set(row.artifact.id, researchValue(await store.readArtifact(project.id, row.id)).bytes);
    for (const manifest of snapshot.records.filter(row => row.kind === 'ExecutionManifest').map(row => row.value)) {
      const retained = snapshot.records.filter(row => row.kind === 'WorkspaceManifest').map(row => row.value).find(row => row.workspaceHash === manifest.workspaceHash);
      if (!retained) throw Error('Registered execution manifest has no retained workspace.');
      const workspace = researchValue(await createResearchWorkspace({ projectId: project.id, datasetIds: retained.datasetIds,
        splitIds: retained.splitIds, files: retained.entries.map(entry => ({ ...entry, bytes: artifacts.get(entry.artifactId)! })) }));
      const experiment = actual.runs.find(row => row.executionManifestHash === manifest.executionManifestHash);
      if (!experiment) throw Error('Registered execution manifest has no retained result.');
      const outputArtifacts = [...new Set([experiment.stdoutArtifactId!, experiment.stderrArtifactId!, ...experiment.outputInventory!.map(row => row.artifactId)])]
        .map(artifactId => ({ artifactId, bytes: artifacts.get(artifactId)! }));
      researchValue(await registry.registerObservations({ result: { run: experiment, artifacts: outputArtifacts }, manifest, workspace,
        contract, plan, hiddenLabels: input.hiddenLabels }, actual.observations.filter(row => row.experimentRunId === experiment.id)));
    }
    const lifecycle: DomainLifecycleReceipt = { runId: project.id, bindingId: binding.id, runIdentityId: binding.runIdentityId,
      workflowVersionId: prepared.workflow.versionId, executableRevision: prepared.plan.executableRevision, status: 'completed', state: snapshot.state,
      attempts: snapshot.attempts.map(row => row.attempt), manifests: snapshot.records.filter(row => row.kind === 'InputManifest').map(row => row.value),
      runs: actual.runs, observations: actual.observations, duplicateResponses, modelCalls: 0,
      spend: snapshot.attempts.reduce((sum, row) => ({ calls: sum.calls + row.attempt.spend.calls, tokens: sum.tokens + row.attempt.spend.tokens,
        ms: sum.ms + row.attempt.spend.ms, physical: sum.physical + row.attempt.spend.physical }), { calls: 0, tokens: 0, ms: 0, physical: 0 }) };
    if (lifecycle.spend.calls !== trace.run.budget.spent.turns || lifecycle.spend.tokens !== trace.run.budget.spent.tokens
      || lifecycle.spend.physical !== actual.runs.length) throw Error('Native lifecycle cost receipts do not reconcile: ' + JSON.stringify({ research: lifecycle.spend,
        native: trace.run.budget.spent, runs: actual.runs.length, attempts: snapshot.attempts.map(row => ({ stage: row.attempt.stage, spend: row.attempt.spend })) }));
    return immutableResearchJson({ topicId: topic.id, topicHash: input.topicHash, contractHash: contract.contractHash, planHash: plan.planHash,
      lifecycle, ...actual.summary, claimSupport: 1, registryAccuracy: 1, preregistrationIntegrity: 1 });
  } finally { await db.close(); }
}
