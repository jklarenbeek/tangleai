/** Human intent is planned from a reviewed trace and settled by native interaction CAS. */
import { equalsJson } from '@jarenjs/core/object';
import { parseRFC3339Parts, getEpochOfDateTimeRFC3339 } from '@jarenjs/core/dates';
import { masIssue, type MasInteraction, type MasStore, type StoreOutcome, type TraceView } from '@tangleai/mas';
import type { HumanCommand, Intervention, ResearchGateResponse, ResearchWorkflowFrame, ResearchInterventionReport, ResearchLifecycle } from './contracts.gen.ts';
import type { ResearchStore } from './store.ts';
import { immutableResearchJson, researchRevisionOf } from './identity.ts';
import { validateResearchShape } from './schema.ts';
import { checkResearchGate, researchGateKind } from './gates.ts';
import { ResearchFailure, researchValue } from './workflow-contract.ts';
import { researchGateEditor } from './directives.ts';

export interface ResearchHumanCommandPlan {
  kind: 'respond' | 'resolve'; interactionId: string; expectedRevision: number; responseKey: string;
  response: ResearchGateResponse; frame: ResearchWorkflowFrame;
}
const refused = (detail: string, path = '/command', cause?: unknown): StoreOutcome<never> => ({ ok: false,
  issue: { ...masIssue('TMAS2007', path, detail), ...(cause instanceof ResearchFailure
    ? { cause: { code: cause.issue.code, docPath: cause.issue.path, message: cause.issue.detail } } : {}) } });

export function researchCommandResponse(command: HumanCommand): ResearchGateResponse {
  const note = command.kind === 'approve' ? command.note : command.kind === 'guide' ? command.text
    : command.kind === 'edit' ? 'Edit the reviewed staged artifact.' : command.reason;
  return immutableResearchJson({ decision: command.kind, approvedManifestHash: command.approvedManifestHash,
    actor: command.actor, note, command, ...('target' in command ? { target: command.target } : {}),
    ...(command.kind === 'edit' ? { patch: command.patch } : {}) });
}

/** No I/O, clock or state mutation. The native owner validates the stored const again. */
export async function planHumanCommand(traceInput: TraceView, commandInput: unknown): Promise<StoreOutcome<ResearchHumanCommandPlan>> {
  try {
    const command = researchValue(validateResearchShape<HumanCommand>('HumanCommand', commandInput));
    const trace = immutableResearchJson(traceInput), gate = trace.interactions.find(row => row.id === command.interactionId);
    if (!gate || gate.runId !== trace.run.id || researchGateKind(gate) !== command.gate)
      return refused('The command must identify a gate in this research run.', '/interactionId');
    if (trace.interactions.some(row => row.id !== gate.id && row.responseKey === command.id))
      return refused('An intervention id cannot identify two gate actions.', '/id');
    const frame = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', gate.prompt));
    const review = await checkResearchGate(frame, command.gate);
    if (frame.projectId !== trace.run.id || review.manifestHash !== command.approvedManifestHash)
      return refused('The reviewed artifact manifest changed.', '/approvedManifestHash');
    const parts = parseRFC3339Parts(command.at), instant = getEpochOfDateTimeRFC3339(command.at);
    if (!parts || parts.offset === undefined || parts.seconds >= 60 || !Number.isSafeInteger(instant))
      return refused('An attributable command requires an explicit RFC3339 instant.', '/at');
    const response = researchCommandResponse(command), terminal = command.kind === 'stop' ? 'cancelled' : 'responded';
    const replay = gate.status === terminal && gate.responseKey === command.id && equalsJson(gate.response, response);
    if (!replay && (gate.status !== 'waiting' || gate.revision !== command.revision || trace.run.status !== 'waiting_for_input'))
      return refused('The interaction moved; a conflicting command cannot resume it.', '/revision');
    if (command.kind === 'edit' && !review.artifacts.some(ref => ref.artifactId === command.artifactId && ref.admissionId === command.admissionId))
      return refused('The edited admission was not part of this review.', '/artifactId');
    if ('target' in command && (command.gate === 'literature' || command.gate === 'design' && command.target !== 'design'))
      return refused('This gate has no admitted input for the requested retry stage.', '/target');
    return { ok: true, value: immutableResearchJson({ kind: command.kind === 'stop' ? 'resolve' : 'respond',
      interactionId: gate.id, expectedRevision: command.revision, responseKey: command.id, response, frame }) };
  } catch (cause) { return refused(cause instanceof Error ? cause.message : 'Invalid research command.', '/command', cause); }
}

export async function researchIntervention(options: {
  frame: ResearchWorkflowFrame; response: ResearchGateResponse; id: string; at: string;
  target: ResearchLifecycle; editedArtifactId?: string | null;
}): Promise<Intervention> {
  const { frame, response, id, at, target, editedArtifactId = null } = immutableResearchJson(options);
  const gate = await checkResearchGate(frame, frame.gate!.kind), command = response.command;
  if (response.approvedManifestHash !== gate.manifestHash || command && (command.id !== id
    || !equalsJson(response, researchCommandResponse(command))))
    throw new ResearchFailure({ code: 'TRSH1004', path: '/response', detail: 'The attributed response differs from its reviewed command.' });
  return researchValue(validateResearchShape<Intervention>('Intervention', {
    id, gate: gate.kind, actor: response.actor, action: response.decision === 'guide' ? 'guidance' : response.decision,
    reviewedManifestHash: gate.manifestHash, approvedManifestHash: response.decision === 'approve' ? gate.manifestHash : null,
    substantive: ['reject', 'edit', 'guide'].includes(response.decision), stage: frame.status,
    actorId: command?.actorId ?? response.actor, at: command?.at ?? at,
    viewedArtifactIds: [...new Set(gate.artifacts.map(ref => ref.artifactId))].sort(),
    effect: { kind: response.decision === 'approve' ? 'approval' : response.decision === 'stop' ? 'stop' : 'retry',
      target, editedArtifactId, guidanceHash: response.decision === 'guide' ? await researchRevisionOf({ text: response.note }) : null },
    experimental: response.actor === 'full-auto',
  }));
}

function summarizeActions(values: ReadonlyArray<{ action: Intervention['action']; actor: Intervention['actor'] }>): ResearchInterventionReport {
  return { total: values.length, approvals: values.filter(row => row.action === 'approve').length,
    substantive: values.filter(row => ['reject', 'edit', 'guidance'].includes(row.action)).length,
    stops: values.filter(row => row.action === 'stop').length, human: values.filter(row => row.actor === 'human').length,
    scripted: values.filter(row => row.actor === 'scripted').length, automatic: values.filter(row => row.actor === 'full-auto').length };
}
/** The same action accounting is used by trace views and exported manifests. */
export function researchInterventionReport(input: readonly Intervention[]): ResearchInterventionReport {
  const rows = input.map(row => researchValue(validateResearchShape<Intervention>('Intervention', row)));
  if (new Set(rows.map(row => row.id)).size !== rows.length
    || rows.some(row => row.substantive !== ['reject', 'edit', 'guidance'].includes(row.action)
      || row.actor === 'timeout' || row.actor === 'full-auto' && (row.experimental !== true || row.action !== 'approve')
      || row.actor !== 'full-auto' && row.experimental === true))
    throw new ResearchFailure({ code: 'TRSH1002', path: '/interventions', detail: 'Each intervention must have one identity and honest action and actor attribution.' });
  return summarizeActions(rows);
}

/** Accepted responses only; a note attached to approval is not a substantive correction. */
export function interventionReport(trace: Pick<TraceView, 'interactions' | 'attempts'>): ResearchInterventionReport {
  const rows = new Map<string, ResearchGateResponse>();
  const retain = (id: string, response: ResearchGateResponse) => {
    if (rows.has(id)) throw new ResearchFailure({ code: 'TRSH1002', path: '/interventions',
      detail: 'One intervention identity cannot account for two distinct native gate actions.' });
    rows.set(id, response);
  };
  for (const gate of trace.interactions) {
    if (!['literature-gate', 'design-gate', 'quality-gate'].includes(gate.node) || !gate.responseKey || gate.status === 'waiting') continue;
    const checked = validateResearchShape<ResearchGateResponse>('ResearchGateResponse', gate.response);
    if (!checked.valid) throw new ResearchFailure(checked.issues[0]);
    retain(gate.responseKey, checked.value);
  }
  for (const attempt of trace.attempts) {
    if (attempt.kind !== 'task' || attempt.status !== 'completed'
      || !['literature-gate', 'design-gate', 'quality-gate'].includes(attempt.invocationId)) continue;
    const response = (attempt.output as { response?: unknown } | null)?.response;
    if (response === undefined) continue;
    const checked = researchValue(validateResearchShape<ResearchGateResponse>('ResearchGateResponse', response));
    if (checked.actor !== 'full-auto') throw new ResearchFailure({ code: 'TRSH1005', path: '/actor', detail: 'An automated gate must disclose its actor.' });
    retain(attempt.idempotencyKey, checked);
  }
  return summarizeActions([...rows.values()].map(row => ({ actor: row.actor, action: row.decision === 'guide' ? 'guidance' : row.decision })));
}

export function researchStatus(trace: TraceView) {
  const frame = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', (trace.run.input as { frame: unknown }).frame));
  if (frame.projectId !== trace.run.id) throw new ResearchFailure({ code: 'TRSH1005', path: '/runId', detail: 'Trace is not this research project.' });
  return immutableResearchJson({ runId: trace.run.id, status: trace.run.status, revision: trace.run.revision,
    gates: trace.interactions.filter(row => row.status === 'waiting').map(row => ({ id: row.id, kind: researchGateKind(row),
      revision: row.revision, manifestHash: (row.prompt as ResearchWorkflowFrame).gate!.manifestHash })), interventions: interventionReport(trace) });
}

export function createResearchCommands(options: { masStore: MasStore; researchStore: ResearchStore }) {
  const { masStore, researchStore } = options;
  return {
    async attach(runId: string) {
      const trace = await masStore.readTrace(runId);
      if (!trace) return refused('Unknown research run.', '/runId');
      try { return { ok: true as const, value: researchStatus(trace) }; }
      catch (cause) { return refused('Invalid research trace.', '/runId', cause); }
    },
    async execute(commandInput: unknown): Promise<StoreOutcome<MasInteraction>> {
      const checked = validateResearchShape<HumanCommand>('HumanCommand', commandInput);
      if (!checked.valid) return refused('The human command does not validate.', '/command', new ResearchFailure(checked.issues[0]));
      const command = checked.value, interaction = await masStore.getInteraction(command.interactionId);
      if (!interaction) return refused('Unknown research interaction.', '/interactionId');
      const trace = await masStore.readTrace(interaction.runId);
      if (!trace) return refused('Unknown research run.', '/runId');
      const planned = await planHumanCommand(trace, command); if (!planned.ok) return planned;
      const plan = planned.value;
      if (command.kind === 'edit' && interaction.status === 'waiting') {
        try {
          const editor = await researchGateEditor(researchStore, interaction.runId, command, { projectId: interaction.runId,
            stage: plan.frame.status, attemptOrdinal: 1, inputManifestHash: plan.response.approvedManifestHash });
          researchValue(await editor.preview(command.patch));
        } catch (cause) { return refused('The guarded edit cannot be admitted.', '/patch', cause); }
      }
      const settled = plan.kind === 'respond' ? await masStore.respondInteraction(plan.interactionId, plan.response, plan.expectedRevision, plan.responseKey)
        : await masStore.resolveInteraction(plan.interactionId, 'cancelled', plan.expectedRevision, { response: plan.response, responseKey: plan.responseKey });
      if (!settled.ok || plan.kind !== 'resolve') return settled;
      try {
        const state = researchValue(await researchStore.getState(interaction.runId));
        if (!state) return refused('The research projection is missing.', '/projectId');
        const intervention = await researchIntervention({ frame: plan.frame, response: plan.response, id: plan.responseKey, at: command.at, target: 'STOPPED' });
        researchValue(await researchStore.stopWithIntervention({ expectedState: state, intervention }));
        return settled;
      } catch (cause) { return refused('Cancellation is durable; its research projection requires reconciliation.', '/projection', cause); }
    },
  };
}
