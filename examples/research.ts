/** Keyless research control: native MAS, immutable artifacts, SQLite jobs and three gates. */
import { resolveProfile, type ProfileRegistry, type HostManifest } from '@tangleai/config';
import { compileMasRuntime, type MasStore } from '@tangleai/mas';
import { openTangleDb, createMasStore, createResearchStore, createMasSegmentWorker, enqueueMasSegment, ensurePendingMasSegments, type TangleDb } from '@tangleai/store';
import { researchRevisionOf, researchValue, planProjectCreate, createResearchBinding, initialResearchFrame, prepareResearchWorkflow,
  createResearchTaskHandlers, createResearchHostBindings, type ResearchProject, type ResearchContract, type ExperimentPlan,
  type ResearchTaskTools, type ResearchWorkflowFrame, type ResearchStageResult, type ResearchWorkflowBinding, type ResearchStageOperation } from '@tangleai/research';

export async function researchExampleIdentity() {
  const registry: ProfileRegistry = { version: 1, credentialSlots: [], candidates: [
    { id: 'scripted-chat', kind: 'chat', provider: 'ollama', model: 'research-scripted', baseUrl: null, credentialSlot: null, features: [], rateCard: null },
    { id: 'scripted-embedding', kind: 'embedding', provider: 'builtin', model: 'research-control', dims: 2, baseUrl: null, credentialSlot: null, features: [], rateCard: null }],
    capabilities: [], prompts: [], responseSchemas: [], components: [], inference: [], budgets: [], profiles: [{ id: 'research-scripted', kind: 'root',
      description: 'Scripted lifecycle control; zero provider calls', roles: { chat: { candidate: 'scripted-chat', capability: null, prompt: null,
        responseSchema: null, tools: [], toolsRequired: false, inference: null, ranker: null } }, embedding: 'scripted-embedding', policyComponent: null, budget: null }] };
  const host: HostManifest = { sourceClass: 'synthetic', credentialSlots: [], providers: [{ provider: 'ollama', base: 'http://127.0.0.1:11434/v1', models: ['research-scripted'], features: [] }],
    embedding: [{ provider: 'builtin', base: null, model: 'research-control', dims: 2 }], tools: [], components: [],
    budget: { maxCalls: 100, maxTokens: 100000, maxMs: 600000, maxConcurrency: 1 }, observation: null };
  const resolution = await resolveProfile({ registry, host, request: { kind: 'profile', profile: 'research-scripted', overrides: null } });
  if (!resolution.ok) throw Error(JSON.stringify(resolution.issues));
  return resolution.identity;
}
export const researchExampleLimits = { calls: 100, tokens: 100000, ms: 600000, toolRounds: 4, fanOut: 8, concurrency: 1,
  iterations: 8, contextChars: 200000, traceBytes: 2000000 };
export type ResearchExampleDecisions = Array<Array<'Proceed' | 'Refine' | 'Pivot' | 'Stop'>>;
export async function researchExampleData(projectId = 'research-example') {
  const project: ResearchProject = { id: projectId, topic: 'Durable lifecycle control', domainProfile: 'computational',
    question: 'Does this scripted workflow retain its exact artifacts through three approvals and restart?', owner: 'example', mode: 'gate-only',
    safetyClass: 'computational', status: 'CREATED', budget: { calls: 100, tokens: 100000, ms: 600000, physical: 100 }, createdAt: '2026-01-01T00:00:00.000Z' };
  const body: Omit<ResearchContract, 'contractHash'> = { id: projectId + '-contract', projectId, hypothesisSpace: ['Scripted control only; no scientific efficacy claim'],
    successRule: { metric: 'control-score', condition: 'candidate', baseline: 'baseline', minImprovement: 0, confidenceLevel: 0.95 }, failureRule: 'stop-on-invalid',
    metrics: [{ id: 'control-score', direction: 'maximize', unit: 'control' }], datasets: [{ id: 'scripted-control', sha256: await researchRevisionOf({ control: 1 }) }],
    splits: { train: ['control-train'], test: ['control-test'] }, requiredBaselines: [{ condition: 'baseline', programId: 'scripted-control', source: 'Authored lifecycle control',
      licence: { spdx: 'MIT', provenance: 'tangle-authored-synthetic', source: 'Tangle research example' } }],
    replicatePolicy: { seeds: [1], minimum: 1, resamples: 10, bootstrapSeed: 1 }, attemptCap: 3, pivotCap: 2, reviewCap: 2,
    selectionRule: { kind: 'all', n: 1, metric: 'control-score' }, stopConditions: ['Policy cap or explicit Stop'] };
  const contract = { ...body, contractHash: await researchRevisionOf(body) };
  const planBody: Omit<ExperimentPlan, 'planHash'> = { id: projectId + '-plan', projectId, contractHash: contract.contractHash,
    hypothesisHash: await researchRevisionOf(body.hypothesisSpace), conditions: [
      { id: 'baseline', programId: 'scripted-control', datasetId: 'scripted-control', params: {} },
      { id: 'candidate', programId: 'scripted-control', datasetId: 'scripted-control', params: {} }], inputPaths: ['inline-control'], evaluator: { id: 'control-only', version: '1' } };
  return { project, contract, plan: { ...planBody, planHash: await researchRevisionOf(planBody) } };
}
export async function researchExampleBinding(contract: ResearchContract, decisions: ResearchExampleDecisions = [['Proceed']]) {
  return createResearchBinding(contract, { identity: await researchExampleIdentity(), promptRevision: await researchRevisionOf({ prompt: 'scripted-control-v1' }),
    toolVersions: [{ name: 'scripted-stages', version: await researchRevisionOf({ decisions, implementation: 'control-v1' }) }],
    evaluator: { id: 'control-only', version: '1' }, reservation: { calls: 0, tokens: 0, ms: 0, physical: 0 } });
}
/** Test/control bodies; real experiment tools replace these through the same stage contract. */
export function researchExampleTools(options: { binding: ResearchWorkflowBinding; contract: ResearchContract; plan: ExperimentPlan;
  masStore: MasStore; decisions?: ResearchExampleDecisions; onOperation?: ResearchTaskTools['onOperation']; onExecute?: (op: ResearchStageOperation) => void }): ResearchTaskTools {
  const decisions: ResearchExampleDecisions = structuredClone(options.decisions ?? [['Proceed']]);
  return { binding: options.binding, contract: options.contract, plan: options.plan, masStore: options.masStore, onOperation: options.onOperation,
    async execute(op) {
      options.onExecute?.(op);
      const choice = decisions[op.frame.pivot - 1]?.[op.frame.attempt - 1] ?? 'Proceed';
      return { artifacts: [{ mediaType: 'application/json', bytes: new TextEncoder().encode(JSON.stringify({ control: 'scripted', stage: op.stage,
        pivot: op.frame.pivot, attempt: op.frame.attempt, review: op.frame.review })) }], records: [], spend: { calls: 0, tokens: 0, ms: 0, physical: 0 },
        ...(op.stage === 'decide' ? { decision: choice } : {}) };
    },
    async verify(op, result: ResearchStageResult) {
      const body = JSON.parse(new TextDecoder().decode(result.artifacts[0].bytes));
      return body.control === 'scripted' && body.stage === op.stage && result.artifacts.length === 1
        ? { valid: true, value: null } : { valid: false, issues: [{ code: 'TRSH1005', path: '/artifacts', detail: 'Control artifact failed independent structural verification.' }] };
    },
  };
}

/** The actual native worker executes each queued segment and is stopped at the durable wait. */
async function driveExampleWorker(db: TangleDb, store: MasStore, runtime: ReturnType<typeof compileMasRuntime> & { valid: true }) {
  let resolve!: () => void, reject!: (cause: unknown) => void;
  const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const timeout = setTimeout(() => reject(Error('Research example worker deadline')), 15000);
  const worker = createMasSegmentWorker(db, store, { executableRevisions: [runtime.value.plan.executableRevision], concurrency: 1,
    pollInterval: 1, owner: 'research-example', execute: async segment => {
      try { await runtime.value.executeSegment(segment); resolve(); } catch (cause) { reject(cause); throw cause; }
    } });
  worker.start(); try { await done; } finally { clearTimeout(timeout); await worker.stop(); }
}
export async function runResearchExample(path: string) {
  const data = await researchExampleData(), binding = await researchExampleBinding(data.contract);
  const prepared = await prepareResearchWorkflow(data.contract, { binding, profile: 'research-scripted', limits: researchExampleLimits });
  const frame = await initialResearchFrame(data.project, data.plan, binding), now = () => '2026-01-01T00:00:00.000Z';
  let db = await openTangleDb({ path, jobs: { now: () => 1000000, random: () => 0.5 } }), executions = 0, approvals = 0;
  const host = () => {
    const masStore = createMasStore(db, { now }), researchStore = createResearchStore(db);
    const taskHandlers = createResearchTaskHandlers(researchStore, researchExampleTools({ ...data, binding, masStore, onExecute: () => executions++ }));
    const runtime = compileMasRuntime(prepared.validated, prepared.plan, prepared.snapshot,
      createResearchHostBindings({ masStore, researchStore, taskHandlers, prepared, now, clock: () => 1000000 }));
    if (!runtime.valid) throw Error(JSON.stringify(runtime.issues));
    return { masStore, researchStore, runtime };
  };
  try {
    let h = host(); researchValue(await h.researchStore.createProject(researchValue(planProjectCreate(data.project))));
    const created = await h.masStore.createRun({ runId: data.project.id, workflowId: prepared.workflow.workflowId,
      workflowVersionId: prepared.workflow.versionId, registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision,
      configRegistryRevision: prepared.catalog.revision, profile: 'research-scripted', input: { frame }, limits: researchExampleLimits });
    if (!created.ok) throw Error(JSON.stringify(created));
    await enqueueMasSegment(db, { runId: created.value.id, segment: 0, workflowVersionId: prepared.workflow.versionId,
      registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision });
    for (let segment = 0; segment < 4; segment++) {
      await driveExampleWorker(db, h.masStore, h.runtime);
      const trace = (await h.masStore.readTrace(data.project.id))!;
      if (trace.run.status === 'completed') break;
      if (trace.run.status !== 'waiting_for_input') throw Error(JSON.stringify(trace.run.failure));
      const gate = trace.interactions.find(i => i.status === 'waiting')!, prompt = gate.prompt as ResearchWorkflowFrame;
      const response = { decision: 'approve', approvedManifestHash: prompt.gate!.manifestHash, note: 'Scripted control approval', actor: 'scripted' };
      const key = 'approval-' + (++approvals), accepted = await h.masStore.respondInteraction(gate.id, response, gate.revision, key);
      if (!accepted.ok || !(await h.masStore.respondInteraction(gate.id, response, gate.revision, key)).ok) throw Error('Approval failed');
      await db.close(); db = await openTangleDb({ path, jobs: { now: () => 1000000, random: () => 0.5 } }); h = host();
      await ensurePendingMasSegments(db, h.masStore);
    }
    const trace = (await h.masStore.readTrace(data.project.id))!, snapshot = researchValue(await h.researchStore.snapshot(data.project.id));
    if (trace.run.status !== 'completed' || snapshot?.state.status !== 'COMPLETE') throw Error('Research example did not complete');
    const before = executions; await ensurePendingMasSegments(db, h.masStore);
    return { status: snapshot.state.status, approvals, executions, replayExecutions: executions - before, spend: trace.run.budget.spent,
      artifactIds: snapshot.artifacts.filter(a => snapshot.committedAdmissionIds.includes(a.id)).map(a => a.artifact.id).sort() };
  } finally { await db.close(); }
}
