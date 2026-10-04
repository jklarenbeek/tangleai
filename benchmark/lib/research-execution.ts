/** Matched native model-and-execution controls; scripted branch choices never claim efficacy. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { createResearchExecutionTools, createFixtureExecutor, researchValue, type ResearchWorkspace, type ResearchCost } from '@tangleai/research';
import { researchExecutionFixture } from './research-execution-fixture.ts';
import { runResearchReasoningFixture } from './research-reasoning.ts';
import { requireResearchShape } from './research-validation.ts';
import { researchScore } from './research-oracle.ts';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { ResearchFixtureTopic, ResearchReasoningScript, ResearchExecutionTopic, ResearchExecutionRow,
  ExperimentRun, MetricObservation, ExecutionManifest, WorkspaceManifest, ExperimentBranch } from './research.types.ts';

const sumCost = (rows: ResearchCost[]): ResearchCost => rows.reduce((sum, row) => ({ calls: sum.calls + row.calls, tokens: sum.tokens + row.tokens,
  ms: sum.ms + row.ms, physical: sum.physical + row.physical }), { calls: 0, tokens: 0, ms: 0, physical: 0 });
export async function runResearchExecutionFixture(loaded: LoadedResearchFixture, original: ResearchFixtureTopic,
  mode: 'control' | 'branching' | 'program-throw' | 'cancelled') {
  const f = await researchExecutionFixture(loaded, original), topic = structuredClone(original);
  const { contractHash: _oldContract, ...contractBody } = topic.contract;
  contractBody.attemptCap = f.registered.attemptCap;
  topic.contract = { ...contractBody, contractHash: await canonicalSha256(contractBody) };
  const { planHash: _oldPlan, ...planBody } = topic.plan; planBody.contractHash = topic.contract.contractHash;
  topic.plan = { ...planBody, planHash: await canonicalSha256(planBody) };
  const script = requireResearchShape<ResearchReasoningScript>('ResearchReasoningScript', JSON.parse(new TextDecoder().decode(loaded.files.get('scripts/' + topic.id + '.json')!)));
  script.design.contract.attemptCap = f.registered.attemptCap;
  script.design.plan.design.resources = f.registered.designResources;
  const controller = new AbortController(); let dispatches = 0;
  const executor = mode === 'program-throw' || mode === 'cancelled' ? createFixtureExecutor(Object.fromEntries(Object.entries(f.programs).map(([id, program]) => [id, async input => {
    dispatches++;
    if (mode === 'program-throw' && id === topic.plan.conditions[1].programId && input.seed === 3) throw Error('Registered third-seed candidate failure.');
    if (mode === 'cancelled' && dispatches === 3) controller.abort();
    return program(input);
  }])), { now: () => 0 }) : f.executor;
  const decisions = mode === 'branching' ? f.registered.branching : f.registered.control;
  return runResearchReasoningFixture(loaded, topic, 'single-agent', { policy: f.policy, script, decisions: [decisions], signal: controller.signal,
    revision: await canonicalSha256({ registration: f.registration, mode }),
    async tools(base, store) {
      const execute = base.execute, verify = base.verify;
      return createResearchExecutionTools({ ...base, async execute(operation, access) {
        const result = await execute(operation, access);
        if (operation.stage === 'create') result.artifacts.push({ bytes: loaded.files.get(topic.datasetPath)!, mediaType: 'application/json' });
        return result;
      }, verify(operation, result, access) { return verify(operation,
        operation.stage === 'create' ? { ...result, artifacts: result.artifacts.slice(0, 1) } : result, access); } },
      { researchStore: store, policy: f.policy, executor, evaluators: [f.evaluator], hiddenLabels: f.hiddenLabels, evaluatorBytes: f.evaluatorBytes });
    },
    async collect(store, masStore, reasoning) {
      const snapshot = researchValue(await store.snapshot(topic.contract.projectId))!, trace = (await masStore.readTrace(topic.contract.projectId))!;
      if (!['completed', 'failed'].includes(trace.run.status) || snapshot.state.status !== 'STOPPED')
        throw Error('Execution control did not settle at Stop: ' + JSON.stringify({ status: trace.run.status, failure: trace.run.failure, state: snapshot.state }));
      const contract = snapshot.records.find(row => row.kind === 'ResearchContract' && row.value.contractHash === snapshot.state.contractHash)!.value as typeof topic.contract;
      const plan = snapshot.records.find(row => row.kind === 'ExperimentPlan' && row.value.planHash === snapshot.state.planHash)!.value as typeof topic.plan;
      const runs = snapshot.records.filter(row => row.kind === 'ExperimentRun').map(row => row.value as ExperimentRun);
      const observations = snapshot.records.filter(row => row.kind === 'MetricObservation').map(row => row.value as MetricObservation);
      const manifests = snapshot.records.filter(row => row.kind === 'ExecutionManifest').map(row => row.value as ExecutionManifest);
      const workspaces = snapshot.records.filter(row => row.kind === 'WorkspaceManifest').map(row => row.value as WorkspaceManifest);
      const branches = snapshot.records.filter(row => row.kind === 'ExperimentBranch').map(row => row.value as ExperimentBranch).sort((a, b) => a.attemptOrdinal - b.attemptOrdinal);
      const artifacts = new Map<string, Uint8Array>();
      const requiredArtifacts = new Set([...workspaces.flatMap(row => row.entries.map(entry => entry.artifactId)),
        ...runs.flatMap(row => [row.stdoutArtifactId!, row.stderrArtifactId!, ...row.outputInventory!.map(entry => entry.artifactId)])]);
      for (const admission of snapshot.artifacts.filter(row => snapshot.committedAdmissionIds.includes(row.id) && requiredArtifacts.has(row.artifact.id)))
        artifacts.set(admission.artifact.id, researchValue(await store.readArtifact(topic.contract.projectId, admission.id)).bytes);
      if (artifacts.size !== requiredArtifacts.size) throw Error('Execution omitted committed input or output bytes.');
      const expectedRuns = decisions.length * contract.replicatePolicy.seeds.length * plan.conditions.length;
      let reproduced = 0, registered = 0; const rerunCosts: ResearchCost[] = [];
      for (const run of runs) {
        const manifest = manifests.find(row => row.executionManifestHash === run.executionManifestHash)!;
        const workspaceManifest = workspaces.find(row => row.workspaceHash === manifest.workspaceHash)!;
        const workspace: ResearchWorkspace = { manifest: workspaceManifest, artifacts: [...new Set(workspaceManifest.entries.map(row => row.artifactId))]
          .map(artifactId => ({ artifactId, bytes: artifacts.get(artifactId)! })) };
        const result = { run, artifacts: [...new Set([run.stdoutArtifactId!, run.stderrArtifactId!, ...run.outputInventory!.map(row => row.artifactId)])]
          .map(artifactId => ({ artifactId, bytes: artifacts.get(artifactId)! })) };
        const context = { contract, plan, signal: new AbortController().signal };
        const independently = await f.registry.evaluate({ contract, plan, manifest, workspace, result, hiddenLabels: f.hiddenLabels });
        if (run.status !== 'ok') {
          if (independently.valid || observations.some(row => row.experimentRunId === run.id)) throw Error('Failed execution admitted observations.');
          continue;
        }
        const proposed = observations.filter(row => row.experimentRunId === run.id), verified = await f.registry.registerObservations({ contract, plan, manifest, workspace, result, hiddenLabels: f.hiddenLabels }, proposed);
        if (verified.valid && independently.valid && canonicalizeJson(proposed) === canonicalizeJson(independently.value)) registered++;
        const rerun = researchValue(await f.executor.run(manifest, workspace, context)); rerunCosts.push(rerun.run.spend);
        const reevaluated = researchValue(await f.registry.evaluate({ contract, plan, manifest, workspace, result: rerun, hiddenLabels: f.hiddenLabels }));
        const archived = (rows: typeof result.artifacts) => rows.map(row => ({ artifactId: row.artifactId, bytes: [...row.bytes] })).sort((a, b) => a.artifactId.localeCompare(b.artifactId));
        if (canonicalizeJson(rerun.run) === canonicalizeJson(result.run) && canonicalizeJson(archived(rerun.artifacts)) === canonicalizeJson(archived(result.artifacts))
          && canonicalizeJson(reevaluated) === canonicalizeJson(proposed)) reproduced++;
      }
      const attempts = snapshot.attempts.map(row => row.attempt), cost = sumCost(attempts.map(row => row.spend));
      if (mode === 'control' || mode === 'branching') {
        if (runs.length !== expectedRuns || branches.length !== decisions.length || attempts.some(row => row.error))
          throw Error('Registered execution control omitted an attempt or stopped on an error: ' + JSON.stringify(attempts.filter(row => row.error)));
      }
      if (cost.calls !== reasoning.cost.calls || cost.tokens !== reasoning.cost.tokens || cost.physical !== reasoning.cost.physical + runs.length)
        throw Error('Execution cost does not reconcile with model requests and retained replicates.');
      const traceBytes = new TextEncoder().encode(JSON.stringify(trace)).byteLength;
      if (traceBytes > loaded.manifest.caps.traceBytes) throw Error('Execution control exceeded its registered trace bound.');
      const expectedPerBranch = contract.replicatePolicy.seeds.length * plan.conditions.length;
      const partialBranches = branches.filter(branch => manifests.filter(row => row.branchId === branch.id).length < expectedPerBranch).length;
      const actions = trace.interactions.filter(row => row.response !== null).map(row => row.response as { decision: string; note: string });
      return requireResearchShape<ResearchExecutionTopic>('ResearchExecutionTopic', { topicId: topic.id, nativeStatus: trace.run.status, state: snapshot.state,
        runIdentityId: reasoning.runIdentityId, workflowVersionId: reasoning.workflowVersionId, executableRevision: reasoning.executableRevision,
        contract, plan, attempts, branches, workspaces, manifests, runs, observations,
        artifacts: [...artifacts].sort(([a], [b]) => a.localeCompare(b)).map(([artifactId, bytes]) => ({ artifactId, bytes: [...bytes] })),
        usage: reasoning.usage, cost, rerunCost: sumCost(rerunCosts), expectedRuns, partialBranches, traceBytes,
        rerunRate: researchScore(reproduced, expectedRuns), registryAccuracy: researchScore(registered, expectedRuns),
        tracesCompleteness: researchScore(runs.filter(run => run.trace.length === 2 && run.stdoutArtifactId && run.stderrArtifactId && run.outputInventory && run.stopReason).length, expectedRuns),
        interactions: trace.interactions, interventions: { total: actions.length, approvals: actions.filter(row => row.decision === 'approve').length,
          substantive: actions.filter(row => row.note.trim()).length },
        failures: { program: runs.filter(row => row.status === 'failed').length, verification: runs.filter(row => row.status === 'ok').length - registered,
          leakage: 0, confound: 0, budget: 0, provider: 0, unsupported: 0 } });
    },
  });
}
export function aggregateResearchExecution(id: ResearchExecutionRow['id'], topics: ResearchExecutionTopic[]): ResearchExecutionRow {
  const sum = (read: (topic: ResearchExecutionTopic) => number) => topics.reduce((total, topic) => total + read(topic), 0);
  return { id, state: 'measured', scope: 'execution', topics, cost: sumCost(topics.map(row => row.cost)), rerunCost: sumCost(topics.map(row => row.rerunCost)),
    rerunRate: researchScore(sum(row => row.rerunRate.passed), sum(row => row.rerunRate.total)),
    registryAccuracy: researchScore(sum(row => row.registryAccuracy.passed), sum(row => row.registryAccuracy.total)),
    tracesCompleteness: researchScore(sum(row => row.tracesCompleteness.passed), sum(row => row.tracesCompleteness.total)),
    interventions: { total: sum(row => row.interventions.total), substantive: sum(row => row.interventions.substantive), approvals: sum(row => row.interventions.approvals) },
    failures: { program: sum(row => row.failures.program), verification: sum(row => row.failures.verification), leakage: sum(row => row.failures.leakage),
      confound: sum(row => row.failures.confound), budget: sum(row => row.failures.budget), provider: sum(row => row.failures.provider), unsupported: sum(row => row.failures.unsupported) } };
}
