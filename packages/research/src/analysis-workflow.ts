/** The existing native GMPL peer-review graph owns every model request and checkpoint. */
import { defineMasWorkflow, taskInvocation, graphInvocation, masMessage, masWorkflowVersionIdOf, type JsonSchema, type WorkflowLimits } from '@tangleai/mas';
import { cloneJson } from '@jarenjs/core/object';
import { createResearchPatternHost, prepareResearchPattern } from './domain.ts';
import { researchSchemaOf } from './schema.ts';
import { RESEARCH_PREPARATION_SCHEMA } from './reasoning-contract.ts';
import { researchAnalysisRevisionOf, type ResearchAnalysisRuntimePolicy } from './analysis-contract.ts';

const object = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
export async function createResearchAnalysisWorkflow(policy: ResearchAnalysisRuntimePolicy, profile: string, limits: WorkflowLimits) {
  const revision = await researchAnalysisRevisionOf(policy), pattern = await prepareResearchPattern('result-review', await createResearchPatternHost(profile, limits));
  const subgraphs = [];
  for (const child of [...pattern.snapshot.subgraphs.values(), pattern.validated.workflow]) {
    const workflow = cloneJson(child); workflow.registry.revision = null; workflow.config.registryRevision = null;
    workflow.versionId = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>); subgraphs.push(workflow);
  }
  const frame = researchSchemaOf('ResearchWorkflowFrame'), preparation = { ...RESEARCH_PREPARATION_SCHEMA as Record<string, unknown>,
    properties: { ...(RESEARCH_PREPARATION_SCHEMA as { properties: Record<string, JsonSchema> }).properties, stage: { const: 'decide' } } } as JsonSchema;
  const input = (pattern.validated.workflow.input.schema as { properties: Record<string, JsonSchema> }).properties.input;
  const proposal = (pattern.validated.workflow.output.schema as { properties: Record<string, JsonSchema> }).properties.result;
  subgraphs.push(await defineMasWorkflow({ workflowId: 'research-result-review', title: 'Independent result review',
    description: 'Admitted deterministic analysis, native peer review and a bounded decision; policy ' + revision, profile, limits,
    input: object({ frame }), output: object({ frame }), nodes: [
      taskInvocation({ id: 'prepare', handler: 'research-prepare-decide', effect: 'effectful', input: { frame }, output: { preparation, input } }),
      graphInvocation({ id: 'model', subgraph: pattern.validated.workflow.workflowId, input: { input }, output: { result: proposal } }),
      taskInvocation({ id: 'commit', handler: 'research-commit-decide', effect: 'effectful', input: { preparation, proposal }, output: { frame } }),
    ], messages: [masMessage(['prepare', 'input'], ['model', 'input']), masMessage(['prepare', 'preparation'], ['commit', 'preparation']),
      masMessage(['model', 'result'], ['commit', 'proposal'])], entry: [{ port: 'frame', to: { node: 'prepare', port: 'frame' } }],
    exit: [{ port: 'frame', from: { node: 'commit', port: 'frame' } }], registryRevision: null, configRegistryRevision: null }));
  return { policy, revision, subgraphs, roles: pattern.snapshot.document.roles,
    handlers: [...pattern.snapshot.document.handlers, ...['research-prepare-decide', 'research-commit-decide'].map(id => ({
      id, title: id, effect: 'effectful' as const, idempotency: 'honored' as const }))],
    messageAdapters: pattern.snapshot.document.messageAdapters, taskHandlers: pattern.bindings.taskHandlers, adapters: pattern.bindings.messageAdapters };
}
export type PreparedResearchAnalysis = Awaited<ReturnType<typeof createResearchAnalysisWorkflow>>;
