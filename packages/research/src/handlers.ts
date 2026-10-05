import { canonicalizeJson } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { MasTaskRefusal, MasInfrastructureCrash, interactionIdOf, type MasTaskInput, type MasTaskHandlerBinding, type MasStore } from '@tangleai/mas';
import type { ResearchStore } from './store.ts';
import type { ResearchRecordWrite } from './records.ts';
import type { ResearchContract, ExperimentPlan, ResearchWorkflowFrame, ResearchLifecycle, ResearchCost, ResearchIssue,
  ResearchGateResponse, InputManifest, StageAttempt, StageCommitReceipt, ResearchInputArtifact, ResearchState, ArtifactAdmission, ResearchArtifact, ResearchDirective } from './contracts.gen.ts';
import { immutableResearchJson, copyResearchBytes, inputManifestHashOf, stageAttemptIdOf, researchRevisionOf } from './identity.ts';
import { researchIssue, type ResearchOutcome } from './errors.ts';
import { validateResearchShape } from './schema.ts';
import { planContractFreeze, planStageCommit } from './transitions.ts';
import { inputManifestOf, researchFrameInputs } from './manifest.ts';
import { gateReviewOf, checkResearchGate } from './gates.ts';
import { ResearchFailure, researchFail, researchValue, researchProjectHash, type ResearchWorkflowBinding } from './workflow-contract.ts';
import { RESEARCH_STAGES, type ResearchStageName } from './workflow.ts';
import { RESEARCH_MODEL_STAGES, researchNativeCost, researchPreparationFor,
  type ResearchReasoningRuntime, type ResearchPreparation, type ResearchModelStage, type ResearchHandlerAdmission } from './reasoning-contract.ts';
import { createResearchReadTools } from './tools.ts';
import { researchIntervention, planHumanCommand } from './commands.ts';
import { researchGateEditor, RESEARCH_DIRECTIVE_MEDIA } from './directives.ts';

import { RESEARCH_FRAME_MEDIA_TYPE, restoredResearchFrame as restoredFrame, resolveResearchFrame, researchWireFrame } from './frames.ts';
import type { ResearchExecutionRuntime } from './execution-contract.ts';
import type { ResearchAnalysisRuntime } from './analysis-contract.ts';
import type { ResearchWritingRuntime } from './writing-contract.ts';
export { RESEARCH_FRAME_MEDIA_TYPE } from './frames.ts';
const zero: ResearchCost = { calls: 0, tokens: 0, ms: 0, physical: 0 };
const stages: Record<ResearchStageName, ResearchLifecycle> = { create: 'CREATED', discovery: 'DISCOVERY', literature: 'LITERATURE_GATE',
  synthesis: 'SYNTHESIS', hypothesis: 'HYPOTHESIS_GATE', design: 'DESIGN', 'design-approval': 'DESIGN_GATE', execute: 'EXECUTE',
  analyze: 'ANALYZE', decide: 'DECIDE', write: 'WRITE', verify: 'VERIFY', quality: 'QUALITY_GATE' };
const next: Partial<Record<ResearchStageName, ResearchLifecycle>> = { create: 'DISCOVERY', discovery: 'LITERATURE_GATE',
  synthesis: 'HYPOTHESIS_GATE', hypothesis: 'DESIGN', design: 'DESIGN_GATE', execute: 'ANALYZE', analyze: 'DECIDE', write: 'VERIFY', verify: 'QUALITY_GATE' };
const gates = { literature: 'literature', 'design-approval': 'design', quality: 'quality' } as const;
export interface ResearchStageOperation {
  stage: ResearchStageName;
  path: string;
  idempotencyKey: string;
  frame: ResearchWorkflowFrame;
  manifest: InputManifest;
  attemptId: string;
  expectedState: ResearchState;
}
export interface ResearchStageResult {
  artifacts: Array<{ bytes: Uint8Array; mediaType: string }>;
  records: ResearchRecordWrite[];
  spend: ResearchCost;
  decision?: 'Proceed' | 'Refine' | 'Pivot' | 'Stop';
  error?: ResearchIssue;
  preregistration?: import('./transitions.ts').ResearchPreregistration;
}
export interface ResearchStageAccess {
  signal: AbortSignal;
  /** Only exact committed admissions from this operation's manifest are readable. */
  readArtifact(ref: ResearchInputArtifact): Promise<Uint8Array>;
  describeArtifact(ref: ResearchInputArtifact): Promise<ResearchArtifact>;
}
export interface ResearchTaskTools {
  binding: ResearchWorkflowBinding;
  contract: ResearchContract;
  plan: ExperimentPlan;
  masStore: Pick<MasStore, 'getInteraction' | 'readTrace'>;
  reasoning?: ResearchReasoningRuntime;
  execution?: ResearchExecutionRuntime;
  analysis?: ResearchAnalysisRuntime;
  writing?: ResearchWritingRuntime;
  execute(operation: ResearchStageOperation, access: ResearchStageAccess): Promise<ResearchStageResult>;
  /** Independent deterministic verification, outside the executing stage body. */
  verify(operation: ResearchStageOperation, result: ResearchStageResult, access: ResearchStageAccess): Promise<ResearchOutcome<null>>;
  /** Host crash-injection/telemetry seam; never stored as content. */
  onOperation?(step: string, operation: ResearchStageOperation): void;
}
export interface ResearchTaskHandlers extends Record<string, MasTaskHandlerBinding> { }
const admissions = new WeakMap<ResearchTaskHandlers, { binding: ResearchWorkflowBinding; store: ResearchStore } & ResearchHandlerAdmission>();
export function researchHandlerAdmission(handlers: ResearchTaskHandlers) { return admissions.get(handlers); }

function refOf(row: { id: string; artifact: { id: string } }): ResearchInputArtifact { return { artifactId: row.artifact.id, admissionId: row.id }; }
function resultSnapshot(result: ResearchStageResult): ResearchStageResult {
  const { artifacts, ...data } = result;
  const snapshot = immutableResearchJson(data);
  researchValue(validateResearchShape('ResearchCost', snapshot.spend));
  return { ...snapshot, artifacts: artifacts.map(a => {
    if (typeof a.mediaType !== 'string' || !a.mediaType || a.mediaType === RESEARCH_FRAME_MEDIA_TYPE)
      researchFail('TRSH1001', '/artifacts/mediaType', 'Stage artifacts need a media type; the recovery frame type is reserved.');
    return { mediaType: a.mediaType, bytes: copyResearchBytes(a.bytes) };
  }) };
}
/** Stage admission, execution, independent verification and a single research-store commit. */
export function createResearchTaskHandlers(store: ResearchStore, tools: ResearchTaskTools): ResearchTaskHandlers {
  const binding = immutableResearchJson(tools.binding), contract = immutableResearchJson(tools.contract), experiment = immutableResearchJson(tools.plan);
  if (binding.contractHash !== contract.contractHash || experiment.contractHash !== contract.contractHash)
    researchFail('TRSH1002', '/binding', 'Handlers and experiment must use the pinned contract.');
  // Function capabilities are captured once; caller mutation cannot replace a body on resume.
  const execute = tools.execute, verify = tools.verify, onOperation = tools.onOperation, masStore = tools.masStore;
  const reasoning = tools.reasoning ? { ...tools.reasoning, policy: immutableResearchJson(tools.reasoning.policy) } : undefined;
  const execution = tools.execution ? { ...tools.execution, policy: immutableResearchJson(tools.execution.policy), taskHandlers: { ...tools.execution.taskHandlers }, toolBindings: { ...tools.execution.toolBindings } } : undefined;
  const analysis = tools.analysis ? { ...tools.analysis, policy: immutableResearchJson(tools.analysis.policy) } : undefined;
  const writing = tools.writing ? { ...tools.writing, policy: immutableResearchJson(tools.writing.policy) } : undefined;
  const compactFrames = !!(reasoning || execution);
  const nativeMode = (stage: string) => stage === 'write' ? writing!.policy.mode === 'agent' ? 'single-agent' : 'scripted'
    : stage === 'decide' || stage === 'verify' ? 'debate' : stage === 'execute'
    ? execution!.policy.mode === 'authored' ? 'single-agent' : 'scripted' : reasoning!.policy.mode;
  const handlers: ResearchTaskHandlers = { ...execution?.taskHandlers };
  handlers['research-refuse'] = () => { throw new MasTaskRefusal({ code: 'TMAS2004', detail: 'Research control input has no registered lifecycle edge.',
    cause: { code: 'TRSH1004', docPath: '/frame/status', message: 'Research control input has no registered lifecycle edge.' } }); };
  handlers['research-relay'] = input => ({ frame: researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', input.value.frame)) });
  handlers['research-auto-gate'] = async input => {
    const frame = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', input.value.frame));
    const snapshot = researchValue(await store.snapshot(input.runId)), native = await masStore.readTrace(input.runId);
    if (!snapshot || snapshot.project.mode !== 'full-auto' || snapshot.project.experimental !== true
      || frame.projectId !== input.runId || frame.projectHash !== await researchProjectHash(snapshot.project)
      || frame.bindingId !== binding.id || frame.status !== snapshot.state.status
      || native?.run.status !== 'running' || !native.attempts.some(row => row.path === input.path
        && row.idempotencyKey === input.idempotencyKey && row.kind === 'task' && row.status === 'running'))
      researchFail('TRSH1005', '/mode', 'Automatic approval requires its explicit experimental project and running native task.');
    const kind = input.node === 'literature-gate' ? 'literature' : input.node === 'design-gate' ? 'design' : input.node === 'quality-gate' ? 'quality' : null;
    if (!kind) researchFail('TRSH1005', '/node', 'Unknown automatic research gate.');
    const review = await checkResearchGate(frame, kind);
    if (review.stateRevision !== snapshot.state.revision || review.artifacts.some(ref => !snapshot.committedAdmissionIds.includes(ref.admissionId)
      || !snapshot.artifacts.some(row => row.id === ref.admissionId && row.artifact.id === ref.artifactId)))
      researchFail('TRSH1005', '/gate', 'Automatic approval requires the exact current committed review.');
    return { response: { decision: 'approve', approvedManifestHash: review.manifestHash,
      actor: 'full-auto', note: 'Explicit experimental automatic approval.' } satisfies ResearchGateResponse };
  };
  const bind = (name: ResearchStageName, phase: 'stage' | 'prepare' | 'commit' = 'stage'): MasTaskHandlerBinding => async input => {
    try { return await runStage(name, input, phase); }
    catch (cause) {
      if (cause instanceof MasInfrastructureCrash || cause instanceof MasTaskRefusal) throw cause;
      const issue = cause instanceof ResearchFailure ? cause.issue : researchIssue('TRSH1008', '', 'Research stage failed.', cause);
      throw new MasTaskRefusal({ code: 'TMAS2004', detail: issue.detail, cause: { code: issue.code, docPath: issue.path, message: issue.detail } });
    }
  };
  for (const name of RESEARCH_STAGES) handlers['research-' + name] = bind(name);
  if (reasoning) for (const name of RESEARCH_MODEL_STAGES) {
    handlers['research-prepare-' + name] = bind(name, 'prepare'); handlers['research-commit-' + name] = bind(name, 'commit');
  }
  if (execution) { handlers['research-prepare-execute'] = bind('execute', 'prepare'); handlers['research-commit-execute'] = bind('execute', 'commit'); }
  if (analysis) { handlers['research-prepare-decide'] = bind('decide', 'prepare'); handlers['research-commit-decide'] = bind('decide', 'commit'); }
  if (writing) for (const name of ['write', 'verify'] as const) {
    handlers['research-prepare-' + name] = bind(name, 'prepare'); handlers['research-commit-' + name] = bind(name, 'commit');
  }
  admissions.set(handlers, { binding, store, ...(reasoning ? { reasoning: reasoning.policy } : {}),
    ...(execution ? { execution: execution.policy } : {}), ...(analysis ? { analysis: analysis.policy } : {}), ...(writing ? { writing: writing.policy } : {}), ...(reasoning || execution || analysis || writing ? { reconcileFailure, toolBindings: {
      ...(reasoning ? createResearchReadTools({ researchStore: store, masStore, maxCards: reasoning.policy.maxCards, contract, mode: reasoning.policy.mode }) : {}),
      ...execution?.toolBindings,
    } } : {}) });
  return Object.freeze(handlers);

  async function reconcileFailure(runId: string, failure: import('@tangleai/mas').MasRun['failure']) {
    if ((!reasoning && !execution && !analysis && !writing) || !failure) return;
    const trace = await masStore.readTrace(runId), snapshot = researchValue(await store.snapshot(runId));
    if (!trace || !snapshot || snapshot.state.status === 'STOPPED' || snapshot.state.status === 'COMPLETE') return;
    const native = failure.error;
    const nativeIssue: ResearchIssue = native.cause && /^TRSH10(0[1-9]|10)$/.test(native.cause.code)
      ? { code: native.cause.code, path: native.cause.docPath, detail: native.cause.message }
      : researchIssue('TRSH1008', native.cause?.docPath ?? '', 'Native research workflow failed.', native.cause ?? native);
    const prepared = trace.attempts.filter(row => row.kind === 'task' && row.invocationId === 'prepare' && row.status === 'completed')
      .map(row => (row.output as { preparation?: ResearchPreparation } | null)?.preparation)
      .filter((row): row is ResearchPreparation => !!row).reverse();
    for (const preparation of prepared) {
      if (snapshot.attempts.some(row => row.attempt.masPath === preparation.commitPath)) continue;
      if (snapshot.state.status !== preparation.frame.status || snapshot.state.revision !== preparation.stateRevision)
        researchFail('TRSH1004', '/failure', 'Native failure does not match the outstanding prepared research stage.');
      const manifest = researchValue(await store.getRecord(runId, 'InputManifest', 'manifest-' + preparation.manifestHash));
      if (!manifest) researchFail('TRSH1003', '/manifest', 'Failed model work must retain its admitted manifest.');
      let spend = researchNativeCost(trace.attempts, preparation.scope);
      const expanded = compactFrames ? await resolveResearchFrame(store, preparation.frame) : preparation.frame;
      const retained = preparation.stage === 'execute' && execution ? await execution.complete({ stage: 'execute', path: preparation.commitPath,
        idempotencyKey: '', frame: expanded, manifest, attemptId: preparation.attemptId, expectedState: snapshot.state }, spend, preparation.scope, true)
        : writing && ['write', 'verify'].includes(preparation.stage) ? { spend, records: [], artifacts: [{
          mediaType: 'application/vnd.tangleai.research-native-writing-failure+json', bytes: new TextEncoder().encode(canonicalizeJson({
            kind: 'native-writing-failure', scope: preparation.scope, preparation, failure,
            attempts: trace.attempts.filter(row => row.path.startsWith(preparation.scope + '/')) })) }] } : null;
      if (retained) spend = retained.spend;
      const key = { projectId: runId, stage: preparation.frame.status,
        attemptOrdinal: Math.max(0, ...snapshot.attempts.filter(row => row.attempt.stage === preparation.frame.status).map(row => row.attempt.attemptOrdinal)) + 1,
        inputManifestHash: preparation.manifestHash };
      if (await stageAttemptIdOf(key) !== preparation.attemptId) researchFail('TRSH1002', '/attemptId', 'Prepared failed-attempt identity changed.');
      let issue = nativeIssue;
      for (const dimension of ['calls', 'tokens', 'ms', 'physical'] as const)
        if (spend[dimension] > manifest.reservation[dimension]
          || snapshot.attempts.reduce((total, row) => total + row.attempt.spend[dimension], spend[dimension]) > snapshot.project.budget[dimension])
          issue = researchIssue('TRSH1006', '/spend/' + dimension, 'Failed native work exceeded the admitted budget; its actual cost is retained.', native);
      const retainedOutputs: ArtifactAdmission[] = [];
      if (retained) {
        const parents = researchFrameInputs(expanded), descriptor = { projectId: runId, attempt: key, verification: 'verified' as const,
          parents: parents.length ? parents : [{ artifactId: runId, admissionId: null }] };
        for (const output of retained.artifacts) {
          const row = researchValue(await store.stageArtifact(output.bytes, { ...descriptor, mediaType: output.mediaType }));
          if (!retainedOutputs.some(value => value.id === row.id)) retainedOutputs.push(row);
        }
        const stopped = { ...expanded, status: 'STOPPED', decision: 'Stop', gate: null, response: null, checkpoint: null,
          artifacts: [...new Map([...expanded.artifacts, ...retainedOutputs.map(refOf)].map(ref => [ref.admissionId, ref])).values()].sort((a, b) => a.admissionId.localeCompare(b.admissionId)) };
        retainedOutputs.push(researchValue(await store.stageArtifact(new TextEncoder().encode(canonicalizeJson(stopped)), { ...descriptor, mediaType: RESEARCH_FRAME_MEDIA_TYPE })));
      }
      const attempt: StageAttempt = { ...key, id: preparation.attemptId, masPath: preparation.commitPath,
        promptRevision: binding.promptRevision, runIdentityId: binding.runIdentityId, toolVersions: binding.toolVersions,
        spend, stopReason: 'failed', interventions: [], outputArtifactIds: [...new Set(retainedOutputs.map(row => row.artifact.id))].sort(), error: issue,
        mode: nativeMode(preparation.stage) };
      researchValue(await store.commitStage(researchValue(await planStageCommit({ state: snapshot.state, attempt, manifest, nextStatus: 'STOPPED', artifactAdmissionIds: retainedOutputs.map(row => row.id), records: retained?.records ?? [] }))));
      return;
    }
    // Admission and control failures can happen between model stages. The last
    // committed frame owns those inputs; already receipted model spend stays put.
    const latest = snapshot.attempts.find(row => row.nextState.revision === snapshot.state.revision);
    const frame = latest ? await restoredFrame(store, latest)
      : researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', (trace.run.input as { frame?: unknown }).frame));
    if (frame.status !== snapshot.state.status || frame.projectId !== runId || frame.bindingId !== binding.id)
      researchFail('TRSH1004', '/failure', 'Native failure does not match the current committed research frame.');
    const manifest = await inputManifestOf(frame.status, frame, binding.promptRevision, binding.runIdentityId, binding.toolVersions, binding.evaluator, zero);
    const key = { projectId: runId, stage: frame.status,
      attemptOrdinal: Math.max(0, ...snapshot.attempts.filter(row => row.attempt.stage === frame.status).map(row => row.attempt.attemptOrdinal)) + 1,
      inputManifestHash: await inputManifestHashOf(manifest) };
    const failedRoot = [...trace.attempts].reverse().find(row => row.status !== 'completed'
      && (row.path === failure.node || row.invocationId === failure.node));
    const path = failedRoot && [...trace.attempts].reverse().find(row => row.status !== 'completed'
      && (row.path === failedRoot.path || row.path.startsWith(failedRoot.path + '/')))?.path;
    const attempt: StageAttempt = { ...key, id: await stageAttemptIdOf(key),
      masPath: path && !snapshot.attempts.some(row => row.attempt.masPath === path) ? path : 'run-failure/' + snapshot.state.revision,
      promptRevision: binding.promptRevision, runIdentityId: binding.runIdentityId, toolVersions: binding.toolVersions,
      spend: zero, stopReason: 'failed', interventions: [], outputArtifactIds: [], error: nativeIssue, mode: 'scripted' };
    researchValue(await store.commitStage(researchValue(await planStageCommit({ state: snapshot.state, attempt, manifest,
      nextStatus: 'STOPPED', artifactAdmissionIds: [] }))));
  }

  async function runStage(name: ResearchStageName, input: MasTaskInput, phase: 'stage' | 'prepare' | 'commit') {
    const supplied = input.value.preparation as ResearchPreparation | undefined;
    const wire = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', phase === 'commit' ? supplied?.frame : input.value.frame));
    const original = compactFrames ? await resolveResearchFrame(store, wire) : wire;
    const kind = name in gates ? gates[name as keyof typeof gates] : null;
    const response = kind ? researchValue(validateResearchShape<ResearchGateResponse>('ResearchGateResponse', input.value.response)) : null;
    const frame = immutableResearchJson({ ...original, response });
    if (frame.projectId !== input.runId || frame.bindingId !== binding.id
      || !equalsJson(frame.lessonProcedure ?? null, binding.lessonProcedure ?? null))
      researchFail('TRSH1004', '/frame', 'The incoming frame belongs to another native run, plan or stack.');
    if (frame.status !== stages[name]) researchFail('TRSH1004', '/frame/status', 'The task does not implement this incoming stage.');
    const manifest = await inputManifestOf(frame.status, frame, binding.promptRevision, binding.runIdentityId,
      binding.toolVersions, binding.evaluator, binding.reservation);
    const manifestHash = await inputManifestHashOf(manifest);
    const snapshot = researchValue(await store.snapshot(frame.projectId));
    if (!snapshot) researchFail('TRSH1003', '/projectId', 'Host must create the research project before starting MAS.');
    if (frame.projectHash !== await researchProjectHash(snapshot.project)) researchFail('TRSH1004', '/frame/projectHash', 'Root project content changed.');
    // Native completion may lag this atomic receipt; consult the path before deriving an ordinal.
    const scope = input.path.slice(0, -(input.node.length + 1)), commitPath = phase === 'prepare' ? scope + '/commit' : input.path;
    const prior = snapshot.attempts.find(row => row.attempt.masPath === commitPath);
    if (prior) {
      if (prior.attempt.inputManifestHash !== manifestHash || prior.attempt.stage !== frame.status)
        researchFail('TRSH1004', '/inputManifestHash', 'A committed MAS path cannot resume with changed content.');
      if (prior.attempt.error) throw new ResearchFailure(prior.attempt.error);
      return { frame: researchWireFrame(await restoredFrame(store, prior), compactFrames) };
    }
    const native = await masStore.readTrace(input.runId);
    if (native?.run.status !== 'running' || !native.attempts.some(a => a.status === 'running' && a.kind === 'task'
      && a.path === input.path && a.invocationId === input.node && a.idempotencyKey === input.idempotencyKey))
      researchFail('TRSH1004', '/masPath', 'New stage work requires its running native MAS task attempt.');
    if (frame.planHash !== (snapshot.state.planHash ?? experiment.planHash)) researchFail('TRSH1004', '/frame/planHash', 'Incoming frame differs from the active frozen plan.');
    if (snapshot.state.status !== frame.status) researchFail('TRSH1004', '/frame/status', 'Research projection has advanced; this is not a new admitted stage.');
    if (name === 'create' && (frame.pivot !== 0 || frame.attempt !== 0 || frame.review !== 0 || frame.artifacts.length
      || frame.checkpoint !== null || frame.gate !== null || frame.response !== null || frame.decision !== null))
      researchFail('TRSH1004', '/frame', 'The root stage starts with empty evidence and zero loop counters.');
    for (const ref of researchFrameInputs(frame)) {
      const admission = snapshot.artifacts.find(row => row.id === ref.admissionId);
      if (!admission || admission.artifact.id !== ref.artifactId || !snapshot.committedAdmissionIds.includes(ref.admissionId))
        researchFail('TRSH1005', '/manifest/inputs', 'Stage input must name a committed admission in this project.');
    }
    let state = snapshot.state;
    const activeContract = state.contractHash ? snapshot.records.find(row => row.kind === 'ResearchContract' && row.value.contractHash === state.contractHash)?.value as ResearchContract | undefined : contract;
    if (!activeContract) researchFail('TRSH1003', '/contractHash', 'The active frozen contract is unavailable.');
    if (name === 'create' && !reasoning) state = researchValue(await store.freezeContract(researchValue(await planContractFreeze(state, contract, experiment,
      snapshot.records.filter(r => r.kind === 'MetricObservation').map(r => r.id)))));
    const key = { projectId: frame.projectId, stage: frame.status,
      attemptOrdinal: Math.max(0, ...snapshot.attempts.filter(row => row.attempt.stage === frame.status).map(row => row.attempt.attemptOrdinal)) + 1,
      inputManifestHash: manifestHash };
    const attempt: StageAttempt = { ...key, id: await stageAttemptIdOf(key), masPath: commitPath,
      promptRevision: binding.promptRevision, runIdentityId: binding.runIdentityId, toolVersions: binding.toolVersions,
      spend: zero, stopReason: 'completed', interventions: [], outputArtifactIds: [], error: null, mode: phase === 'stage' ? 'scripted' : nativeMode(name) };
    const operation: ResearchStageOperation = immutableResearchJson({ stage: name, path: commitPath, idempotencyKey: input.idempotencyKey,
      frame, manifest, attemptId: attempt.id, expectedState: state });
    const admitted = async (requested: ResearchInputArtifact) => {
      const ref = immutableResearchJson(requested);
      if (!researchFrameInputs(frame).some(r => equalsJson(r, ref))) researchFail('TRSH1005', '/artifact', 'Stage read is outside its declared manifest.');
      const row = researchValue(await store.readArtifact(frame.projectId, ref.admissionId));
      if (row.admission.artifact.id !== ref.artifactId) researchFail('TRSH1002', '/artifact', 'Input content address differs from its admitted reference.');
      return row;
    };
    const access: ResearchStageAccess = { signal: input.signal,
      readArtifact: async ref => copyResearchBytes((await admitted(ref)).bytes),
      describeArtifact: async ref => immutableResearchJson((await admitted(ref)).admission.artifact) };
    onOperation?.('planned', operation);
    const preparation: ResearchPreparation = { stage: name as ResearchPreparation['stage'], scope, commitPath,
      manifestHash, attemptId: attempt.id, stateRevision: state.revision, frame: researchWireFrame(frame, compactFrames) };
    if (phase === 'prepare') {
      for (const dimension of ['calls', 'tokens', 'ms', 'physical'] as const)
        if (snapshot.attempts.reduce((total, row) => total + row.attempt.spend[dimension], manifest.reservation[dimension]) > snapshot.project.budget[dimension])
          researchFail('TRSH1006', '/reservation/' + dimension, 'The project cannot admit this model stage reservation.');
      researchValue(await store.putRecord(frame.projectId, { kind: 'InputManifest', value: manifest }));
      if (name === 'execute' && execution) {
        const prepared = await execution.prepare(operation, access); onOperation?.('prepared', operation); return { preparation, ...prepared };
      }
      if (name === 'decide' && analysis) {
        const prepared = await analysis.prepare(operation, access); onOperation?.('prepared', operation); return { preparation, ...prepared };
      }
      if (writing && (name === 'write' || name === 'verify')) {
        const prepared = await writing.prepare(operation, access); onOperation?.('prepared', operation); return { preparation, ...prepared };
      }
      const prepared = await reasoning!.prepare(operation, access); onOperation?.('prepared', operation);
      return { preparation, ...(reasoning!.policy.mode === 'debate' && name !== 'design' ? { input: prepared.input } : { variables: prepared.variables }) };
    }
    let result: ResearchStageResult = { artifacts: [], records: [], spend: zero };
    let carriedInputs = frame.artifacts;
    let retainedFailure: ResearchIssue | undefined;
    let acceptedGate: { id: string; at: string } | undefined;
    let verifiedWriting = false;
    let target: ResearchLifecycle, nextFrame: ResearchWorkflowFrame = { ...frame, checkpoint: null, response: null, gate: null };
    delete nextFrame.guidanceHash;
    try {
      if (kind) {
        const gate = await checkResearchGate(original, kind);
        if (gate.stateRevision !== state.revision || response!.approvedManifestHash !== gate.manifestHash)
          researchFail('TRSH1004', '/response/approvedManifestHash', 'Response does not approve the current reviewed artifact set.');
        const node = kind + '-gate', path = input.path.slice(0, -input.node.length) + node;
        let id: string, at: string;
        if (snapshot.project.mode === 'full-auto') {
          const automatic = native.attempts.find(row => row.path === path && row.kind === 'task' && row.status === 'completed');
          if (!snapshot.project.experimental || !automatic || response!.actor !== 'full-auto' || response!.decision !== 'approve'
            || response!.command || !equalsJson((automatic.output as { response?: unknown })?.response, response))
            researchFail('TRSH1005', '/response', 'Automatic approval must be the exact completed native gate task.');
          id = 'intervention-' + await researchRevisionOf({ path, key: automatic.idempotencyKey }); at = automatic.finishedAt!;
        } else {
          const interaction = await masStore.getInteraction(interactionIdOf(input.runId, path));
          if (!interaction || interaction.status !== 'responded' || response!.actor === 'full-auto'
            || !equalsJson(interaction.response, response) || !equalsJson(interaction.prompt, original))
            researchFail('TRSH1005', '/response', 'Stage response must be the durable native interaction response.');
          id = researchValue(validateResearchShape<string>('ResearchId', interaction.responseKey)); at = interaction.resolvedAt!;
          if (response!.command) {
            const planned = await planHumanCommand(native, response!.command);
            if (!planned.ok || planned.value.interactionId !== interaction.id || !equalsJson(planned.value.response, response))
              researchFail('TRSH1005', '/command', 'The durable response must reproduce its exact attributable command.');
          }
        }
        if ((response!.decision === 'edit' || response!.decision === 'guide') && !response!.command)
          researchFail('TRSH1005', '/command', 'Edits and guidance require an attributable typed command.');
        if (response!.target && (kind === 'literature' || kind === 'design' && response!.target !== 'design'))
          researchFail('TRSH1004', '/target', 'The requested retry has no input at this gate.');
        const substantive = ['reject', 'edit', 'guide'].includes(response!.decision);
        const used = snapshot.records.filter(row => row.kind === 'Intervention' && row.value.substantive).length;
        const exhausted = used + 1 >= activeContract.reviewCap || kind === 'quality' && frame.review >= activeContract.reviewCap;
        if (response!.decision === 'stop' || substantive && exhausted
          || response!.decision === 'reject' && kind !== 'quality' && !response!.target) target = 'STOPPED';
        else if (substantive) target = kind === 'literature' ? 'SYNTHESIS' : (response!.target ?? (kind === 'design' ? 'design' : 'write')).toUpperCase() as ResearchLifecycle;
        else target = kind === 'literature' ? 'SYNTHESIS' : kind === 'design' ? 'EXECUTE' : 'COMPLETE';
        acceptedGate = { id, at };
        let edit: ResearchDirective['edit'] = null;
        const command = response!.command;
        if (command?.kind === 'edit' && target !== 'STOPPED') {
          if (!gate.artifacts.some(ref => ref.artifactId === command.artifactId && ref.admissionId === command.admissionId))
            researchFail('TRSH1005', '/artifactId', 'The edited artifact was not reviewed at this gate.');
          const editor = await researchGateEditor(store, frame.projectId, command, key);
          const preview = researchValue(await editor.preview(command.patch)), staged = researchValue(await editor.commit(command.patch));
          const source = { artifactId: command.artifactId, admissionId: command.admissionId };
          edit = command.target === 'design' ? { kind: 'design', source, staged: refOf(staged),
            candidate: researchValue(validateResearchShape('ResearchEditableDesign', preview.candidate)) }
            : { kind: 'write', source, staged: refOf(staged), candidate: researchValue(validateResearchShape('ResearchEditableDraft', preview.candidate)) };
        }
        const intervention = await researchIntervention({ frame: original, response: response!, id, at, target,
          editedArtifactId: edit?.staged.artifactId ?? null });
        result.records.push({ kind: 'Intervention', value: intervention });
        result.artifacts.push({ bytes: new TextEncoder().encode(canonicalizeJson({ responseKey: id, response, intervention })), mediaType: 'application/json' });
        attempt.interventions = [id];
        if (substantive && target !== 'STOPPED') {
          const directive = researchValue(validateResearchShape<ResearchDirective>('ResearchDirective', { kind: 'research-directive',
            interventionId: id, stage: target, stateRevision: state.revision + 1, text: response!.note,
            guidanceHash: intervention.effect!.guidanceHash, edit }));
          result.artifacts.push({ bytes: new TextEncoder().encode(canonicalizeJson(directive)), mediaType: RESEARCH_DIRECTIVE_MEDIA });
          if (directive.guidanceHash) nextFrame.guidanceHash = directive.guidanceHash;
          nextFrame.decision = null;
          if (target === 'ANALYZE' || target === 'DESIGN' || target === 'SYNTHESIS') delete nextFrame.decisionId;
        }
        if (reasoning && kind === 'literature' && target === 'SYNTHESIS') carriedInputs = await reasoning.retainLiteratureInputs(operation, access);
      } else {
        if (phase === 'commit') {
          result.spend = researchNativeCost(native.attempts, scope);
          const retained = await researchPreparationFor(masStore, input);
          if (!equalsJson(retained, preparation) || !equalsJson(supplied, retained))
            researchFail('TRSH1005', '/preparation', 'Commit must consume its exact retained native preparation.');
          if (name === 'execute' && execution) result = resultSnapshot(await execution.complete(operation, result.spend, scope, false));
          else if (name === 'decide' && analysis) {
            const model = native.attempts.find(row => row.path === scope + '/model' && row.status === 'completed');
            if (!model || !equalsJson((model.output as { result: unknown }).result, input.value.proposal))
              researchFail('TRSH1005', '/proposal', 'Decision requires its exact completed native peer-review result.');
            result = resultSnapshot(await analysis.complete(operation, access, input.value.proposal, result.spend));
          }
          else if (writing && (name === 'write' || name === 'verify')) {
            const model = native.attempts.find(row => row.path === scope + '/model' && row.status === 'completed');
            const port = name === 'write' ? 'out' : 'result';
            if (!model || !equalsJson((model.output as Record<string, unknown>)[port], input.value.proposal))
              researchFail('TRSH1005', '/proposal', 'Writing requires its exact completed native proposal or deterministic refusal.');
            result = resultSnapshot(await writing.complete(operation, access, input.value.proposal, result.spend));
          }
          else {
          const model = native.attempts.find(row => row.path === scope + '/model' && row.status === 'completed');
          const port = reasoning!.policy.mode === 'debate' && name !== 'design' ? 'result' : 'out';
          if (!model || !equalsJson((model.output as Record<string, unknown>)[port], input.value.proposal))
            researchFail('TRSH1005', '/proposal', 'Commit requires the exact completed native model output.');
          result = resultSnapshot(await reasoning!.complete(operation, access, input.value.proposal, result.spend,
            async plan => { researchValue(await store.putRecord(frame.projectId, { kind: 'QueryPlan', value: plan })); }));
          result.artifacts.push({ mediaType: 'application/json', bytes: new TextEncoder().encode(canonicalizeJson({ kind: 'native-reasoning-trajectory',
            scope, attempts: native.attempts.filter(row => row.kind === 'agent' && row.path.startsWith(scope + '/')) })) });
          }
        } else result = resultSnapshot(await execute(operation, access));
        onOperation?.('executed', operation);
        if (writing && (name === 'write' || name === 'verify')) {
          researchValue(await verify(operation, resultSnapshot(result), access)); verifiedWriting = true;
        }
        if (result.error) throw new ResearchFailure(result.error);
        if (!verifiedWriting && !(name === 'execute' && execution && phase === 'commit')) researchValue(await verify(operation, resultSnapshot(result), access));
        onOperation?.('verified', operation);
        if (name === 'decide') {
          if (!result.decision || !['Proceed', 'Refine', 'Pivot', 'Stop'].includes(result.decision)) researchFail('TRSH1001', '/decision', 'Decision stage must produce a registered edge.');
          const bounded = result.decision === 'Refine' && frame.attempt >= activeContract.attemptCap
            || result.decision === 'Pivot' && frame.pivot >= activeContract.pivotCap ? 'Stop' : result.decision;
          if (analysis && bounded !== result.decision) researchFail('TRSH1006', '/decision', 'The deterministic decision must terminate explicitly at its declared cap.');
          nextFrame.decision = bounded;
          const decisionRecord = result.records.find(row => row.kind === 'ResearchDecision');
          if (decisionRecord?.kind === 'ResearchDecision') nextFrame.decisionId = decisionRecord.value.id;
          target = bounded === 'Proceed' ? 'WRITE' : bounded === 'Refine' ? 'EXECUTE' : bounded === 'Pivot' ? 'SYNTHESIS' : 'STOPPED';
        } else target = next[name]!;
        if (name === 'synthesis') { nextFrame.pivot++; nextFrame.attempt = 0; nextFrame.decision = null; }
        if (name === 'execute') nextFrame.attempt++;
        if (name === 'write') nextFrame.review++;
      }
      if (target === 'STOPPED') nextFrame.decision = 'Stop';
      for (const dimension of ['calls', 'tokens', 'ms', 'physical'] as const)
        if (result.spend[dimension] > manifest.reservation[dimension]
          || snapshot.attempts.reduce((total, row) => total + row.attempt.spend[dimension], result.spend[dimension]) > snapshot.project.budget[dimension])
          researchFail('TRSH1006', '/spend/' + dimension, 'Stage exceeded its admitted reservation or project budget.');
    } catch (cause) {
      if (cause instanceof MasInfrastructureCrash) throw cause;
      let issue = cause instanceof ResearchFailure ? cause.issue : researchIssue('TRSH1008', '', 'Stage execution or verification failed.', cause);
      const failedWriting = writing && (name === 'write' || name === 'verify') && phase === 'commit';
      if (failedWriting && !verifiedWriting) {
        // An invalid proposal is not admitted as a draft or review. The native
        // attempt is still authoritative evidence of its output and cost.
        result = { records: [], spend: researchNativeCost(native.attempts, scope), artifacts: [{
          mediaType: 'application/vnd.tangleai.research-native-writing-failure+json', bytes: new TextEncoder().encode(canonicalizeJson({
            kind: 'native-writing-failure', preparation, issue, attempts: native.attempts.filter(row => row.path.startsWith(scope + '/')) })) }] };
      }
      if (execution && name === 'execute' && phase === 'commit' || verifiedWriting || failedWriting) {
        for (const dimension of ['calls', 'tokens', 'ms', 'physical'] as const)
          if (result.spend[dimension] > manifest.reservation[dimension]
            || snapshot.attempts.reduce((total, row) => total + row.attempt.spend[dimension], result.spend[dimension]) > snapshot.project.budget[dimension])
            issue = researchIssue('TRSH1006', '/spend/' + dimension, 'Native work exceeded its reservation; all incurred cost and receipts are retained.', issue);
        retainedFailure = issue; target = 'STOPPED'; nextFrame.decision = 'Stop';
      } else {
      const intervention = acceptedGate ? await researchIntervention({ frame: original, response: response!, ...acceptedGate, target: 'STOPPED' }) : null;
      const failed = { ...attempt, spend: result.spend, stopReason: 'failed' as const, error: issue,
        interventions: intervention ? [intervention.id] : [] };
      researchValue(await store.commitStage(researchValue(await planStageCommit({ state, attempt: failed, manifest,
        nextStatus: 'STOPPED', artifactAdmissionIds: [], records: intervention ? [{ kind: 'Intervention', value: intervention }] : [] }))));
      throw new ResearchFailure(issue);
      }
    }
    const parents = researchFrameInputs(frame), descriptor = { projectId: frame.projectId, attempt: key, verification: 'verified' as const,
      parents: parents.length ? parents : [{ artifactId: frame.projectId, admissionId: null }] };
    const outputs: ArtifactAdmission[] = [];
    for (const artifact of result.artifacts) {
      const output = researchValue(await store.stageArtifact(artifact.bytes, { ...descriptor, mediaType: artifact.mediaType }));
      if (!outputs.some(row => row.id === output.id)) outputs.push(output);
      onOperation?.('artifact-staged', operation);
    }
    nextFrame = { ...nextFrame, status: target!, artifacts: [...new Map([...carriedInputs, ...outputs.map(refOf)].map(ref => [ref.admissionId, ref])).values()]
      .sort((a, b) => a.admissionId.localeCompare(b.admissionId)), ...(result.preregistration ? { planHash: result.preregistration.plan.planHash } : {}) };
    const pendingGate = target! === 'LITERATURE_GATE' ? 'literature' : target! === 'DESIGN_GATE' ? 'design' : target! === 'QUALITY_GATE' ? 'quality' : null;
    if (pendingGate) nextFrame.gate = await gateReviewOf(pendingGate, nextFrame, state.revision + 1);
    researchValue(validateResearchShape('ResearchWorkflowFrame', nextFrame));
    const checkpoint = researchValue(await store.stageArtifact(new TextEncoder().encode(canonicalizeJson(nextFrame)),
      { ...descriptor, mediaType: RESEARCH_FRAME_MEDIA_TYPE, parents: [...descriptor.parents, ...outputs.map(refOf)] }));
    outputs.push(checkpoint); onOperation?.('frame-staged', operation);
    const committed = researchValue(await store.commitStage(researchValue(await planStageCommit({ state, manifest,
      attempt: { ...attempt, ...(retainedFailure ? { stopReason: 'failed' as const, error: retainedFailure } : {}), spend: result.spend, outputArtifactIds: [...new Set(outputs.map(row => row.artifact.id))].sort() },
      artifactAdmissionIds: outputs.map(row => row.id), records: result.records, nextStatus: target!,
      ...(result.preregistration ? { preregistration: result.preregistration } : {}) }))));
    onOperation?.('committed', operation);
    if (retainedFailure) throw new ResearchFailure(retainedFailure);
    return { frame: researchWireFrame(await restoredFrame(store, committed), compactFrames) };
  }
}
