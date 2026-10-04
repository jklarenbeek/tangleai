/** Native writer and GMPL controllers; research contributes no model-call loop. */
import { agentInvocation, taskInvocation, graphInvocation, switchInvocation, masMessage, defineMasWorkflow,
  masRevisionOf, masWorkflowVersionIdOf, type MasWorkflow, type MasRegistry, type MasHostBindings,
  type MasContextProvider, type JsonSchema, type WorkflowLimits } from '@tangleai/mas';
import { gmplSchemaOf, renderGmplPrompt } from '@tangleai/gmpl';
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { createResearchPatternHost, prepareResearchPattern, researchArtifacts } from './domain.ts';
import { researchSchemaOf } from './schema.ts';
import { researchFail, researchValue } from './workflow-contract.ts';
import { RESEARCH_PREPARATION_SCHEMA } from './reasoning-contract.ts';
import { researchWritingRevisionOf, type ResearchWritingPolicy } from './writing-contract.ts';
import { buildClaimLedger } from './stages/claims.ts';
import { researchDraftProposal } from './stages/write.ts';
import { researchWritingView } from './writing-view.ts';

const object = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const result = gmplSchemaOf('gmplPatternResult');
export const RESEARCH_REVIEW_PROPOSAL_SCHEMA = object(Object.fromEntries(['peer', 'red'].map(name => [name,
  { anyOf: [{ ...result, $id: String(result.$id) + '/' + name }, { type: 'null' }] }])));
export const RESEARCH_WRITING_CONTEXT = 'research-writing';
export function createResearchWritingContextProvider(): MasContextProvider {
  return { id: RESEARCH_WRITING_CONTEXT, async read(request, options) {
    if (options.signal.aborted) return { outcome: 'failed', reason: 'Writing context read was aborted.' };
    const query = request.query as { view?: unknown; variables?: { ledger_id?: unknown } };
    if (typeof query?.view !== 'string' || typeof query.variables?.ledger_id !== 'string')
      return { outcome: 'failed', reason: 'The prepared writer context is absent.' };
    if (options.maxUnits < 1 || query.view.length > options.maxChars)
      return { outcome: 'failed', reason: 'The complete admitted writer view cannot fit; it is never silently truncated.' };
    return { outcome: 'ok', units: [{ address: 'research:ledger/' + query.variables.ledger_id, text: query.view,
      citation: query.variables.ledger_id, capabilities: ['read'] }] };
  } };
}
export async function createResearchWritingWorkflow(policy: ResearchWritingPolicy, profile: string, limits: WorkflowLimits) {
  const revision = await researchWritingRevisionOf(policy), subgraphs: MasWorkflow[] = [];
  const roles: MasRegistry['roles'] = [], handlers: MasRegistry['handlers'] = [], messageAdapters: MasRegistry['messageAdapters'] = [];
  const taskHandlers: MasHostBindings['taskHandlers'] = {}, adapters = new Map<string, NonNullable<MasHostBindings['messageAdapters']> extends ReadonlyMap<string, infer V> ? V : never>();
  const roots: string[] = [];
  for (const purpose of ['draft-peer-review', 'draft-red-team'] as const) {
    const pattern = await prepareResearchPattern(purpose, await createResearchPatternHost(profile, limits));
    const prefix = 'research-' + purpose + '-';
    // Namespace native children to coexist with result review, then narrow only
    // their agent capabilities. Native policy and control nodes remain intact.
    for (const source of [...pattern.snapshot.subgraphs.values(), pattern.validated.workflow]) {
      const workflow = cloneJson(source); workflow.workflowId = prefix + workflow.workflowId;
      workflow.registry.revision = null; workflow.config.registryRevision = null;
      for (const node of workflow.nodes) {
        if (node.kind === 'graph') node.subgraph = prefix + node.subgraph;
        if (node.kind === 'loop') node.body = prefix + node.body;
        if (node.kind === 'agent') { node.tools = []; node.limits = { ...node.limits, calls: 1, toolRounds: 0 }; }
      }
      workflow.versionId = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>); subgraphs.push(workflow);
    }
    roots.push(prefix + pattern.validated.workflow.workflowId);
    roles.push(...pattern.snapshot.document.roles); handlers.push(...pattern.snapshot.document.handlers);
    messageAdapters.push(...pattern.snapshot.document.messageAdapters);
    Object.assign(taskHandlers, pattern.bindings.taskHandlers);
    for (const [id, adapter] of pattern.bindings.messageAdapters) adapters.set(id, adapter);
  }
  const pack = researchArtifacts.prompts.find(row => row.id === 'research-writer')!;
  roles.push({ id: pack.role.id, title: pack.role.title, instructions: pack.role.instructions,
    instructionsRevision: await masRevisionOf(pack.role.instructions), capabilities: [] });
  messageAdapters.push({ id: pack.id, version: pack.revision });
  adapters.set(pack.id, { id: pack.id, version: pack.revision, render(input) {
    const rendered = renderGmplPrompt(pack, input.value.variables);
    if (!rendered.valid) researchFail('TRSH1001', rendered.issues[0].path, rendered.issues[0].detail);
    return rendered.value.user;
  } });
  const pure = (id: string, handler: string, input: Record<string, JsonSchema>, output: Record<string, JsonSchema>) => {
    handlers.push({ id: handler, title: handler, effect: 'pure', idempotency: 'not-required' });
    return taskInvocation({ id, handler, effect: 'pure', input, output });
  };
  const ready: JsonSchema = { type: 'boolean' }, input = gmplSchemaOf('gmplInput'), proposal = RESEARCH_REVIEW_PROPOSAL_SCHEMA;
  subgraphs.push(await defineMasWorkflow({ workflowId: 'research-draft-reviews', title: 'Deterministic-first independent draft review',
    description: 'A refused draft bypasses both native review controllers; all accepted inputs remain immutable.', profile, limits,
    input: object({ ready, input }), output: object({ result: proposal }), nodes: [
      switchInvocation({ id: 'route', input: { ready, input }, output: { result: proposal }, mode: 'one-of', default: 'refused', branches: [
        { id: 'review', when: { $eq: ['$.ready', true] }, nodes: ['peer', 'red', 'collect'], result: { node: 'collect', port: 'result' } },
        { id: 'refused', when: { $eq: ['$.ready', false] }, nodes: ['refused'], result: { node: 'refused', port: 'result' } },
      ] }),
      graphInvocation({ id: 'peer', subgraph: roots[0], input: { input }, output: { result } }),
      graphInvocation({ id: 'red', subgraph: roots[1], input: { input }, output: { result } }),
      pure('collect', 'research-collect-draft-reviews', { peer: result, red: result }, { result: proposal }),
      pure('refused', 'research-refused-draft', { ready }, { result: proposal }),
    ], messages: [masMessage(['route', 'input'], ['peer', 'input']), masMessage(['route', 'input'], ['red', 'input']),
      masMessage(['route', 'ready'], ['refused', 'ready']), masMessage(['peer', 'result'], ['collect', 'peer']), masMessage(['red', 'result'], ['collect', 'red'])],
    entry: [{ port: 'ready', to: { node: 'route', port: 'ready' } }, { port: 'input', to: { node: 'route', port: 'input' } }],
    exit: [{ port: 'result', from: { node: 'route', port: 'result' } }], registryRevision: null, configRegistryRevision: null }));
  taskHandlers['research-collect-draft-reviews'] = input => ({ result: { peer: input.value.peer, red: input.value.red } });
  taskHandlers['research-refused-draft'] = () => ({ result: { peer: null, red: null } });
  taskHandlers['research-template-draft'] = async input => {
    const view = JSON.parse(input.value.view as string) as ReturnType<typeof researchWritingView>;
    const ledger = researchValue(await buildClaimLedger(view.inputs));
    if (!equalsJson(researchWritingView(view.inputs, ledger), view)) researchFail('TRSH1002', '/ledger', 'The template requires its complete unchanged admitted view.');
    return { out: researchDraftProposal(ledger) };
  };
  for (const stage of ['write', 'verify'] as const) {
    const frame = researchSchemaOf('ResearchWorkflowFrame'), preparation = { ...RESEARCH_PREPARATION_SCHEMA as Record<string, unknown>,
      properties: { ...(RESEARCH_PREPARATION_SCHEMA as { properties: Record<string, JsonSchema> }).properties, stage: { const: stage } } } as JsonSchema;
    const inputs: Record<string, JsonSchema> = stage === 'write' ? { variables: pack.variableSchema as JsonSchema, view: { type: 'string', minLength: 1 } } : { ready, input };
    const output = stage === 'write' ? pack.outputSchema : proposal, port = stage === 'write' ? 'out' : 'result';
    const model = stage === 'verify' ? graphInvocation({ id: 'model', subgraph: 'research-draft-reviews', input: inputs, output: { result: output } })
      : policy.mode === 'template' ? pure('model', 'research-template-draft', inputs, { out: output })
        : agentInvocation({ id: 'model', role: pack.role.id, profile, instructionsRevision: await masRevisionOf(pack.role.instructions),
          messageAdapter: pack.id, tools: [], context: [RESEARCH_WRITING_CONTEXT], limits: { calls: 1, toolRounds: 0 }, input: inputs, output: { out: output } });
    handlers.push(...['prepare', 'commit'].map(phase => ({ id: 'research-' + phase + '-' + stage, title: 'Research ' + phase + ' ' + stage,
      effect: 'effectful' as const, idempotency: 'honored' as const })));
    subgraphs.push(await defineMasWorkflow({ workflowId: 'research-model-' + stage, title: 'Research ' + stage,
      description: 'Exact admitted writing inputs, native execution and verified atomic commit; policy ' + revision, profile, limits,
      input: object({ frame }), output: object({ frame }), nodes: [
        taskInvocation({ id: 'prepare', handler: 'research-prepare-' + stage, effect: 'effectful', input: { frame }, output: { preparation, ...inputs } }), model,
        taskInvocation({ id: 'commit', handler: 'research-commit-' + stage, effect: 'effectful', input: { preparation, proposal: output }, output: { frame } }),
      ], messages: [...Object.keys(inputs).map(port => masMessage(['prepare', port], ['model', port], { id: 'prepare-' + port + '-model' })),
        masMessage(['prepare', 'preparation'], ['commit', 'preparation']), masMessage(['model', port], ['commit', 'proposal'])],
      entry: [{ port: 'frame', to: { node: 'prepare', port: 'frame' } }], exit: [{ port: 'frame', from: { node: 'commit', port: 'frame' } }],
      registryRevision: null, configRegistryRevision: null }));
  }
  return { policy, revision, subgraphs, roles, handlers, messageAdapters, taskHandlers, adapters,
    contextAdapters: [{ id: RESEARCH_WRITING_CONTEXT, title: 'Immutable admitted writing view', capabilities: ['read'] }],
    contextProviders: { [RESEARCH_WRITING_CONTEXT]: createResearchWritingContextProvider() } };
}
export type PreparedResearchWriting = Awaited<ReturnType<typeof createResearchWritingWorkflow>>;
