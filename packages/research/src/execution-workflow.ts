/** Nested native loops retain one checkpoint per experiment without growing control payloads. */
import { defineMasWorkflow, taskInvocation, loopInvocation, switchInvocation, agentInvocation, masMessage, masRevisionOf,
  type JsonSchema, type WorkflowLimits, type MasRegistry, type MasHostBindings, type Invocation } from '@tangleai/mas';
import { researchSchemaOf } from './schema.ts';
import { RESEARCH_PREPARATION_SCHEMA } from './reasoning-contract.ts';
import { researchExecutionRevisionOf, type ResearchExecutionPolicy } from './execution-contract.ts';
import { researchAuthorDeclarations, RESEARCH_AUTHOR_TOOLS, RESEARCH_AUTHOR_INSTRUCTIONS, RESEARCH_AUTHOR_PROPOSAL } from './stages/author.ts';

const object = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const RESEARCH_EXECUTION_CURSOR_SCHEMA = object({ seed: { type: 'integer', minimum: 0, maximum: 8 },
  condition: { type: 'integer', minimum: 0, maximum: 8 }, conditionDone: { type: 'boolean' }, done: { type: 'boolean' } });
export const RESEARCH_EXECUTION_REF_SCHEMA = object({ artifactId: { type: 'string', pattern: '^art-[0-9a-f]{64}$' },
  admissionId: { type: 'string', pattern: '^admission-[0-9a-f]{64}$' } });
export async function createResearchExecutionWorkflow(policy: ResearchExecutionPolicy, profile: string, limits: WorkflowLimits) {
  const revision = await researchExecutionRevisionOf(policy), cursor = RESEARCH_EXECUTION_CURSOR_SCHEMA, frame = researchSchemaOf('ResearchWorkflowFrame');
  const preparation = { ...RESEARCH_PREPARATION_SCHEMA as Record<string, unknown>, properties: {
    ...(RESEARCH_PREPARATION_SCHEMA as { properties: Record<string, JsonSchema> }).properties, stage: { const: 'execute' },
  } } as JsonSchema;
  const task = (id: string, handler: string, input: Record<string, JsonSchema>, output: Record<string, JsonSchema>) =>
    taskInvocation({ id, handler, effect: 'effectful', input, output });
  const finish = (id: string, nodes: Parameters<typeof defineMasWorkflow>[0]['nodes'],
    messages: Parameters<typeof defineMasWorkflow>[0]['messages'], entry: Parameters<typeof defineMasWorkflow>[0]['entry'],
    exit: Parameters<typeof defineMasWorkflow>[0]['exit'], input = object({ cursor }), output = object({ cursor })) => defineMasWorkflow({
      workflowId: id, title: id, description: 'Manifest-bound native execution; policy ' + revision, profile, limits, input, output,
      nodes, messages, entry, exit, registryRevision: null, configRegistryRevision: null });
  const condition = await finish('research-execution-condition', [task('run', 'research-experiment', { cursor }, { cursor, receipt: RESEARCH_EXECUTION_REF_SCHEMA })], [],
    [{ port: 'cursor', to: { node: 'run', port: 'cursor' } }], [{ port: 'cursor', from: { node: 'run', port: 'cursor' } }]);
  const conditions = loopInvocation({ id: 'conditions', body: condition.workflowId, input: { initial: cursor }, output: { cursor },
    init: [{ port: 'initial', to: '/cursor' }], feedback: [{ from: '/cursor', to: '/cursor' }], result: [{ port: 'cursor', from: '/cursor' }],
    maxIterations: policy.maxConditions, termination: { $eq: ['$.output.cursor.conditionDone', true] } });
  const seed = await finish('research-execution-seed', [conditions, task('advance', 'research-execution-advance', { cursor }, { cursor })],
    [masMessage(['conditions', 'cursor'], ['advance', 'cursor'])], [{ port: 'cursor', to: { node: 'conditions', port: 'initial' } }],
    [{ port: 'cursor', from: { node: 'advance', port: 'cursor' } }]);
  const seeds = loopInvocation({ id: 'seeds', body: seed.workflowId, input: { initial: cursor }, output: { cursor },
    init: [{ port: 'initial', to: '/cursor' }], feedback: [{ from: '/cursor', to: '/cursor' }], result: [{ port: 'cursor', from: '/cursor' }],
    maxIterations: policy.maxSeeds, termination: { $eq: ['$.output.cursor.done', true] } });
  const nodes: Invocation[] = [task('prepare', 'research-prepare-execute', { frame }, { preparation, cursor, execution: RESEARCH_EXECUTION_REF_SCHEMA, reuse: { type: 'boolean' } }), seeds,
    task('commit', 'research-commit-execute', { preparation, cursor }, { frame })];
  const messages = [masMessage(['prepare', 'preparation'], ['commit', 'preparation']), masMessage(['seeds', 'cursor'], ['commit', 'cursor'])];
  const roles: MasRegistry['roles'] = [], messageAdapters: MasRegistry['messageAdapters'] = [];
  const adapters = new Map<string, NonNullable<MasHostBindings['messageAdapters']> extends ReadonlyMap<string, infer Value> ? Value : never>();
  if (policy.mode === 'authored') {
    const instructionsRevision = await masRevisionOf(RESEARCH_AUTHOR_INSTRUCTIONS);
    roles.push({ id: 'research-code-author', title: 'Bounded research code author', instructions: RESEARCH_AUTHOR_INSTRUCTIONS, instructionsRevision, capabilities: [] });
    messageAdapters.push({ id: 'research-code-author', version: revision });
    adapters.set('research-code-author', { id: 'research-code-author', version: revision,
      render: () => 'Read the frozen plan and workspace, write the required code into an allowed immutable slot, and return its entrypoint path.' });
    nodes.push(switchInvocation({ id: 'author-route', input: { cursor, execution: RESEARCH_EXECUTION_REF_SCHEMA, reuse: { type: 'boolean' } },
      output: { routed: cursor }, mode: 'one-of', default: 'author', branches: [
        { id: 'reuse', when: { $eq: ['$.reuse', true] }, nodes: ['reuse'], result: { node: 'reuse', port: 'cursor' } },
        { id: 'author', when: { $eq: ['$.reuse', false] }, nodes: ['author', 'seal'], result: { node: 'seal', port: 'cursor' } },
      ] }), task('reuse', 'research-execution-reuse', { cursor }, { cursor }),
    agentInvocation({ id: 'author', role: 'research-code-author', profile, instructionsRevision,
      messageAdapter: 'research-code-author', tools: [...RESEARCH_AUTHOR_TOOLS], input: { execution: RESEARCH_EXECUTION_REF_SCHEMA }, output: { out: RESEARCH_AUTHOR_PROPOSAL } }),
    task('seal', 'research-execution-seal', { cursor, proposal: RESEARCH_AUTHOR_PROPOSAL }, { cursor }));
    messages.push(...['cursor', 'execution', 'reuse'].map(port => masMessage(['prepare', port], ['author-route', port], { id: 'prepare-' + port + '-author-route' })),
      masMessage(['author-route', 'execution'], ['author', 'execution']), masMessage(['author', 'out'], ['seal', 'proposal']),
      masMessage(['author-route', 'cursor'], ['seal', 'cursor']), masMessage(['author-route', 'cursor'], ['reuse', 'cursor']),
      masMessage(['author-route', 'routed'], ['seeds', 'initial']));
  } else messages.push(masMessage(['prepare', 'cursor'], ['seeds', 'initial']));
  const root = await finish('research-execution', nodes, messages, [{ port: 'frame', to: { node: 'prepare', port: 'frame' } }],
    [{ port: 'frame', from: { node: 'commit', port: 'frame' } }], object({ frame }), object({ frame }));
  const handlers = ['research-prepare-execute', 'research-commit-execute', 'research-experiment', 'research-execution-advance',
    ...(policy.mode === 'authored' ? ['research-execution-seal', 'research-execution-reuse'] : [])].map(id => ({ id, title: id, effect: 'effectful' as const, idempotency: 'honored' as const }));
  return { policy, revision, roles, handlers, messageAdapters, adapters, tools: policy.mode === 'authored' ? await researchAuthorDeclarations() : [], subgraphs: [condition, seed, root] };
}
export type PreparedResearchExecution = Awaited<ReturnType<typeof createResearchExecutionWorkflow>>;
