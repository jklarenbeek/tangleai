/** Ordinary MAS child graphs for prepare -> native agent/pattern -> commit. */
import { agentInvocation, taskInvocation, graphInvocation, masMessage, defineMasWorkflow, masRevisionOf, masWorkflowVersionIdOf,
  type MasRegistry, type MasWorkflow, type MasHostBindings, type JsonSchema, type WorkflowLimits } from '@tangleai/mas';
import { renderGmplPrompt } from '@tangleai/gmpl';
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { createResearchPatternHost, prepareResearchPattern, researchArtifacts } from './domain.ts';
import { RESEARCH_MODEL_STAGES, RESEARCH_PREPARATION_SCHEMA, researchReasoningRevisionOf, type ResearchReasoningPolicy } from './reasoning-contract.ts';
import { RESEARCH_READ_TOOLS, researchToolDeclarations } from './tools.ts';
import { researchSchemaOf } from './schema.ts';
import { researchFail } from './workflow-contract.ts';

const object = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export async function createResearchReasoningWorkflow(policy: ResearchReasoningPolicy, profile: string, limits: WorkflowLimits) {
  const revision = await researchReasoningRevisionOf(policy);
  const roles: MasRegistry['roles'] = [], handlers: MasRegistry['handlers'] = [], messageAdapters: MasRegistry['messageAdapters'] = [];
  const subgraphs: MasWorkflow[] = [], taskHandlers: MasHostBindings['taskHandlers'] = {}, adapters = new Map<string, NonNullable<MasHostBindings['messageAdapters']> extends ReadonlyMap<string, infer V> ? V : never>();
  const frame = researchSchemaOf('ResearchWorkflowFrame'), preparation = RESEARCH_PREPARATION_SCHEMA;
  for (const stage of RESEARCH_MODEL_STAGES) {
    const pack = researchArtifacts.prompts.find(row => row.id === 'research-' + (stage === 'hypothesis' ? 'synthesizer' : stage === 'design' ? 'designer' : stage))!;
    const pattern = policy.mode === 'debate' && stage !== 'design'
      ? await prepareResearchPattern(stage, await createResearchPatternHost(profile, limits)) : null;
    let inputSchema = pack.variableSchema as JsonSchema, outputSchema = pack.outputSchema as JsonSchema, inputPort = 'variables', outputPort = 'out';
    if (pattern) {
      for (const child of [...pattern.snapshot.subgraphs.values(), pattern.validated.workflow]) {
        const workflow = cloneJson(child); workflow.registry.revision = null; workflow.config.registryRevision = null;
        workflow.versionId = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>); subgraphs.push(workflow);
      }
      roles.push(...pattern.snapshot.document.roles); handlers.push(...pattern.snapshot.document.handlers);
      messageAdapters.push(...pattern.snapshot.document.messageAdapters);
      Object.assign(taskHandlers, pattern.bindings.taskHandlers);
      for (const [key, adapter] of pattern.bindings.messageAdapters) adapters.set(key, adapter);
      inputSchema = (pattern.validated.workflow.input.schema as { properties: Record<string, JsonSchema> }).properties.input;
      outputSchema = (pattern.validated.workflow.output.schema as { properties: Record<string, JsonSchema> }).properties.result;
      inputPort = 'input'; outputPort = 'result';
    } else {
      roles.push({ id: pack.role.id, title: pack.role.id, instructions: pack.role.instructions,
        instructionsRevision: await masRevisionOf(pack.role.instructions), capabilities: [] });
      messageAdapters.push({ id: pack.id, version: pack.revision });
      adapters.set(pack.id, { id: pack.id, version: pack.revision, render(input) {
        const rendered = renderGmplPrompt(pack, input.value.variables);
        if (!rendered.valid) researchFail('TRSH1001', rendered.issues[0].path, rendered.issues[0].detail);
        return rendered.value.user;
      } });
    }
    handlers.push({ id: 'research-prepare-' + stage, title: 'Prepare research ' + stage, effect: 'effectful', idempotency: 'honored' },
      { id: 'research-commit-' + stage, title: 'Commit research ' + stage, effect: 'effectful', idempotency: 'honored' });
    const nodes = [taskInvocation({ id: 'prepare', handler: 'research-prepare-' + stage, effect: 'effectful', input: { frame },
      output: { preparation, [inputPort]: inputSchema } }),
    pattern ? graphInvocation({ id: 'model', subgraph: pattern.validated.workflow.workflowId, input: { [inputPort]: inputSchema }, output: { [outputPort]: outputSchema } })
      : agentInvocation({ id: 'model', role: pack.role.id, profile, instructionsRevision: await masRevisionOf(pack.role.instructions),
        messageAdapter: pack.id, tools: [...RESEARCH_READ_TOOLS], input: { variables: inputSchema }, output: { out: outputSchema } }),
    taskInvocation({ id: 'commit', handler: 'research-commit-' + stage, effect: 'effectful',
      input: { preparation, proposal: outputSchema }, output: { frame } })];
    subgraphs.push(await defineMasWorkflow({ workflowId: 'research-model-' + stage, title: 'Research ' + stage,
      description: 'Admitted evidence, native model execution and atomic research commit; policy ' + revision, profile, limits,
      input: object({ frame }), output: object({ frame }), nodes,
      messages: [masMessage(['prepare', inputPort], ['model', inputPort]), masMessage(['prepare', 'preparation'], ['commit', 'preparation']),
        masMessage(['model', outputPort], ['commit', 'proposal'])], entry: [{ port: 'frame', to: { node: 'prepare', port: 'frame' } }],
      exit: [{ port: 'frame', from: { node: 'commit', port: 'frame' } }], registryRevision: null, configRegistryRevision: null }));
  }
  const unique = <T extends { id: string }>(rows: T[]) => {
    const found = new Map<string, T>();
    for (const row of rows) {
      if (found.has(row.id) && !equalsJson(found.get(row.id), row)) researchFail('TRSH1002', '/registry/' + row.id, 'Conflicting native reasoning capability.');
      found.set(row.id, row);
    }
    return [...found.values()];
  };
  return { policy, revision, roles: unique(roles), handlers: unique(handlers), tools: await researchToolDeclarations(),
    messageAdapters: unique(messageAdapters), subgraphs: [...new Map(subgraphs.map(row => [row.workflowId, row])).values()], taskHandlers, adapters };
}
export type PreparedResearchReasoning = Awaited<ReturnType<typeof createResearchReasoningWorkflow>>;
