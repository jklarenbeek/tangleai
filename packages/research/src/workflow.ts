/** One native MAS topology; research owns no executor, checkpoint machine or queue. */
import { defineMasWorkflow, taskInvocation, graphInvocation, loopInvocation, switchInvocation, interactionInvocation,
  masMessage, createMasRegistrySnapshot, createMasConfigCatalog, validateMasWorkflow, planMasWorkflow, projectMasPlan,
  type MasWorkflow, type MasRegistrySnapshot, type MasConfigCatalog, type WorkflowLimits, type Invocation,
  type MessageEdge, type JsonSchema, type LoopNode } from '@tangleai/mas';
import type { ResearchContract } from './contracts.gen.ts';
import { researchSchemaOf, validateResearchShape } from './schema.ts';
import { immutableResearchJson, researchRevisionOf } from './identity.ts';
import { researchValue, researchMasValue, researchFail, type ResearchWorkflowBinding } from './workflow-contract.ts';
import type { ResearchReasoningPolicy } from './reasoning-contract.ts';
import { createResearchReasoningWorkflow, type PreparedResearchReasoning } from './reasoning-workflow.ts';
type QueryDocument = LoopNode['termination'];

export const RESEARCH_STAGES = ['create', 'discovery', 'literature', 'synthesis', 'hypothesis', 'design', 'design-approval',
  'execute', 'analyze', 'decide', 'write', 'verify', 'quality'] as const;
export type ResearchStageName = typeof RESEARCH_STAGES[number];
export const RESEARCH_FRAME_SCHEMA = researchSchemaOf('ResearchWorkflowFrame') as JsonSchema;
export const RESEARCH_RESPONSE_SCHEMA = researchSchemaOf('ResearchGateResponse') as JsonSchema;
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const envelope = object({ frame: RESEARCH_FRAME_SCHEMA });
const status = (value: string): QueryDocument => ({ $eq: ['$.frame.status', value] });
const decision = (value: string): QueryDocument => ({ $eq: ['$.frame.decision', value] });
const either = (...values: string[]): QueryDocument => ({ $or: values.map(status) });
interface TopologyOptions { profile: string; binding: ResearchWorkflowBinding; limits: WorkflowLimits; reasoning?: ResearchReasoningPolicy }
interface ResearchRegistry extends TopologyOptions { contract: ResearchContract; snapshot: MasRegistrySnapshot; model?: PreparedResearchReasoning }

function graph(options: TopologyOptions) {
  const nodes: Invocation[] = [], messages: MessageEdge[] = [];
  const task = (id: string, stage: ResearchStageName | 'relay' | 'refuse' = id as ResearchStageName, response = false) => {
    if (options.reasoning && ['synthesis', 'hypothesis', 'design'].includes(stage)) {
      nodes.push(graphInvocation({ id, subgraph: 'research-model-' + stage, input: { frame: RESEARCH_FRAME_SCHEMA }, output: { frame: RESEARCH_FRAME_SCHEMA } })); return;
    }
    nodes.push(taskInvocation({ id, handler: 'research-' + stage, effect: stage === 'relay' || stage === 'refuse' ? 'pure' : 'effectful',
      input: { frame: RESEARCH_FRAME_SCHEMA, ...(response ? { response: RESEARCH_RESPONSE_SCHEMA } : {}) }, output: { frame: RESEARCH_FRAME_SCHEMA } }));
  };
  const edge = (a: string, b: string, from = 'frame', to = 'frame') => {
    const port = to === 'frame' && nodes.some(n => n.id === b && n.kind === 'loop') ? 'initial' : to;
    messages.push(masMessage([a, from], [b, port], { id: `${a}-${from}-${b}-${port}` }));
  };
  const child = (id: string, subgraph: string) => nodes.push(graphInvocation({ id, subgraph, input: { frame: RESEARCH_FRAME_SCHEMA }, output: { frame: RESEARCH_FRAME_SCHEMA } }));
  const loop = (id: string, body: string, maxIterations: number, termination: QueryDocument) => nodes.push(loopInvocation({ id, body,
    input: { initial: RESEARCH_FRAME_SCHEMA }, output: { frame: RESEARCH_FRAME_SCHEMA }, init: [{ port: 'initial', to: '/frame' }],
    feedback: [{ from: '/frame', to: '/frame' }], result: [{ port: 'frame', from: '/frame' }], maxIterations, termination }));
  const route = (id: string, branches: Array<{ id: string; when: QueryDocument; nodes: string[]; result: string }>) => {
    const invalid = id + '-invalid';
    nodes.push(switchInvocation({ id, input: { frame: RESEARCH_FRAME_SCHEMA }, output: { routed: RESEARCH_FRAME_SCHEMA }, mode: 'one-of', default: 'invalid',
      branches: [...branches.map(b => ({ ...b, result: { node: b.result, port: 'frame' } })),
        { id: 'invalid', when: { $const: false }, nodes: [invalid], result: { node: invalid, port: 'frame' } }] }));
    task(invalid, 'refuse'); edge(id, invalid);
  };
  const gate = (id: string, before: string, apply: ResearchStageName) => {
    nodes.push(interactionInvocation({ id, input: { frame: RESEARCH_FRAME_SCHEMA }, output: { response: RESEARCH_RESPONSE_SCHEMA },
      prompt: RESEARCH_FRAME_SCHEMA, response: RESEARCH_RESPONSE_SCHEMA, expiry: null }));
    task(id + '-apply', apply, true); edge(before, id); edge(before, id + '-apply'); edge(id, id + '-apply', 'response', 'response');
    return id + '-apply';
  };
  const finish = (id: string, first: string, last: string, outputPort = 'frame', pins?: { registry: string; catalog: string }) => defineMasWorkflow({
    workflowId: id, title: id, description: 'Durable bounded research lifecycle; binding ' + options.binding.id,
    profile: options.profile, input: envelope, output: envelope, nodes, messages,
    entry: [{ port: 'frame', to: { node: first, port: nodes.some(n => n.id === first && n.kind === 'loop') ? 'initial' : 'frame' } }], exit: [{ port: 'frame', from: { node: last, port: outputPort } }],
    limits: options.limits, registryRevision: pins?.registry ?? null, configRegistryRevision: pins?.catalog ?? null,
    sourceDesignRevision: options.binding.id });
  return { nodes, task, edge, child, loop, route, gate, finish };
}

async function childWorkflows(contract: ResearchContract, options: TopologyOptions): Promise<MasWorkflow[]> {
  const children: MasWorkflow[] = [];
  // Retry from analysis uses the same bounded inner loop, without executing again.
  const refine = graph(options);
  refine.route('entry', [
    { id: 'execute', when: status('EXECUTE'), nodes: ['execute', 'analyze', 'decide'], result: 'decide' },
    { id: 'analyze', when: status('ANALYZE'), nodes: ['reanalyze', 'redecide'], result: 'redecide' },
  ]);
  for (const [id, stage] of [['execute', 'execute'], ['analyze', 'analyze'], ['decide', 'decide'], ['reanalyze', 'analyze'], ['redecide', 'decide']] as const) refine.task(id, stage);
  refine.edge('entry', 'execute'); refine.edge('execute', 'analyze'); refine.edge('analyze', 'decide');
  refine.edge('entry', 'reanalyze'); refine.edge('reanalyze', 'redecide');
  refine.route('decision', ['Proceed', 'Refine', 'Pivot', 'Stop'].map(value => ({ id: value.toLowerCase(), when: decision(value), nodes: [value.toLowerCase()], result: value.toLowerCase() })));
  refine.edge('entry', 'decision', 'routed');
  for (const value of ['proceed', 'refine', 'pivot', 'stop']) { refine.task(value, 'relay'); refine.edge('decision', value); }
  children.push(await refine.finish('research-refine-body', 'entry', 'decision', 'routed'));
  const refineLoop = graph(options);
  refineLoop.loop('refine', 'research-refine-body', contract.attemptCap, { $ne: ['$.output.frame.decision', 'Refine'] });
  children.push(await refineLoop.finish('research-refine', 'refine', 'refine'));

  const design = graph(options); design.task('design'); const approved = design.gate('design-gate', 'design', 'design-approval');
  children.push(await design.finish('research-design', 'design', approved));

  const pivot = graph(options);
  pivot.route('entry', [
    { id: 'synthesize', when: status('SYNTHESIS'), nodes: ['synthesis', 'hypothesis', 'new-design'], result: 'new-design' },
    { id: 'redesign', when: status('DESIGN'), nodes: ['redesign'], result: 'redesign' },
    { id: 'reanalyze', when: status('ANALYZE'), nodes: ['reanalyze'], result: 'reanalyze' },
  ]);
  pivot.task('synthesis'); pivot.task('hypothesis'); pivot.child('new-design', 'research-design'); pivot.child('redesign', 'research-design'); pivot.task('reanalyze', 'relay');
  pivot.edge('entry', 'synthesis'); pivot.edge('synthesis', 'hypothesis'); pivot.edge('hypothesis', 'new-design'); pivot.edge('entry', 'redesign'); pivot.edge('entry', 'reanalyze');
  pivot.route('execution', [
    { id: 'stop', when: status('STOPPED'), nodes: ['stopped'], result: 'stopped' },
    { id: 'run', when: either('EXECUTE', 'ANALYZE'), nodes: ['refine'], result: 'refine' },
  ]);
  pivot.edge('entry', 'execution', 'routed'); pivot.task('stopped', 'relay'); pivot.edge('execution', 'stopped');
  pivot.child('refine', 'research-refine'); pivot.edge('execution', 'refine');
  children.push(await pivot.finish('research-pivot-body', 'entry', 'execution', 'routed'));
  const pivotLoop = graph(options);
  pivotLoop.loop('pivot', 'research-pivot-body', contract.pivotCap, { $ne: ['$.output.frame.decision', 'Pivot'] });
  children.push(await pivotLoop.finish('research-pivot', 'pivot', 'pivot'));

  const writing = graph(options); writing.task('write'); writing.task('verify'); writing.edge('write', 'verify');
  const quality = writing.gate('quality-gate', 'verify', 'quality');
  writing.route('quality-decision', ['COMPLETE', 'STOPPED', 'WRITE', 'ANALYZE', 'DESIGN'].map(value => ({ id: value.toLowerCase(), when: status(value), nodes: [value.toLowerCase() + '-result'], result: value.toLowerCase() + '-result' })));
  writing.edge(quality, 'quality-decision');
  for (const value of ['complete', 'stopped', 'write', 'analyze', 'design']) { writing.task(value + '-result', 'relay'); writing.edge('quality-decision', value + '-result'); }
  children.push(await writing.finish('research-writing', 'write', 'quality-decision', 'routed'));

  const review = graph(options);
  review.route('entry', [
    { id: 'research', when: either('SYNTHESIS', 'DESIGN', 'ANALYZE'), nodes: ['pivot'], result: 'pivot' },
    { id: 'rewrite', when: status('WRITE'), nodes: ['rewrite'], result: 'rewrite' },
  ]);
  review.child('pivot', 'research-pivot'); review.edge('entry', 'pivot');
  review.task('rewrite', 'relay'); review.edge('entry', 'rewrite');
  review.route('report', [
    { id: 'stop', when: status('STOPPED'), nodes: ['stopped'], result: 'stopped' },
    { id: 'write', when: status('WRITE'), nodes: ['writing'], result: 'writing' },
  ]);
  review.edge('entry', 'report', 'routed'); review.task('stopped', 'relay'); review.edge('report', 'stopped');
  review.child('writing', 'research-writing'); review.edge('report', 'writing');
  children.push(await review.finish('research-review-body', 'entry', 'report', 'routed'));
  const reviewLoop = graph(options);
  reviewLoop.loop('review', 'research-review-body', contract.reviewCap, { $or: [{ $eq: ['$.output.frame.status', 'COMPLETE'] }, { $eq: ['$.output.frame.status', 'STOPPED'] }] });
  children.push(await reviewLoop.finish('research-review', 'review', 'review'));
  return children;
}

export async function createResearchRegistry(contract: ResearchContract, input: TopologyOptions): Promise<ResearchRegistry> {
  const options = immutableResearchJson(input), c = researchValue(validateResearchShape<ResearchContract>('ResearchContract', contract));
  const { contractHash, ...contractBody } = c;
  if (contractHash !== await researchRevisionOf(contractBody)) researchFail('TRSH1002', '/contractHash', 'Workflow contract does not recompute.');
  const { id, ...binding } = options.binding;
  if (id !== await researchRevisionOf(binding) || binding.contractHash !== c.contractHash)
    researchFail('TRSH1002', '/binding', 'Workflow binding does not match its content and contract.');
  if (options.limits.iterations < Math.max(c.attemptCap, c.pivotCap, c.reviewCap))
    researchFail('TRSH1006', '/limits/iterations', 'Native iteration limit must admit the declared research caps.');
  const children = await childWorkflows(c, options);
  const model = options.reasoning ? await createResearchReasoningWorkflow(options.reasoning, options.profile, options.limits) : undefined;
  if (model && !options.binding.toolVersions.some(row => row.name === 'research-reasoning' && row.version === model.revision))
    researchFail('TRSH1002', '/reasoning', 'The model topology must match the pinned research reasoning policy.');
  const snapshot = researchMasValue(await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'research-lifecycle', roles: [],
    ...(model ? { roles: model.roles } : {}),
    handlers: [...[...RESEARCH_STAGES, 'relay', 'refuse'].map(stage => ({ id: 'research-' + stage, title: 'Research ' + stage,
      effect: stage === 'relay' || stage === 'refuse' ? 'pure' : 'effectful', idempotency: stage === 'relay' || stage === 'refuse' ? 'not-required' : 'honored' })), ...(model?.handlers ?? [])],
    tools: model?.tools ?? [], contextAdapters: [], messageAdapters: [...new Map([{ id: 'json-schema', version: '0.1' }, ...(model?.messageAdapters ?? [])].map(row => [row.id, row])).values()], templates: [],
    subgraphs: [...children, ...(model?.subgraphs ?? [])].map(workflow => ({ id: workflow.workflowId, versionId: workflow.versionId, workflow })) }));
  return Object.freeze({ ...options, contract: c, snapshot, ...(model ? { model } : {}) });
}

/** Returns the native version; its exact children live in the supplied pinned registry. */
export async function defineResearchWorkflow(contract: ResearchContract, options: { registry: ResearchRegistry; catalog: MasConfigCatalog }): Promise<MasWorkflow> {
  const { registry, catalog } = options;
  if (await researchRevisionOf(contract) !== await researchRevisionOf(registry.contract)) researchFail('TRSH1002', '/contract', 'Registry and root must use the same contract.');
  const root = graph(registry); root.task('create'); root.task('discovery'); root.edge('create', 'discovery');
  const admitted = root.gate('literature-gate', 'discovery', 'literature');
  root.route('research', [
    { id: 'stop', when: status('STOPPED'), nodes: ['stopped'], result: 'stopped' },
    { id: 'continue', when: status('SYNTHESIS'), nodes: ['review'], result: 'review' },
  ]);
  root.edge(admitted, 'research'); root.task('stopped', 'relay'); root.edge('research', 'stopped');
  root.child('review', 'research-review');
  root.edge('research', 'review');
  return root.finish('research-lifecycle', 'create', 'research', 'routed', { registry: registry.snapshot.revision, catalog: catalog.revision });
}
export async function prepareResearchWorkflow(contract: ResearchContract, options: TopologyOptions) {
  const registry = await createResearchRegistry(contract, options);
  const catalog = researchMasValue(await createMasConfigCatalog({ profiles: [options.profile], tools: registry.model?.tools.map(row => row.id) ?? [], contexts: [], limits: options.limits }));
  const workflow = await defineResearchWorkflow(contract, { registry, catalog });
  const validated = researchMasValue(await validateMasWorkflow(workflow, registry.snapshot, catalog));
  const plan = researchMasValue(await planMasWorkflow(validated));
  return Object.freeze({ workflow, snapshot: registry.snapshot, catalog, validated, plan, binding: registry.binding, contract: registry.contract,
    ...(registry.model ? { model: registry.model } : {}), mermaid: projectMasPlan(plan) });
}
export type PreparedResearchWorkflow = Awaited<ReturnType<typeof prepareResearchWorkflow>>;
