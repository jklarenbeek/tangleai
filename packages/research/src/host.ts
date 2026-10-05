import { equalsJson } from '@jarenjs/core/object';
import { masIssue, type MasHostBindings, type MasStore, type MasRun } from '@tangleai/mas';
import type { ResearchStore } from './store.ts';
import type { ResearchWorkflowFrame } from './contracts.gen.ts';
import { validateResearchShape } from './schema.ts';
import { checkResearchGate, gateResponseSchema, researchGateKind } from './gates.ts';
import { ResearchFailure, researchFail, researchValue } from './workflow-contract.ts';
import { researchHandlerAdmission, type ResearchTaskHandlers } from './handlers.ts';
import type { PreparedResearchWorkflow } from './workflow.ts';

/** Assemble injected capabilities only; the caller owns opening stores, jobs and workers. */
export function createResearchHostBindings(options: {
  masStore: MasStore; researchStore: ResearchStore; taskHandlers: ResearchTaskHandlers; prepared: PreparedResearchWorkflow;
  now: () => string; clock: () => number; deadlineFor?: (afterMs: number) => string; observer?: MasHostBindings['observer'];
  clientFor?: MasHostBindings['clientFor'];
}): MasHostBindings {
  const { masStore, researchStore, taskHandlers, prepared } = options, admitted = researchHandlerAdmission(taskHandlers);
  if (!admitted || admitted.store !== researchStore || !equalsJson(admitted.binding, prepared.binding))
    researchFail('TRSH1007', '/taskHandlers', 'Research handlers must match the compiled store and content binding.');
  if (!equalsJson(admitted.reasoning ?? null, prepared.model?.policy ?? null))
    researchFail('TRSH1007', '/reasoning', 'Prepared model topology and admitted stage owners must use the same policy.');
  if (!equalsJson(admitted.execution ?? null, prepared.executionGraph?.policy ?? null))
    researchFail('TRSH1007', '/execution', 'Prepared execution topology and admitted handlers must use the same policy.');
  if (!equalsJson(admitted.analysis ?? null, prepared.analysisGraph?.policy ?? null))
    researchFail('TRSH1007', '/analysis', 'Prepared result review and admitted analysis must use the same policy.');
  if (!equalsJson(admitted.writing ?? null, prepared.writingGraph?.policy ?? null))
    researchFail('TRSH1007', '/writing', 'Prepared writing and admitted writer/reviewer owners must use the same policy.');
  const checkRun = async (run: MasRun) => {
    if (run.workflowVersionId !== prepared.workflow.versionId || run.registryRevision !== prepared.snapshot.revision
      || run.executableRevision !== prepared.plan.executableRevision || run.configRegistryRevision !== prepared.catalog.revision)
      researchFail('TRSH1004', '/run', 'A native run cannot resume under a changed research stack or workflow.');
    const frame = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', (run.input as { frame?: unknown }).frame));
    if (frame.bindingId !== prepared.binding.id || frame.projectId !== run.id)
      researchFail('TRSH1004', '/run/input', 'Root input does not bind this native research run.');
    const project = researchValue(await researchStore.getProject(run.id));
    if (!project || project.mode !== prepared.mode || (project.experimental === true) !== prepared.experimental)
      researchFail('TRSH1004', '/run/mode', 'The project mode must match its explicitly prepared topology.');
  };
  const store: MasStore = { ...masStore,
    async getRun(id) { const run = await masStore.getRun(id); if (run) await checkRun(run); return run; },
    async readTrace(id) { const trace = await masStore.readTrace(id); if (trace) await checkRun(trace.run); return trace; },
    async transitionRun(id, command) {
      if (command.kind === 'fail') await admitted.reconcileFailure?.(id, command.failure);
      return masStore.transitionRun(id, command);
    },
    async createInteraction(plan) {
      try {
        const frame = researchValue(validateResearchShape<ResearchWorkflowFrame>('ResearchWorkflowFrame', plan.prompt));
        if (plan.expiry !== null || frame.projectId !== plan.runId || frame.bindingId !== prepared.binding.id)
          researchFail('TRSH1005', '/prompt', 'Research interactions are indefinite waits for this pinned project.');
        const gate = await checkResearchGate(frame, researchGateKind(plan));
        const state = researchValue(await researchStore.getState(plan.runId));
        if (!state || state.revision !== gate.stateRevision || state.status !== frame.status)
          researchFail('TRSH1004', '/prompt', 'Reviewed project state has changed.');
        const snapshot = researchValue(await researchStore.snapshot(plan.runId));
        for (const ref of gate.artifacts) {
          if (!snapshot?.committedAdmissionIds.includes(ref.admissionId)) researchFail('TRSH1005', '/prompt/artifacts', 'A review requires committed artifacts.');
          const row = researchValue(await researchStore.readArtifact(plan.runId, ref.admissionId));
          if (row.admission.artifact.id !== ref.artifactId) researchFail('TRSH1002', '/prompt/artifacts', 'Reviewed bytes differ from their content address.');
        }
        return masStore.createInteraction({ ...plan, responseSchema: gateResponseSchema(gate.kind, gate.manifestHash) as Record<string, unknown> });
      } catch (cause) {
        const issue = cause instanceof ResearchFailure ? cause.issue : { code: 'TRSH1008', path: '', detail: String(cause) };
        return { ok: false, issue: { ...masIssue('TMAS2007', issue.path, issue.detail),
          cause: { code: issue.code, docPath: issue.path, message: issue.detail } } };
      }
    },
  };
  return { store, taskHandlers: { ...prepared.model?.taskHandlers, ...prepared.analysisGraph?.taskHandlers, ...prepared.writingGraph?.taskHandlers, ...taskHandlers }, toolBindings: admitted.toolBindings ?? {}, contextProviders: prepared.writingGraph?.contextProviders ?? {}, now: options.now, clock: options.clock,
    ...(prepared.model || prepared.executionGraph || prepared.analysisGraph || prepared.writingGraph ? { messageAdapters: new Map([...prepared.model?.adapters ?? [], ...prepared.executionGraph?.adapters ?? [], ...prepared.analysisGraph?.adapters ?? [], ...prepared.writingGraph?.adapters ?? []]) } : {}), ...(options.clientFor ? { clientFor: options.clientFor } : {}),
    ...(options.deadlineFor ? { deadlineFor: options.deadlineFor } : {}), ...(options.observer ? { observer: options.observer } : {}) };
}
