/** The native skill consumer is bound into role, node and tool identities before compilation. */
import { cloneJson } from '@jarenjs/core/object';
import { composeSkillSystem, skillReadTool } from '@tangleai/trace2skill';
import { masRevisionOf, masWorkflowVersionIdOf, type MasRegistry, type MasWorkflow, type MasHostBindings } from '@tangleai/mas';
import { researchFail, researchValue } from '../workflow-contract.ts';
import { researchPreparationFor } from '../reasoning-contract.ts';
import { resolveResearchFrame } from '../frames.ts';
import type { ResearchStore } from '../store.ts';
import type { MasStore } from '@tangleai/mas';
import { lessonProcedureStore, type ResearchLessonProcedure } from './inject.ts';

export async function lessonWorkflowCapabilities(procedure: ResearchLessonProcedure | undefined,
  roles: MasRegistry['roles'], workflows: MasWorkflow[]) {
  if (!procedure) return { roles, workflows, tools: [] as MasRegistry['tools'] };
  const revisions = new Map<string, string>(), bound: MasRegistry['roles'] = [];
  for (const role of roles) {
    const composed = composeSkillSystem(role.instructions, procedure.snapshot);
    if (!composed.valid) researchFail('TRSH2004', '/procedure', 'The retained procedure root cannot be preloaded.');
    const instructionsRevision = await masRevisionOf(composed.value);
    revisions.set(role.id, instructionsRevision); bound.push({ ...role, instructions: composed.value, instructionsRevision });
  }
  const changed = [];
  for (const source of workflows) {
    const workflow = cloneJson(source);
    for (const node of workflow.nodes) if (node.kind === 'agent') {
      const revision = revisions.get(node.role);
      if (!revision) researchFail('TRSH2004', '/role', 'An injected role has no registered instructions.');
      node.instructionsRevision = revision; node.tools = [...new Set([...node.tools, 'skill_read'])];
    }
    workflow.versionId = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>); changed.push(workflow);
  }
  const tool = skillReadTool(procedure.snapshot);
  const tools: MasRegistry['tools'] = [{ id: tool.name, title: tool.description, effect: 'pure', input: tool.inputSchema,
    inputRevision: await masRevisionOf(tool.inputSchema) }];
  return { roles: bound, workflows: changed, tools };
}

export function lessonWorkflowTools(procedure: ResearchLessonProcedure, researchStore: ResearchStore,
  masStore: Pick<MasStore, 'readTrace'>): MasHostBindings['toolBindings'] {
  if (lessonProcedureStore(procedure) !== researchStore) researchFail('TRSH2007', '/procedure', 'The procedure was not admitted by this research store.');
  const tool = skillReadTool(procedure.snapshot);
  return { [tool.name]: { handler: async (input, context) => {
    if (!context.invocation || context.invocation.runId !== procedure.runId)
      researchFail('TRSH2005', '/invocation', 'The procedure belongs to another research run.');
    const prepared = await researchPreparationFor(masStore, context.invocation), frame = await resolveResearchFrame(researchStore, prepared.frame);
    if (frame.lessonProcedure?.bundleHash !== procedure.snapshot.bundle.id
      || frame.lessonProcedure.injection?.id !== procedure.injection?.id)
      researchFail('TRSH2007', '/invocation', 'The native prepared stage does not bind this frozen procedure.');
    if (procedure.injection) {
      const retained = researchValue(await researchStore.lessons.getInjection(procedure.injection.id));
      if (!retained || retained.id !== frame.lessonProcedure.injection?.id)
        researchFail('TRSH2007', '/injection', 'The stage has no retained injection.');
    }
    return tool.execute(input as { path: string });
  } } };
}
