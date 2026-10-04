/** Native task receipts preserve each replicate, including failures, before the branch commit. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { MasInfrastructureCrash, MasTaskRefusal, type MasTaskInput, type MasNodeAttempt } from '@tangleai/mas';
import type { ResearchStore } from '../store.ts';
import type { ResearchTaskTools, ResearchStageOperation, ResearchStageResult } from '../handlers.ts';
import type { ResearchRecordWrite } from '../records.ts';
import type { ResearchContract, ExperimentPlan, WorkspaceManifest, ResearchInputArtifact, ExecutionManifest,
  ExperimentRun, MetricObservation, ResearchIssue, ResearchCost, ExperimentBranch, ResearchCodeWrite } from '../contracts.gen.ts';
import type { ResearchExecutionPolicy, ResearchExecutionRuntime, ResearchExecutionCursor } from '../execution-contract.ts';
import { researchExecutionRevisionOf } from '../execution-contract.ts';
import { immutableResearchJson, copyResearchBytes, researchArtifactIdOf, researchRevisionOf } from '../identity.ts';
import { researchIssue } from '../errors.ts';
import { ResearchFailure, researchFail, researchValue } from '../workflow-contract.ts';
import { researchFrameInputs } from '../manifest.ts';
import { createResearchWorkspace, validateResearchWorkspace, buildExecutionManifest, type ResearchWorkspace } from '../execution/manifest.ts';
import { validateResearchExecutionResult, RESEARCH_EXECUTOR_CONTRACT, type ResearchExecutor } from '../execution/executor.ts';
import type { ResearchEvaluator } from '../execution/registry.ts';
import { createEvaluationRegistry } from '../execution/registry.ts';
import { createResearchAuthorTools, researchCodeWriteId, researchCodeStaticIssues } from './author.ts';

const PREPARATION_MEDIA = 'application/vnd.tangleai.research-execution-preparation+json';
const RECEIPT_MEDIA = 'application/vnd.tangleai.research-execution-receipt+json';
interface ExecutionPreparation {
  operation: ResearchStageOperation;
  contract: ResearchContract;
  plan: ExperimentPlan;
  workspace: WorkspaceManifest;
  inputs: ResearchInputArtifact[];
  branchId: string;
  parentId: string | null;
}
interface ExperimentReceipt {
  manifest: ExecutionManifest;
  run: ExperimentRun | null;
  artifacts: ResearchInputArtifact[];
  observations: MetricObservation[];
  error: ResearchIssue | null;
  spend: ResearchCost;
}
const jsonBytes = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value));
const refOf = (row: { id: string; artifact: { id: string } }): ResearchInputArtifact => ({ artifactId: row.artifact.id, admissionId: row.id });
const cost = (rows: ResearchCost[]): ResearchCost => rows.reduce((sum, row) => ({ calls: sum.calls + row.calls, tokens: sum.tokens + row.tokens,
  ms: sum.ms + row.ms, physical: sum.physical + row.physical }), { calls: 0, tokens: 0, ms: 0, physical: 0 });

export async function createResearchExecutionTools<Labels>(base: ResearchTaskTools, options: {
  researchStore: ResearchStore;
  policy: ResearchExecutionPolicy;
  executor: ResearchExecutor;
  evaluators: readonly ResearchEvaluator<Labels>[];
  hiddenLabels: Labels;
  evaluatorBytes: Uint8Array;
}): Promise<ResearchTaskTools> {
  const store = options.researchStore, masStore = base.masStore, policy = immutableResearchJson(options.policy);
  const hiddenLabels = immutableResearchJson(options.hiddenLabels), evaluatorBytes = copyResearchBytes(options.evaluatorBytes);
  const executor = { contract: immutableResearchJson(options.executor.contract), run: options.executor.run.bind(options.executor) };
  const registry = createEvaluationRegistry(options.evaluators), revision = await researchExecutionRevisionOf(policy);
  if (!equalsJson(executor.contract, RESEARCH_EXECUTOR_CONTRACT)
    || !base.binding.toolVersions.some(row => row.name === 'research-execution' && row.version === revision))
    researchFail('TRSH1007', '/execution', 'Execution handlers must bind the shipped executor and exact native execution policy.');

  async function stage(operation: ResearchStageOperation, bytes: Uint8Array, mediaType: string): Promise<ResearchInputArtifact> {
    const snapshot = researchValue(await store.snapshot(operation.frame.projectId));
    if (!snapshot) researchFail('TRSH1003', '/projectId', 'Execution project is absent.');
    const key = { projectId: operation.frame.projectId, stage: 'EXECUTE' as const,
      attemptOrdinal: Math.max(0, ...snapshot.attempts.filter(row => row.attempt.stage === 'EXECUTE').map(row => row.attempt.attemptOrdinal)) + 1,
      inputManifestHash: await researchRevisionOf(operation.manifest) };
    const parents = researchFrameInputs(operation.frame);
    return refOf(researchValue(await store.stageArtifact(bytes, { projectId: key.projectId, attempt: key, mediaType,
      verification: 'pending', parents: parents.length ? parents : [{ artifactId: key.projectId, admissionId: null }] })));
  }
  async function artifact(operation: ResearchStageOperation, ref: ResearchInputArtifact, mediaType?: string) {
    const row = researchValue(await store.readArtifact(operation.frame.projectId, ref.admissionId));
    if (row.admission.artifact.id !== ref.artifactId || row.admission.attempt.inputManifestHash !== await researchRevisionOf(operation.manifest)
      || row.admission.attempt.stage !== 'EXECUTE' || mediaType && row.admission.artifact.mediaType !== mediaType)
      researchFail('TRSH1005', '/execution/artifact', 'Execution evidence does not belong to this admitted stage.');
    return row;
  }
  async function scope(invocation: { runId: string; path: string }, requireRunning = true) {
    const trace = await masStore.readTrace(invocation.runId);
    if (!trace || requireRunning && (trace.run.status !== 'running' || !trace.attempts.some(row => row.path === invocation.path && row.status === 'running')))
      researchFail('TRSH1005', '/invocation', 'Execution requires its running native task or author invocation.');
    const candidates = trace.attempts.filter(row => row.kind === 'task' && row.invocationId === 'prepare' && row.status === 'completed')
      .map(row => row.output as { preparation?: { stage: string; scope: string; attemptId: string }; execution?: ResearchInputArtifact })
      .filter(row => row.preparation?.stage === 'execute' && invocation.path.startsWith(row.preparation.scope + '/') && row.execution)
      .sort((a, b) => b.preparation!.scope.length - a.preparation!.scope.length);
    const prepared = candidates[0];
    if (!prepared?.execution || !prepared.preparation) researchFail('TRSH1005', '/preparation', 'Execution requires its completed native preparation.');
    const row = researchValue(await store.readArtifact(invocation.runId, prepared.execution.admissionId));
    if (row.admission.artifact.id !== prepared.execution.artifactId || row.admission.artifact.mediaType !== PREPARATION_MEDIA)
      researchFail('TRSH1002', '/preparation', 'Execution preparation content differs from the native receipt.');
    const data = JSON.parse(new TextDecoder().decode(row.bytes)) as ExecutionPreparation;
    if (data.operation.attemptId !== prepared.preparation.attemptId || data.operation.frame.projectId !== invocation.runId)
      researchFail('TRSH1002', '/preparation', 'Execution preparation names another stage.');
    const state = researchValue(await store.getState(invocation.runId));
    if (!state || !equalsJson(state, data.operation.expectedState)) researchFail('TRSH1004', '/state', 'Prepared execution no longer matches the active frozen project.');
    const artifacts = [];
    for (const ref of data.inputs) artifacts.push({ artifactId: ref.artifactId, bytes: (await artifact(data.operation, ref)).bytes });
    const workspace = researchValue(await validateResearchWorkspace({ manifest: data.workspace, artifacts }));
    return { data, workspace, trace, path: prepared.preparation.scope };
  }
  async function authored(current: Awaited<ReturnType<typeof scope>>) {
    const rows: ResearchCodeWrite[] = [];
    for (const slot of policy.codeFiles) {
      const row = researchValue(await store.getRecord(current.data.operation.frame.projectId, 'ResearchCodeWrite', await researchCodeWriteId(current.data.operation.attemptId, slot.path)));
      if (!row) continue;
      const bytes = new TextEncoder().encode(row.text);
      if (row.projectId !== current.data.operation.frame.projectId || row.attemptId !== current.data.operation.attemptId || row.path !== slot.path
        || row.bytes !== bytes.byteLength || row.bytes > slot.maxBytes || row.artifactId !== await researchArtifactIdOf(bytes)
        || !equalsJson(row.staticIssues, researchCodeStaticIssues(row.text))) researchFail('TRSH1002', '/code', 'Immutable code write does not match its admitted slot.');
      rows.push(row);
    }
    return rows;
  }
  async function executionWorkspace(current: Awaited<ReturnType<typeof scope>>) {
    if (policy.mode === 'fixture') return { workspace: current.workspace, codeArtifactId: undefined };
    const author = current.trace.attempts.find(row => row.path === current.path + '/author' && row.status === 'completed' && row.kind === 'agent');
    const seal = current.trace.attempts.find(row => row.path === current.path + '/seal' && row.status === 'completed' && row.kind === 'task');
    if (!author || !seal) researchFail('TRSH1005', '/author', 'Authored execution requires the completed native author and seal.');
    const entrypoint = (author.output as { out: { entrypoint: string } }).out.entrypoint;
    const codes = await authored(current), main = codes.find(row => row.path === entrypoint);
    if (!main || codes.some(row => row.staticIssues.length)) researchFail('TRSH1010', '/code', 'Authored entrypoint is missing or static checks refused a declared code file.');
    const workspace = researchValue(await createResearchWorkspace({ projectId: current.workspace.manifest.projectId,
      datasetIds: current.workspace.manifest.datasetIds, splitIds: current.workspace.manifest.splitIds,
      files: [...current.workspace.manifest.entries.map(entry => ({ ...entry, bytes: current.workspace.artifacts.find(row => row.artifactId === entry.artifactId)!.bytes })),
        ...codes.map(row => ({ path: row.path, bytes: new TextEncoder().encode(row.text), mode: 'read-only' as const, role: 'code' as const }))] }));
    return { workspace, codeArtifactId: main.artifactId };
  }
  const wrap = (body: (input: MasTaskInput) => Promise<Record<string, unknown>>) => async (input: MasTaskInput) => {
    try { return await body(input); }
    catch (cause) {
      if (cause instanceof MasInfrastructureCrash || cause instanceof MasTaskRefusal) throw cause;
      const issue = cause instanceof ResearchFailure ? cause.issue : researchIssue('TRSH1008', '/execution', 'Native experiment failed.', cause);
      throw new MasTaskRefusal({ code: 'TMAS2004', detail: issue.detail, cause: { code: issue.code, docPath: issue.path, message: issue.detail } });
    }
  };
  const runtime: ResearchExecutionRuntime = { policy, toolBindings: {}, taskHandlers: {},
    async prepare(operation, access) {
      const snapshot = researchValue(await store.snapshot(operation.frame.projectId))!;
      const contract = snapshot.records.find(row => row.kind === 'ResearchContract' && row.value.contractHash === snapshot.state.contractHash)?.value as ResearchContract | undefined;
      const plan = snapshot.records.find(row => row.kind === 'ExperimentPlan' && row.value.planHash === snapshot.state.planHash)?.value as ExperimentPlan | undefined;
      if (!contract || !plan) researchFail('TRSH1009', '/preregistration', 'Execution requires the actively frozen contract and plan.');
      const count = contract.replicatePolicy.seeds.length * plan.conditions.length;
      if (contract.replicatePolicy.seeds.length > policy.maxSeeds || plan.conditions.length > policy.maxConditions
        || policy.resources.wallMs * count > operation.manifest.reservation.ms || count > operation.manifest.reservation.physical
        || plan.design && (policy.resources.wallMs * count > plan.design.resources.ms || count > plan.design.resources.physical))
        researchFail('TRSH1006', '/reservation', 'The whole replicate set must fit the stage and preregistered design budget.');
      if (policy.datasetPaths.length !== contract.datasets.length || !equalsJson(policy.datasetPaths.map(row => row.path).sort(), [...plan.inputPaths].sort()))
        researchFail('TRSH1009', '/inputs', 'Execution paths must exactly bind the frozen datasets and plan.');
      const files = [];
      for (const row of policy.datasetPaths) {
        const dataset = contract.datasets.find(dataset => dataset.id === row.datasetId);
        const ref = operation.frame.artifacts.find(ref => ref.artifactId === 'art-' + dataset?.sha256);
        if (!dataset || !ref) researchFail('TRSH1005', '/inputs', 'Execution cannot read a dataset outside the committed input manifest.');
        files.push({ path: row.path, bytes: await access.readArtifact(ref), role: 'input' as const, mode: 'read-only' as const });
      }
      const workspace = researchValue(await createResearchWorkspace({ projectId: contract.projectId, datasetIds: contract.datasets.map(row => row.id),
        splitIds: [...contract.splits.train, ...contract.splits.test], files: [...files, { path: 'evaluation/registry.json', bytes: evaluatorBytes, role: 'evaluator', mode: 'read-only' }] }));
      const inputs = [];
      for (const row of workspace.artifacts) inputs.push(await stage(operation, row.bytes, 'application/octet-stream'));
      const previous = snapshot.records.filter(row => row.kind === 'ExperimentBranch' && row.value.planHash === plan.planHash)
        .map(row => row.value as ExperimentBranch).sort((a, b) => b.attemptOrdinal - a.attemptOrdinal)[0];
      const data: ExecutionPreparation = { operation, contract, plan, workspace: workspace.manifest, inputs,
        branchId: 'branch-' + await researchRevisionOf({ attemptId: operation.attemptId, planHash: plan.planHash }), parentId: previous?.id ?? null };
      return { execution: await stage(operation, jsonBytes(data), PREPARATION_MEDIA), cursor: { seed: 0, condition: 0, conditionDone: false, done: false } };
    },
    async complete(operation, modelSpend, path, partial) {
      const current = await scope({ runId: operation.frame.projectId, path: path + '/commit' }, false);
      if (!equalsJson(current.data.operation, { ...operation, idempotencyKey: current.data.operation.idempotencyKey })) researchFail('TRSH1002', '/operation', 'Execution commit must consume the exact preparation.');
      const completed = current.trace.attempts.filter(row => row.kind === 'task' && row.invocationId === 'run' && row.status === 'completed'
        && row.path.startsWith(path + '/seeds/'));
      const artifacts: ResearchStageResult['artifacts'] = [], records: ResearchRecordWrite[] = [], receipts: ExperimentReceipt[] = [];
      const retain = async (ref: ResearchInputArtifact, mediaType?: string) => {
        const row = await artifact(operation, ref, mediaType); artifacts.push({ bytes: row.bytes, mediaType: row.admission.artifact.mediaType }); return row.bytes;
      };
      for (const ref of current.data.inputs) await retain(ref);
      records.push({ kind: 'WorkspaceManifest', value: current.data.workspace });
      for (const native of completed) {
        const ref = (native.output as { receipt: ResearchInputArtifact }).receipt;
        const receipt = JSON.parse(new TextDecoder().decode(await retain(ref, RECEIPT_MEDIA))) as ExperimentReceipt;
        const bytes = [];
        for (const ref of receipt.artifacts) bytes.push({ artifactId: ref.artifactId, bytes: await retain(ref) });
        const { workspace } = await executionWorkspace(current);
        if (!records.some(row => row.kind === 'WorkspaceManifest' && row.value.id === workspace.manifest.id)) records.push({ kind: 'WorkspaceManifest', value: workspace.manifest });
        if (receipt.manifest.branchId !== current.data.branchId) researchFail('TRSH1002', '/branchId', 'Native receipt names another execution branch.');
        if (receipt.run) {
          const result = researchValue(await validateResearchExecutionResult({ run: receipt.run, artifacts: bytes }, receipt.manifest, workspace, current.data));
          if (receipt.observations.length) researchValue(await registry.registerObservations({ result, manifest: receipt.manifest, workspace,
            contract: current.data.contract, plan: current.data.plan, hiddenLabels }, receipt.observations));
          records.push({ kind: 'ExperimentRun', value: receipt.run }, ...receipt.observations.map(value => ({ kind: 'MetricObservation' as const, value })));
        } else if (!receipt.error || receipt.observations.length) researchFail('TRSH1002', '/receipt', 'Unsettled experiments cannot contain evaluator observations.');
        records.push({ kind: 'ExecutionManifest', value: receipt.manifest }); receipts.push(receipt);
      }
      for (const code of await authored(current)) { records.push({ kind: 'ResearchCodeWrite', value: code }); artifacts.push({ bytes: new TextEncoder().encode(code.text), mediaType: 'text/javascript' }); }
      const total = cost([modelSpend, ...receipts.map(row => row.spend)]), expected = current.data.contract.replicatePolicy.seeds.length * current.data.plan.conditions.length;
      const error = receipts.find(row => row.error)?.error ?? (partial || receipts.length !== expected ? researchIssue('TRSH1008', '/execution', 'Execution stopped with an incomplete replicate set; completed receipts are retained.') : undefined);
      const branch: ExperimentBranch = { id: current.data.branchId, projectId: operation.frame.projectId, contractHash: current.data.contract.contractHash,
        planHash: current.data.plan.planHash, hypothesisHash: current.data.plan.hypothesisHash, parentId: current.data.parentId,
        attemptOrdinal: operation.frame.attempt + 1, status: error ? 'failed' : 'completed', runIds: receipts.flatMap(row => row.run ? [row.run.id] : []), spend: total };
      records.push({ kind: 'ExperimentBranch', value: branch });
      artifacts.push({ bytes: jsonBytes({ kind: 'execution-branch', branch, expected, attempted: receipts.length, failed: receipts.filter(row => row.error).length }), mediaType: 'application/json' });
      const unique = new Map(records.map(row => [row.kind + ':' + ('id' in row.value ? row.value.id : ''), row]));
      return { artifacts, records: [...unique.values()], spend: total, ...(error ? { error } : {}) };
    },
  };
  runtime.taskHandlers['research-experiment'] = wrap(async input => {
    const current = await scope(input), cursor = immutableResearchJson(input.value.cursor) as ResearchExecutionCursor;
    const { contract, plan, operation, branchId } = current.data;
    if (cursor.done || cursor.conditionDone || !Number.isSafeInteger(cursor.seed) || !Number.isSafeInteger(cursor.condition)
      || !contract.replicatePolicy.seeds.includes(contract.replicatePolicy.seeds[cursor.seed]) || !plan.conditions[cursor.condition])
      researchFail('TRSH1004', '/cursor', 'Execution cursor is outside its frozen replicate set.');
    const { workspace, codeArtifactId } = await executionWorkspace(current), condition = plan.conditions[cursor.condition];
    const manifest = researchValue(await buildExecutionManifest({ contract, plan, workspace, branchId, condition: condition.id,
      seed: contract.replicatePolicy.seeds[cursor.seed], imageDigest: policy.imageDigest, dependencyLockHash: policy.dependencyLockHash, resources: policy.resources,
      ...(codeArtifactId && condition.id === contract.successRule.condition ? { codeArtifactId } : {}) }));
    const receipt: ExperimentReceipt = { manifest, run: null, artifacts: [], observations: [], error: null,
      spend: { calls: 0, tokens: 0, ms: 0, physical: 1 } };
    try {
      const executed = await executor.run(manifest, workspace, { contract, plan, signal: input.signal });
      const result = researchValue(await validateResearchExecutionResult(researchValue(executed), manifest, workspace, current.data));
      receipt.run = result.run; receipt.spend = result.run.spend;
      for (const artifact of result.artifacts) receipt.artifacts.push(await stage(operation, artifact.bytes, 'application/octet-stream'));
      if (result.run.status === 'ok') receipt.observations = researchValue(await registry.evaluate({ result, manifest, workspace, contract, plan, hiddenLabels }));
      else receipt.error = result.run.error;
    } catch (cause) {
      if (cause instanceof MasInfrastructureCrash) throw cause;
      receipt.error = cause instanceof ResearchFailure ? cause.issue : researchIssue('TRSH1008', '/executor', 'Executor did not return a validated settlement.', cause);
    }
    const ref = await stage(operation, jsonBytes(receipt), RECEIPT_MEDIA);
    return { receipt: ref, cursor: { ...cursor, condition: cursor.condition + 1,
      conditionDone: !!receipt.error || cursor.condition + 1 === plan.conditions.length, done: !!receipt.error } };
  });
  runtime.taskHandlers['research-execution-advance'] = wrap(async input => {
    const current = await scope(input), cursor = immutableResearchJson(input.value.cursor) as ResearchExecutionCursor;
    if (!cursor.conditionDone) researchFail('TRSH1004', '/cursor', 'A seed cannot advance before its conditions settle.');
    return { cursor: { seed: cursor.seed + 1, condition: 0, conditionDone: false,
      done: cursor.done || cursor.seed + 1 === current.data.contract.replicatePolicy.seeds.length } };
  });
  runtime.taskHandlers['research-execution-seal'] = wrap(async input => {
    const current = await scope(input), author = current.trace.attempts.find(row => row.path === current.path + '/author' && row.status === 'completed');
    if (!author || !equalsJson((author.output as { out: unknown }).out, input.value.proposal)) researchFail('TRSH1005', '/proposal', 'Code seal requires the completed native author output.');
    const codes = await authored(current), entrypoint = (input.value.proposal as { entrypoint: string }).entrypoint;
    if (!codes.some(row => row.path === entrypoint) || codes.some(row => row.staticIssues.length)) researchFail('TRSH1010', '/code', 'Code entrypoint is missing or its static checks refused execution.');
    return { cursor: input.value.cursor };
  });
  runtime.toolBindings = policy.mode === 'authored' ? createResearchAuthorTools({ store, policy, scope: async invocation => {
    const current = await scope(invocation);
    if (invocation.path !== current.path + '/author') researchFail('TRSH1005', '/invocation', 'Only the native code-author node may access this toolbox.');
    return { operation: current.data.operation, contract: current.data.contract, plan: current.data.plan, workspace: current.workspace };
  } }) : {};
  return { ...base, execution: runtime };
}
