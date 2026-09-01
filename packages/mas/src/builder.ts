/**
 * The imperative MAS authoring pen — typed construction, one canonical IR.
 *
 * The high-level MAS node union is not a Jaren flow format, so this pen
 * exists beside `@jarenjs/linq/flow` rather than distorting it: these
 * helpers emit exactly the `MasWorkflowVersion` JSON the declarative
 * loader accepts, and `defineMasWorkflow` computes the same canonical
 * `versionId` — a declarative and an imperative source that say the
 * same thing hash to the same version, with `compile.sourceMode` the
 * only (unhashed) difference. The MAS compiler itself uses the suite
 * pen for every lowered DAG/FSM; this pen never emits an executable
 * document.
 */

import { deepFreeze } from '@jarenjs/core/object';

import { masWorkflowVersionIdOf } from './identity.ts';
import type {
  AgentNode, GraphNode, InteractionNode, Invocation, JsonSchema, LoopNode,
  MasWorkflow, MessageEdge, NodeLimits, QueryDocument, StatePull, StatePush, SwitchNode, WorkflowLimits,
} from './contracts.gen.ts';

const DEFAULT_LIMITS: WorkflowLimits = {
  calls: 32,
  tokens: 200000,
  ms: 600000,
  toolRounds: 4,
  fanOut: 8,
  concurrency: 8,
  iterations: 8,
  contextChars: 40000,
  traceBytes: 1000000,
};

function ports(schemas: Record<string, JsonSchema>): { ports: Record<string, { schema: JsonSchema }> } {
  const out: Record<string, { schema: JsonSchema }> = {};
  for (const [name, schema] of Object.entries(schemas)) out[name] = { schema };
  return { ports: out };
}

interface CommonOptions {
  id: string;
  input: Record<string, JsonSchema>;
  output: Record<string, JsonSchema>;
  statePull?: StatePull;
  statePush?: StatePush;
  limits?: Exclude<NodeLimits, null>;
}

function common(options: CommonOptions): Pick<AgentNode, 'id' | 'input' | 'output' | 'statePull' | 'statePush' | 'limits'> {
  return {
    id: options.id,
    input: ports(options.input),
    output: ports(options.output),
    statePull: options.statePull ?? [],
    statePush: options.statePush ?? [],
    limits: options.limits ?? null,
  };
}

export function agentInvocation(options: CommonOptions & {
  role: string,
  profile: string,
  instructionsRevision: string,
  tools?: string[],
  context?: string[],
  messageAdapter?: string,
}): AgentNode {
  return {
    ...common(options),
    kind: 'agent',
    role: options.role,
    profile: options.profile,
    instructionsRevision: options.instructionsRevision,
    tools: options.tools ?? [],
    context: options.context ?? [],
    messageAdapter: options.messageAdapter ?? 'json-schema',
  };
}

export function taskInvocation(options: CommonOptions & {
  handler: string,
  effect?: 'pure' | 'read' | 'effectful',
}): Invocation {
  return {
    ...common(options),
    kind: 'task',
    handler: options.handler,
    effect: options.effect ?? 'pure',
  };
}

export function graphInvocation(options: CommonOptions & {
  subgraph: string,
  pull?: GraphNode['pull'],
  push?: GraphNode['push'],
}): GraphNode {
  return {
    ...common(options),
    kind: 'graph',
    subgraph: options.subgraph,
    pull: options.pull ?? [],
    push: options.push ?? [],
  };
}

export function loopInvocation(options: CommonOptions & {
  body: string,
  init: LoopNode['init'],
  feedback: LoopNode['feedback'],
  result: LoopNode['result'],
  maxIterations: number,
  termination: QueryDocument,
}): LoopNode {
  return {
    ...common(options),
    kind: 'loop',
    body: options.body,
    init: options.init,
    feedback: options.feedback,
    result: options.result,
    maxIterations: options.maxIterations,
    termination: options.termination,
  };
}

export function switchInvocation(options: CommonOptions & {
  mode: 'one-of' | 'multi-select',
  branches: SwitchNode['branches'],
  default: string | null,
}): SwitchNode {
  return {
    ...common(options),
    kind: 'switch',
    mode: options.mode,
    branches: options.branches,
    default: options.default,
  };
}

export function interactionInvocation(options: CommonOptions & {
  prompt: JsonSchema,
  response: JsonSchema,
  expiry?: { afterMs: number } | null,
}): InteractionNode {
  return {
    ...common(options),
    kind: 'interaction',
    prompt: { schema: options.prompt },
    response: { schema: options.response },
    expiry: options.expiry ?? null,
  };
}

export function masMessage(
  from: [node: string, port: string],
  to: [node: string, port: string],
  options: { aggregation?: MessageEdge['aggregation'], adapter?: string, select?: QueryDocument | null, id?: string } = {},
): MessageEdge {
  return {
    id: options.id ?? `${from[0]}-${to[0]}`,
    from: { node: from[0], port: from[1] },
    to: { node: to[0], port: to[1] },
    adapter: options.adapter ?? 'json-schema',
    select: options.select ?? null,
    aggregation: options.aggregation ?? 'one',
  };
}

export interface MasWorkflowSpec {
  workflowId: string;
  title: string;
  description: string;
  author?: string;
  parentVersionId?: string | null;
  input: JsonSchema;
  output: JsonSchema;
  entry: MasWorkflow['entry'];
  exit: MasWorkflow['exit'];
  state?: { schema: JsonSchema, init: unknown };
  nodes: Invocation[];
  control?: MasWorkflow['control'];
  messages?: MessageEdge[];
  limits?: WorkflowLimits;
  registryRevision: string | null;
  configRegistryRevision: string | null;
  profile: string;
  sourceDesignRevision?: string | null;
}

/** Emit the canonical IR with its computed semantic version. */
export async function defineMasWorkflow(spec: MasWorkflowSpec): Promise<MasWorkflow> {
  const workflow: MasWorkflow = {
    $mas: '0.1',
    workflowId: spec.workflowId,
    versionId: '0'.repeat(64),
    parentVersionId: spec.parentVersionId ?? null,
    title: spec.title,
    description: spec.description,
    provenance: { author: spec.author ?? 'imperative' },
    input: { schema: spec.input },
    output: { schema: spec.output },
    entry: spec.entry,
    exit: spec.exit,
    state: spec.state ?? { schema: { type: 'object', required: [], properties: {}, additionalProperties: false }, init: {} },
    nodes: spec.nodes,
    control: spec.control ?? [],
    messages: spec.messages ?? [],
    limits: spec.limits ?? DEFAULT_LIMITS,
    registry: { revision: spec.registryRevision },
    config: { registryRevision: spec.configRegistryRevision, profile: spec.profile },
    compile: {
      schemaVersion: '0.1',
      sourceMode: 'imperative',
      sourceDesignRevision: spec.sourceDesignRevision ?? null,
      executableRevision: null,
    },
  };
  workflow.versionId = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>);
  return deepFreeze(workflow) as MasWorkflow;
}
