import { canonicalizeJson } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { MasTaskRefusal, MasInfrastructureCrash, interactionIdOf, type MasTaskInput, type MasTaskHandlerBinding, type MasStore } from '@tangleai/mas';
import type { ResearchStore } from './store.ts';
import type { ResearchRecordWrite } from './records.ts';
import type { ResearchContract, ExperimentPlan, ResearchWorkflowFrame, ResearchLifecycle, ResearchCost, ResearchIssue,
  ResearchGateResponse, InputManifest, StageAttempt, StageCommitReceipt, ResearchInputArtifact, ResearchState, ArtifactAdmission } from './contracts.gen.ts';
import { immutableResearchJson, copyResearchBytes, inputManifestHashOf, stageAttemptIdOf } from './identity.ts';
import { researchIssue, type ResearchOutcome } from './errors.ts';
import { validateResearchShape } from './schema.ts';
import { planContractFreeze, planStageCommit } from './transitions.ts';
import { inputManifestOf, researchFrameInputs } from './manifest.ts';
import { gateReviewOf, checkResearchGate } from './gates.ts';
import { ResearchFailure, researchFail, researchValue, researchProjectHash, type ResearchWorkflowBinding } from './workflow-contract.ts';
import { RESEARCH_STAGES, type ResearchStageName } from './workflow.ts';

export const RESEARCH_FRAME_MEDIA_TYPE = 'application/vnd.tangleai.research-frame+json';
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
}
export interface ResearchStageAccess {
  signal: AbortSignal;
  /** Only exact committed admissions from this operation's manifest are readable. */
  readArtifact(ref: ResearchInputArtifact): Promise<Uint8Array>;
}
export interface ResearchTaskTools {
  binding: ResearchWorkflowBinding;
  contract: ResearchContract;
  plan: ExperimentPlan;
  masStore: Pick<MasStore, 'getInteraction' | 'readTrace'>;
  execute(operation: ResearchStageOperation, access: ResearchStageAccess): Promise<ResearchStageResult>;
  /** Independent deterministic verification, outside the executing stage body. */
  verify(operation: ResearchStageOperation, result: ResearchStageResult, access: ResearchStageAccess): Promise<ResearchOutcome<null>>;
  /** Host crash-injection/telemetry seam; never stored as content. */
  onOperation?(step: string, operation: ResearchStageOperation): void;
}
export interface ResearchTaskHandlers extends Record<string, MasTaskHandlerBinding> { }
const admissions = new WeakMap<ResearchTaskHandlers, { binding: ResearchWorkflowBinding; store: ResearchStore }>();
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
async function restoredFrame(store: ResearchStore, receipt: StageCommitReceipt): Promise<ResearchWorkflowFrame> {
  const frames = [];
  for (const id of receipt.artifactAdmissionIds) {
    const row = researchValue(await store.readArtifact(receipt.attempt.projectId, id));
    if (row.admission.artifact.mediaType === RESEARCH_FRAME_MEDIA_TYPE) frames.push(row);
  }
  if (frames.length !== 1) researchFail('TRSH1002', '/attempt/outputArtifactIds', 'Committed stage must contain exactly one recovery frame.');
  const row = frames[0], body = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', JSON.parse(new TextDecoder().decode(row.bytes))));
  if (body.checkpoint !== null || body.status !== receipt.nextState.status || body.projectId !== receipt.attempt.projectId)
    researchFail('TRSH1002', '/checkpoint', 'Recovery frame differs from its committed transition.');
  return immutableResearchJson({ ...body, checkpoint: refOf(row.admission) });
}

/** Stage admission, execution, independent verification and a single research-store commit. */
export function createResearchTaskHandlers(store: ResearchStore, tools: ResearchTaskTools): ResearchTaskHandlers {
  const binding = immutableResearchJson(tools.binding), contract = immutableResearchJson(tools.contract), experiment = immutableResearchJson(tools.plan);
  if (binding.contractHash !== contract.contractHash || experiment.contractHash !== contract.contractHash)
    researchFail('TRSH1002', '/binding', 'Handlers and experiment must use the pinned contract.');
  // Function capabilities are captured once; caller mutation cannot replace a body on resume.
  const execute = tools.execute, verify = tools.verify, onOperation = tools.onOperation, masStore = tools.masStore;
  const handlers: ResearchTaskHandlers = {};
  handlers['research-refuse'] = () => { throw new MasTaskRefusal({ code: 'TMAS2004', detail: 'Research control input has no registered lifecycle edge.',
    cause: { code: 'TRSH1004', docPath: '/frame/status', message: 'Research control input has no registered lifecycle edge.' } }); };
  handlers['research-relay'] = input => ({ frame: researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', input.value.frame)) });
  for (const name of RESEARCH_STAGES) handlers['research-' + name] = async input => {
    try { return await runStage(name, input); }
    catch (cause) {
      if (cause instanceof MasInfrastructureCrash || cause instanceof MasTaskRefusal) throw cause;
      const issue = cause instanceof ResearchFailure ? cause.issue : researchIssue('TRSH1008', '', 'Research stage failed.', cause);
      throw new MasTaskRefusal({ code: 'TMAS2004', detail: issue.detail, cause: { code: issue.code, docPath: issue.path, message: issue.detail } });
    }
  };
  admissions.set(handlers, { binding, store });
  return Object.freeze(handlers);

  async function runStage(name: ResearchStageName, input: MasTaskInput) {
    const original = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', input.value.frame));
    const kind = name in gates ? gates[name as keyof typeof gates] : null;
    const response = kind ? researchValue(validateResearchShape<ResearchGateResponse>('ResearchGateResponse', input.value.response)) : null;
    const frame = immutableResearchJson({ ...original, response });
    if (frame.projectId !== input.runId || frame.bindingId !== binding.id || frame.planHash !== experiment.planHash)
      researchFail('TRSH1004', '/frame', 'The incoming frame belongs to another native run, plan or stack.');
    if (frame.status !== stages[name]) researchFail('TRSH1004', '/frame/status', 'The task does not implement this incoming stage.');
    const manifest = await inputManifestOf(frame.status, frame, binding.promptRevision, binding.runIdentityId,
      binding.toolVersions, binding.evaluator, binding.reservation);
    const manifestHash = await inputManifestHashOf(manifest);
    const snapshot = researchValue(await store.snapshot(frame.projectId));
    if (!snapshot) researchFail('TRSH1003', '/projectId', 'Host must create the research project before starting MAS.');
    if (frame.projectHash !== await researchProjectHash(snapshot.project)) researchFail('TRSH1004', '/frame/projectHash', 'Root project content changed.');
    // Native completion may lag this atomic receipt; consult the path before deriving an ordinal.
    const prior = snapshot.attempts.find(row => row.attempt.masPath === input.path);
    if (prior) {
      if (prior.attempt.inputManifestHash !== manifestHash || prior.attempt.stage !== frame.status)
        researchFail('TRSH1004', '/inputManifestHash', 'A committed MAS path cannot resume with changed content.');
      if (prior.attempt.error) throw new ResearchFailure(prior.attempt.error);
      return { frame: await restoredFrame(store, prior) };
    }
    const native = await masStore.readTrace(input.runId);
    if (native?.run.status !== 'running' || !native.attempts.some(a => a.status === 'running' && a.kind === 'task'
      && a.path === input.path && a.invocationId === input.node && a.idempotencyKey === input.idempotencyKey))
      researchFail('TRSH1004', '/masPath', 'New stage work requires its running native MAS task attempt.');
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
    if (name === 'create') state = researchValue(await store.freezeContract(researchValue(await planContractFreeze(state, contract, experiment,
      snapshot.records.filter(r => r.kind === 'MetricObservation').map(r => r.id)))));
    const key = { projectId: frame.projectId, stage: frame.status,
      attemptOrdinal: Math.max(0, ...snapshot.attempts.filter(row => row.attempt.stage === frame.status).map(row => row.attempt.attemptOrdinal)) + 1,
      inputManifestHash: manifestHash };
    const attempt: StageAttempt = { ...key, id: await stageAttemptIdOf(key), masPath: input.path,
      promptRevision: binding.promptRevision, runIdentityId: binding.runIdentityId, toolVersions: binding.toolVersions,
      spend: zero, stopReason: 'completed', interventions: [], outputArtifactIds: [], error: null, mode: 'scripted' };
    const operation: ResearchStageOperation = immutableResearchJson({ stage: name, path: input.path, idempotencyKey: input.idempotencyKey,
      frame, manifest, attemptId: attempt.id, expectedState: state });
    const access: ResearchStageAccess = { signal: input.signal, readArtifact: async requested => {
      const ref = immutableResearchJson(requested);
      if (!researchFrameInputs(frame).some(r => equalsJson(r, ref))) researchFail('TRSH1005', '/artifact', 'Stage read is outside its declared manifest.');
      const row = researchValue(await store.readArtifact(frame.projectId, ref.admissionId));
      if (row.admission.artifact.id !== ref.artifactId) researchFail('TRSH1002', '/artifact', 'Input content address differs from its admitted reference.');
      return copyResearchBytes(row.bytes);
    } };
    onOperation?.('planned', operation);
    let result: ResearchStageResult = { artifacts: [], records: [], spend: zero };
    let target: ResearchLifecycle, nextFrame: ResearchWorkflowFrame = { ...frame, checkpoint: null, response: null, gate: null };
    try {
      if (kind) {
        const gate = await checkResearchGate(original, kind);
        if (gate.stateRevision !== state.revision || response!.approvedManifestHash !== gate.manifestHash)
          researchFail('TRSH1004', '/response/approvedManifestHash', 'Response does not approve the current reviewed artifact set.');
        const node = kind + '-gate', path = input.path.slice(0, -input.node.length) + node;
        const interaction = await masStore.getInteraction(interactionIdOf(input.runId, path));
        if (!interaction || interaction.status !== 'responded' || !equalsJson(interaction.response, response) || !equalsJson(interaction.prompt, original))
          researchFail('TRSH1005', '/response', 'Stage response must be the durable native interaction response.');
        const id = researchValue(validateResearchShape<string>('ResearchId', interaction.responseKey));
        if (response!.decision === 'edit' || response!.decision === 'guide' || response!.patch || response!.target && response!.target !== 'write')
          researchFail('TRSH1007', '/response/decision', 'This scripted host does not bind guarded edits, guidance or targeted retries.');
        result.records.push({ kind: 'Intervention', value: { id, gate: kind, actor: response!.actor,
          action: response!.decision as 'approve' | 'reject' | 'stop', reviewedManifestHash: gate.manifestHash,
          approvedManifestHash: response!.decision === 'approve' ? gate.manifestHash : null, substantive: response!.note.trim().length > 0 } });
        result.artifacts.push({ bytes: new TextEncoder().encode(canonicalizeJson({ interactionId: interaction.id, responseKey: interaction.responseKey, response })), mediaType: 'application/json' });
        attempt.interventions = [id];
        if (response!.decision === 'stop' || response!.decision === 'reject' && (kind !== 'quality' || frame.review >= contract.reviewCap)) target = 'STOPPED';
        else if (response!.decision === 'reject') target = 'WRITE';
        else target = kind === 'literature' ? 'SYNTHESIS' : kind === 'design' ? 'EXECUTE' : 'COMPLETE';
      } else {
        result = resultSnapshot(await execute(operation, access)); onOperation?.('executed', operation);
        if (result.error) throw new ResearchFailure(result.error);
        researchValue(await verify(operation, resultSnapshot(result), access)); onOperation?.('verified', operation);
        if (name === 'decide') {
          if (!result.decision || !['Proceed', 'Refine', 'Pivot', 'Stop'].includes(result.decision)) researchFail('TRSH1001', '/decision', 'Decision stage must produce a registered edge.');
          const bounded = result.decision === 'Refine' && frame.attempt >= contract.attemptCap
            || result.decision === 'Pivot' && frame.pivot >= contract.pivotCap ? 'Stop' : result.decision;
          nextFrame.decision = bounded;
          target = bounded === 'Proceed' ? 'WRITE' : bounded === 'Refine' ? 'EXECUTE' : bounded === 'Pivot' ? 'SYNTHESIS' : 'STOPPED';
        } else target = next[name]!;
        if (name === 'synthesis') { nextFrame.pivot++; nextFrame.attempt = 0; nextFrame.decision = null; }
        if (name === 'execute') nextFrame.attempt++;
        if (name === 'write') nextFrame.review++;
      }
      if (target === 'STOPPED') nextFrame.decision = 'Stop';
      for (const dimension of ['calls', 'tokens', 'ms', 'physical'] as const)
        if (result.spend[dimension] > manifest.reservation[dimension]) researchFail('TRSH1006', '/spend/' + dimension, 'Stage exceeded its admitted reservation.');
    } catch (cause) {
      if (cause instanceof MasInfrastructureCrash) throw cause;
      const issue = cause instanceof ResearchFailure ? cause.issue : researchIssue('TRSH1008', '', 'Stage execution or verification failed.', cause);
      const failed = { ...attempt, spend: result.spend, stopReason: 'failed' as const, error: issue, interventions: [] };
      researchValue(await store.commitStage(researchValue(await planStageCommit({ state, attempt: failed, manifest,
        nextStatus: 'STOPPED', artifactAdmissionIds: [] }))));
      throw new ResearchFailure(issue);
    }
    const parents = researchFrameInputs(frame), descriptor = { projectId: frame.projectId, attempt: key, verification: 'verified' as const,
      parents: parents.length ? parents : [{ artifactId: frame.projectId, admissionId: null }] };
    const outputs: ArtifactAdmission[] = [];
    for (const artifact of result.artifacts) {
      const output = researchValue(await store.stageArtifact(artifact.bytes, { ...descriptor, mediaType: artifact.mediaType }));
      if (!outputs.some(row => row.id === output.id)) outputs.push(output);
      onOperation?.('artifact-staged', operation);
    }
    nextFrame = { ...nextFrame, status: target!, artifacts: [...new Map([...frame.artifacts, ...outputs.map(refOf)].map(ref => [ref.admissionId, ref])).values()]
      .sort((a, b) => a.admissionId.localeCompare(b.admissionId)) };
    const pendingGate = target! === 'LITERATURE_GATE' ? 'literature' : target! === 'DESIGN_GATE' ? 'design' : target! === 'QUALITY_GATE' ? 'quality' : null;
    if (pendingGate) nextFrame.gate = await gateReviewOf(pendingGate, nextFrame, state.revision + 1);
    researchValue(validateResearchShape('ResearchWorkflowFrame', nextFrame));
    const checkpoint = researchValue(await store.stageArtifact(new TextEncoder().encode(canonicalizeJson(nextFrame)),
      { ...descriptor, mediaType: RESEARCH_FRAME_MEDIA_TYPE, parents: [...descriptor.parents, ...outputs.map(refOf)] }));
    outputs.push(checkpoint); onOperation?.('frame-staged', operation);
    const committed = researchValue(await store.commitStage(researchValue(await planStageCommit({ state, manifest,
      attempt: { ...attempt, spend: result.spend, outputArtifactIds: [...new Set(outputs.map(row => row.artifact.id))].sort() },
      artifactAdmissionIds: outputs.map(row => row.id), records: result.records, nextStatus: target! }))));
    onOperation?.('committed', operation);
    return { frame: await restoredFrame(store, committed) };
  }
}
