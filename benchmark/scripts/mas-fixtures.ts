/* eslint-disable no-console */
/**
 * The MAS conformance fixture author — one deterministic generator for
 * every registered workflow byte.
 *
 * The registered fixtures are the contract a later MAS runtime is
 * judged against, so their bytes must be reproducible rather than
 * hand-maintained: this script holds the source definitions, computes
 * every canonical revision the documents pin (role instruction
 * revisions, the fixture registry snapshot revision, the CONFIG catalog
 * revision, each embedded subgraph's version and each workflow's own
 * `versionId`), and writes the fixture files and manifest with those
 * identities already resolved. Running it twice writes byte-identical
 * files; the conformance tests recompute the same identities from the
 * committed bytes and refuse drift.
 *
 * The workflow `versionId` rule pinned here is semantic: the canonical
 * SHA-256 of the workflow document with `versionId`, `provenance` and
 * `compile` excluded — authorship and source-mode provenance can never
 * move a version, and no clock, secret or observation has a
 * representable member anywhere in these documents.
 *
 *   node benchmark/scripts/mas-fixtures.ts            # write fixtures + manifest
 *   node benchmark/scripts/mas-fixtures.ts --check    # exit 1 if any byte differs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalSha256 } from '@jarenjs/json/canonical';

import { parseArgs } from '../lib/args.ts';

const args = parseArgs(process.argv.slice(2), { flags: ['check'] });
const ROOT = process.cwd();
const FIXTURE_DIR = 'benchmark/fixtures/mas';

// ---------------------------------------------------------------------------
// small schema builders — the fixtures close every object
// ---------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const STR: Json = { type: 'string' };
const NUM: Json = { type: 'number' };
const BOOL: Json = { type: 'boolean' };

function obj(properties: Record<string, Json>): Json {
  return {
    type: 'object',
    required: Object.keys(properties),
    properties,
    additionalProperties: false,
  };
}

function arr(items: Json): Json {
  return { type: 'array', items };
}

// ---------------------------------------------------------------------------
// the shared registry snapshot and CONFIG catalog
// ---------------------------------------------------------------------------

const ROLE_INSTRUCTIONS: Record<string, string> = {
  'drafter-research': 'Draft the research findings section for the weekly report from the brief. Use the metrics tool for grounding and answer with the requested structure.',
  'drafter-data': 'Draft the data metrics section for the weekly report from the brief. Use the metrics tool for grounding and answer with the requested structure.',
  'drafter-market': 'Draft the market risks and opportunities section for the weekly report from the brief. Use the metrics tool for grounding and answer with the requested structure.',
  'report-writer': 'Assemble the final weekly report from the three drafted sections, in the order they arrive. Answer with the requested structure.',
  'paid-agent': 'Answer the question in one short reply.',
};

async function buildRegistry(): Promise<{ document: Json, revision: string }> {
  const roles = [];
  for (const [id, instructions] of Object.entries(ROLE_INSTRUCTIONS)) {
    roles.push({
      id,
      title: id,
      instructions,
      instructionsRevision: await canonicalSha256(instructions),
      capabilities: [],
    });
  }

  const loopBody = await childWorkflow({
    workflowId: 'loop-body',
    title: 'Loop body — bump the counter',
    description: 'One scripted increment over the loop state; the loop host owns iteration and termination.',
    input: obj({ count: NUM }),
    output: obj({ count: NUM }),
    entry: [{ port: 'count', to: { node: 'bump', port: 'count' } }],
    exit: [{ port: 'count', from: { node: 'bump', port: 'value' } }],
    state: { schema: obj({}), init: {} },
    nodes: [
      taskNode('bump', {
        input: { count: NUM },
        output: { value: NUM },
      }),
    ],
    messages: [],
  });

  const childStateBody = await childWorkflow({
    workflowId: 'child-state-body',
    title: 'Nested state body — work over pulled state',
    description: 'Pulls one parent member into local state, produces one pushed member, and can address nothing else.',
    input: obj({ go: BOOL }),
    output: obj({ done: BOOL }),
    entry: [{ port: 'go', to: { node: 'work', port: 'go' } }],
    exit: [{ port: 'done', from: { node: 'work', port: 'done' } }],
    state: { schema: obj({ inherited: NUM, produced: NUM }), init: { inherited: 0, produced: 0 } },
    nodes: [
      taskNode('work', {
        input: { go: BOOL },
        output: { made: NUM, done: BOOL },
        statePull: [{ member: '/inherited', as: 'inherited' }],
        statePush: [{ from: 'made', member: '/produced' }],
      }),
    ],
    messages: [],
  });

  // Registry sections are sets: the snapshot canonicalizes them by id, so
  // the committed bytes are authored already sorted to be their own
  // canonical form.
  const byId = <T extends { id: string }>(items: T[]): T[] =>
    [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const document: Json = {
    $masRegistry: '0.1',
    registryId: 'mas-conformance-fixtures',
    roles: byId(roles) as unknown as Json,
    handlers: byId([
      { id: 'scripted', title: 'Scripted pure step', effect: 'pure', idempotency: 'not-required' },
      { id: 'scripted-read', title: 'Scripted read step', effect: 'read', idempotency: 'not-required' },
      { id: 'scripted-effectful', title: 'Scripted effectful step', effect: 'effectful', idempotency: 'honored' },
    ]) as unknown as Json,
    tools: [
      {
        id: 'fetch-metrics',
        title: 'Fetch one named metric',
        effect: 'read',
        input: obj({ metric: STR }),
        inputRevision: await canonicalSha256(obj({ metric: STR })),
      },
    ],
    messageAdapters: byId([
      { id: 'plain', version: '0.1' },
      { id: 'markdown-sections', version: '0.1' },
      { id: 'json-schema', version: '0.1' },
    ]) as unknown as Json,
    contextAdapters: byId([
      { id: 'memory', title: 'Curated memory recall', capabilities: ['read'] },
      { id: 'documents', title: 'Versioned document chunks', capabilities: ['read'] },
      { id: 'web', title: 'Read-only safe web', capabilities: ['read'] },
      { id: 'toolbox', title: 'Effective toolbox manifest', capabilities: ['read'] },
      { id: 'mcp', title: 'Injected MCP-compatible seam', capabilities: ['read'] },
    ]) as unknown as Json,
    templates: [],
    subgraphs: byId([
      { id: 'child-state-body', versionId: childStateBody.versionId as string, workflow: childStateBody },
      { id: 'loop-body', versionId: loopBody.versionId as string, workflow: loopBody },
    ]) as unknown as Json,
  };
  return { document, revision: await canonicalSha256(document) };
}

async function buildConfigCatalog(): Promise<{ document: Json, revision: string }> {
  const document: Json = {
    $masConfigCatalog: '0.1',
    catalogId: 'mas-conformance-fixtures',
    profiles: ['scripted'],
    tools: ['fetch-metrics'],
    contexts: ['memory', 'documents', 'web', 'toolbox', 'mcp'],
  };
  return { document, revision: await canonicalSha256(document) };
}

// ---------------------------------------------------------------------------
// workflow construction
// ---------------------------------------------------------------------------

const WORKFLOW_LIMITS: Json = {
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

interface NodeExtras {
  input: Record<string, Json>;
  output: Record<string, Json>;
  statePull?: Array<{ member: string, as: string }>;
  statePush?: Array<{ from: string, member: string }>;
  limits?: Json;
}

function ports(schemas: Record<string, Json>): Json {
  const out: Record<string, Json> = {};
  for (const [name, schema] of Object.entries(schemas)) out[name] = { schema };
  return { ports: out };
}

function baseNode(id: string, kind: string, extras: NodeExtras): Record<string, Json> {
  return {
    id,
    kind,
    input: ports(extras.input),
    output: ports(extras.output),
    statePull: (extras.statePull ?? []) as unknown as Json,
    statePush: (extras.statePush ?? []) as unknown as Json,
    limits: extras.limits ?? null,
  };
}

function taskNode(id: string, extras: NodeExtras & { handler?: string, effect?: string }): Json {
  return {
    ...baseNode(id, 'task', extras),
    handler: extras.handler ?? 'scripted',
    effect: extras.effect ?? 'pure',
  };
}

function agentNode(id: string, extras: NodeExtras & {
  role: string,
  instructionsRevision: string,
  tools?: string[],
  context?: string[],
  adapter?: string,
}): Json {
  return {
    ...baseNode(id, 'agent', extras),
    role: extras.role,
    profile: 'scripted',
    instructionsRevision: extras.instructionsRevision,
    tools: (extras.tools ?? []) as unknown as Json,
    context: (extras.context ?? []) as unknown as Json,
    messageAdapter: extras.adapter ?? 'json-schema',
  };
}

function message(from: [string, string], to: [string, string], aggregation = 'one', adapter = 'json-schema'): Json {
  return {
    id: `${from[0]}-${to[0]}`,
    from: { node: from[0], port: from[1] },
    to: { node: to[0], port: to[1] },
    adapter,
    select: null,
    aggregation,
  };
}

interface WorkflowSpec {
  workflowId: string;
  title: string;
  description: string;
  input: Json;
  output: Json;
  entry: Array<{ port: string, to: { node: string, port: string } }>;
  exit: Array<{ port: string, from: { node: string, port: string } }>;
  state?: { schema: Json, init: Json };
  nodes: Json[];
  control?: Json[];
  messages: Json[];
  limits?: Json;
  registryRevision?: string | null;
  configRevision?: string | null;
}

/** The semantic identity: the document without versionId, provenance and compile metadata. */
async function versionIdOf(workflow: Record<string, Json>): Promise<string> {
  const { versionId: _v, provenance: _p, compile: _c, ...semantic } = workflow;
  return canonicalSha256(semantic);
}

async function buildWorkflow(spec: WorkflowSpec): Promise<Record<string, Json>> {
  const workflow: Record<string, Json> = {
    $mas: '0.1',
    workflowId: spec.workflowId,
    versionId: '0'.repeat(64),
    parentVersionId: null,
    title: spec.title,
    description: spec.description,
    provenance: { author: 'tangle-conformance' },
    input: { schema: spec.input },
    output: { schema: spec.output },
    entry: spec.entry as unknown as Json,
    exit: spec.exit as unknown as Json,
    state: (spec.state ?? { schema: obj({}), init: {} }) as unknown as Json,
    nodes: spec.nodes,
    control: (spec.control ?? []) as unknown as Json,
    messages: spec.messages,
    limits: spec.limits ?? WORKFLOW_LIMITS,
    registry: { revision: spec.registryRevision ?? null },
    config: { registryRevision: spec.configRevision ?? null, profile: 'scripted' },
    compile: { schemaVersion: '0.1', sourceMode: 'declarative', sourceDesignRevision: null, executableRevision: null },
  };
  workflow.versionId = await versionIdOf(workflow);
  return workflow;
}

/** A subgraph-embedded workflow inherits its enclosing pins: null references. */
function childWorkflow(spec: WorkflowSpec): Promise<Record<string, Json>> {
  return buildWorkflow({ ...spec, registryRevision: null, configRevision: null });
}

// ---------------------------------------------------------------------------
// the eighteen fixtures
// ---------------------------------------------------------------------------

interface FixtureSpec {
  id: string;
  family: 'positive' | 'negative';
  title: string;
  workflow: Record<string, Json>;
  script: Json;
  expect: Json;
}

const EMPTY_SCRIPT = {
  input: null as Json,
  handlers: {} as Record<string, Json>,
  agents: {} as Record<string, Json>,
  gate: null as Json,
  stopAfter: null as Json,
  respond: null as Json,
  failAt: null as Json,
};

function script(overrides: Partial<typeof EMPTY_SCRIPT>): Json {
  return { ...EMPTY_SCRIPT, ...overrides } as unknown as Json;
}

function positiveExpect(overrides: {
  output: Json,
  events: string[],
  aggregations?: Json[],
  concurrency: { min: number, max: number },
  outcome?: 'completed' | 'failed',
  failure?: Json,
  calls?: number,
  toolCalls?: number,
  contextReads?: number,
  restores?: number,
}): Json {
  return {
    kind: 'pass',
    outcome: overrides.outcome ?? 'completed',
    output: overrides.output,
    failure: overrides.failure ?? null,
    events: overrides.events as unknown as Json,
    aggregations: (overrides.aggregations ?? []) as unknown as Json,
    concurrency: overrides.concurrency as unknown as Json,
    calls: overrides.calls ?? 0,
    toolCalls: overrides.toolCalls ?? 0,
    contextReads: overrides.contextReads ?? 0,
    restores: overrides.restores ?? 0,
  };
}

async function buildFixtures(registryRevision: string, configRevision: string, instructionsRevisions: Record<string, string>): Promise<FixtureSpec[]> {
  const pins = { registryRevision, configRevision };
  const fixtures: FixtureSpec[] = [];
  const partSchema = obj({ from: STR, topic: STR });

  // -- sequential ----------------------------------------------------------
  fixtures.push({
    id: 'sequential',
    family: 'positive',
    title: 'A then B; the typed value reaches the workflow output',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-sequential',
      title: 'Sequential',
      description: 'Two scripted tasks in series.',
      input: obj({ text: STR }),
      output: obj({ result: obj({ text: STR, by: STR }) }),
      entry: [{ port: 'text', to: { node: 'first', port: 'text' } }],
      exit: [{ port: 'result', from: { node: 'second', port: 'value' } }],
      nodes: [
        taskNode('first', { input: { text: STR }, output: { value: STR } }),
        taskNode('second', { input: { value: STR }, output: { value: obj({ text: STR, by: STR }) } }),
      ],
      messages: [message(['first', 'value'], ['second', 'value'])],
    }),
    script: script({
      input: { text: 'hello' },
      handlers: {
        first: { query: { value: '$.text' } },
        second: { query: { value: { text: '$.value', by: 'second' } } },
      },
    }),
    expect: positiveExpect({
      output: { result: { text: 'hello', by: 'second' } },
      events: ['first:completed', 'second:completed'],
      concurrency: { min: 1, max: 1 },
    }),
  });

  // -- fanout-fanin --------------------------------------------------------
  const fanNodes = (): Json[] => [
    taskNode('alpha', { input: { topic: STR }, output: { part: partSchema } }),
    taskNode('beta', { input: { topic: STR }, output: { part: partSchema } }),
    taskNode('gamma', { input: { topic: STR }, output: { part: partSchema } }),
    taskNode('join', { input: { parts: arr(partSchema) }, output: { merged: arr(partSchema) } }),
  ];
  const fanEntry = [
    { port: 'topic', to: { node: 'alpha', port: 'topic' } },
    { port: 'topic', to: { node: 'beta', port: 'topic' } },
    { port: 'topic', to: { node: 'gamma', port: 'topic' } },
  ];
  const fanMessages = (): Json[] => [
    message(['alpha', 'part'], ['join', 'parts'], 'ordered-list'),
    message(['beta', 'part'], ['join', 'parts'], 'ordered-list'),
    message(['gamma', 'part'], ['join', 'parts'], 'ordered-list'),
  ];
  const fanHandlers = {
    alpha: { query: { part: { from: 'alpha', topic: '$.topic' } } },
    beta: { query: { part: { from: 'beta', topic: '$.topic' } } },
    gamma: { query: { part: { from: 'gamma', topic: '$.topic' } } },
    join: { query: { merged: '$.parts' } },
  };
  const fanOutput = {
    result: [
      { from: 'alpha', topic: 't' },
      { from: 'beta', topic: 't' },
      { from: 'gamma', topic: 't' },
    ],
  };

  fixtures.push({
    id: 'fanout-fanin',
    family: 'positive',
    title: 'Three branches overlap; the join receives them in edge order',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-fanout-fanin',
      title: 'Fan-out fan-in',
      description: 'Three concurrent scripted branches merged by declared edge order.',
      input: obj({ topic: STR }),
      output: obj({ result: arr(partSchema) }),
      entry: fanEntry,
      exit: [{ port: 'result', from: { node: 'join', port: 'merged' } }],
      nodes: fanNodes(),
      messages: fanMessages(),
    }),
    script: script({
      input: { topic: 't' },
      handlers: fanHandlers,
      gate: { nodes: ['alpha', 'beta', 'gamma'], settleOrder: ['alpha', 'beta', 'gamma'] },
    }),
    expect: positiveExpect({
      output: fanOutput,
      events: ['alpha:completed', 'beta:completed', 'gamma:completed', 'join:completed'],
      aggregations: [{ node: 'join', port: 'parts', sources: ['alpha', 'beta', 'gamma'] }],
      concurrency: { min: 3, max: 3 },
    }),
  });

  // -- message-order -------------------------------------------------------
  fixtures.push({
    id: 'message-order',
    family: 'positive',
    title: 'Deliberately reversed completion; aggregation keeps declared order',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-message-order',
      title: 'Message order',
      description: 'The fan-in aggregation order is the declared edge order, not the completion order.',
      input: obj({ topic: STR }),
      output: obj({ result: arr(partSchema) }),
      entry: fanEntry,
      exit: [{ port: 'result', from: { node: 'join', port: 'merged' } }],
      nodes: fanNodes(),
      messages: fanMessages(),
    }),
    script: script({
      input: { topic: 't' },
      handlers: fanHandlers,
      gate: { nodes: ['alpha', 'beta', 'gamma'], settleOrder: ['gamma', 'beta', 'alpha'] },
    }),
    expect: positiveExpect({
      output: fanOutput,
      events: ['gamma:completed', 'beta:completed', 'alpha:completed', 'join:completed'],
      aggregations: [{ node: 'join', port: 'parts', sources: ['alpha', 'beta', 'gamma'] }],
      concurrency: { min: 3, max: 3 },
    }),
  });

  // -- switch-one ----------------------------------------------------------
  const routed = obj({ handled: STR, n: NUM });
  const switchValue = obj({ n: NUM });
  fixtures.push({
    id: 'switch-one',
    family: 'positive',
    title: 'Exactly one selected branch, with a default available',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-switch-one',
      title: 'One-of switch',
      description: 'Ordered query-guarded branches; only the selected branch region executes.',
      input: obj({ value: switchValue }),
      output: obj({ result: routed }),
      entry: [{ port: 'value', to: { node: 'route', port: 'value' } }],
      exit: [{ port: 'result', from: { node: 'route', port: 'routed' } }],
      nodes: [
        {
          ...baseNode('route', 'switch', { input: { value: switchValue }, output: { routed } }),
          mode: 'one-of',
          branches: [
            { id: 'high', when: { $ge: ['$.value.n', 10] }, nodes: ['handle-high'], result: { node: 'handle-high', port: 'out' } },
            { id: 'low', when: { $lt: ['$.value.n', 10] }, nodes: ['handle-low'], result: { node: 'handle-low', port: 'out' } },
          ],
          default: 'low',
        },
        taskNode('handle-high', { input: { value: switchValue }, output: { out: routed } }),
        taskNode('handle-low', { input: { value: switchValue }, output: { out: routed } }),
      ],
      messages: [
        message(['route', 'value'], ['handle-high', 'value']),
        message(['route', 'value'], ['handle-low', 'value']),
      ],
    }),
    script: script({
      input: { value: { n: 4 } },
      handlers: {
        'handle-high': { query: { out: { handled: 'high', n: '$.value.n' } } },
        'handle-low': { query: { out: { handled: 'low', n: '$.value.n' } } },
      },
    }),
    expect: positiveExpect({
      output: { result: { handled: 'low', n: 4 } },
      events: ['handle-low:completed', 'route:completed'],
      concurrency: { min: 1, max: 1 },
    }),
  });

  // -- switch-many ---------------------------------------------------------
  const flags = obj({ alpha: BOOL, beta: BOOL, gamma: BOOL });
  const branchOut = obj({ branch: STR });
  fixtures.push({
    id: 'switch-many',
    family: 'positive',
    title: 'Two selected branches execute in declaration order; the third is untouched',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-switch-many',
      title: 'Multi-select switch',
      description: 'Every true guard selects its branch; the merge is declaration order and an unselected branch never executes.',
      input: obj({ flags }),
      output: obj({ result: arr(branchOut) }),
      entry: [{ port: 'flags', to: { node: 'fan', port: 'flags' } }],
      exit: [{ port: 'result', from: { node: 'fan', port: 'results' } }],
      nodes: [
        {
          ...baseNode('fan', 'switch', { input: { flags }, output: { results: arr(branchOut) } }),
          mode: 'multi-select',
          branches: [
            { id: 'alpha', when: '$.flags.alpha', nodes: ['do-alpha'], result: { node: 'do-alpha', port: 'out' } },
            { id: 'beta', when: '$.flags.beta', nodes: ['do-beta'], result: { node: 'do-beta', port: 'out' } },
            { id: 'gamma', when: '$.flags.gamma', nodes: ['do-gamma'], result: { node: 'do-gamma', port: 'out' } },
          ],
          default: 'alpha',
        },
        taskNode('do-alpha', { input: { flags }, output: { out: branchOut } }),
        taskNode('do-beta', { input: { flags }, output: { out: branchOut } }),
        taskNode('do-gamma', { input: { flags }, output: { out: branchOut } }),
      ],
      messages: [
        message(['fan', 'flags'], ['do-alpha', 'flags']),
        message(['fan', 'flags'], ['do-beta', 'flags']),
        message(['fan', 'flags'], ['do-gamma', 'flags']),
      ],
    }),
    script: script({
      input: { flags: { alpha: true, beta: true, gamma: false } },
      handlers: {
        'do-alpha': { query: { out: { branch: 'alpha' } } },
        'do-beta': { query: { out: { branch: 'beta' } } },
        'do-gamma': { query: { out: { branch: 'gamma' } } },
      },
      gate: { nodes: ['do-alpha', 'do-beta'], settleOrder: ['do-beta', 'do-alpha'] },
    }),
    expect: positiveExpect({
      output: { result: [{ branch: 'alpha' }, { branch: 'beta' }] },
      events: ['do-beta:completed', 'do-alpha:completed', 'fan:completed'],
      aggregations: [{ node: 'fan', port: 'results', sources: ['do-alpha', 'do-beta'] }],
      concurrency: { min: 2, max: 2 },
    }),
  });

  // -- loop-three ----------------------------------------------------------
  const counter = obj({ count: NUM });
  fixtures.push({
    id: 'loop-three',
    family: 'positive',
    title: 'The body executes exactly three iterations and terminates',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-loop-three',
      title: 'Bounded loop',
      description: 'An FSM cycle around one acyclic body; the termination query runs after each committed body and the host owns the cap.',
      input: obj({ seed: counter }),
      output: obj({ result: counter }),
      entry: [{ port: 'seed', to: { node: 'refine', port: 'seed' } }],
      exit: [{ port: 'result', from: { node: 'refine', port: 'result' } }],
      nodes: [
        {
          ...baseNode('refine', 'loop', { input: { seed: counter }, output: { result: counter } }),
          body: 'loop-body',
          init: [{ port: 'seed', to: '' }],
          feedback: [{ from: '', to: '' }],
          result: [{ port: 'result', from: '' }],
          maxIterations: 5,
          termination: { $ge: ['$.output.count', 3] },
        },
      ],
      messages: [],
    }),
    script: script({
      input: { seed: { count: 0 } },
      handlers: {
        'refine/bump': { query: { value: { $add: ['$.count', 1] } } },
      },
    }),
    expect: positiveExpect({
      output: { result: { count: 3 } },
      events: ['refine/1/bump:completed', 'refine/2/bump:completed', 'refine/3/bump:completed', 'refine:completed'],
      concurrency: { min: 1, max: 1 },
    }),
  });

  // -- nested-state --------------------------------------------------------
  fixtures.push({
    id: 'nested-state',
    family: 'positive',
    title: 'The child pulls one member, pushes one member, and cannot address another',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-nested-state',
      title: 'Nested graph state',
      description: 'A graph node with declared pull/push mappings over namespace-isolated state.',
      input: obj({ go: BOOL }),
      output: obj({ result: obj({ visible: NUM }) }),
      entry: [{ port: 'go', to: { node: 'sub', port: 'go' } }],
      exit: [{ port: 'result', from: { node: 'read-out', port: 'out' } }],
      state: { schema: obj({ visible: NUM, hidden: NUM }), init: { visible: 7, hidden: 99 } },
      nodes: [
        {
          ...baseNode('sub', 'graph', { input: { go: BOOL }, output: { done: BOOL } }),
          subgraph: 'child-state-body',
          pull: [{ parent: '/visible', child: '/inherited' }],
          push: [{ child: '/produced', parent: '/visible' }],
        },
        taskNode('read-out', {
          input: { done: BOOL },
          output: { out: obj({ visible: NUM }) },
          statePull: [{ member: '/visible', as: 'visible' }],
        }),
      ],
      messages: [message(['sub', 'done'], ['read-out', 'done'])],
    }),
    script: script({
      input: { go: true },
      handlers: {
        'sub/work': { query: { made: { $add: ['$.inherited', 1] }, done: true } },
        'read-out': { query: { out: { visible: '$.visible' } } },
      },
    }),
    expect: positiveExpect({
      output: { result: { visible: 8 } },
      events: ['sub/work:completed', 'sub:completed', 'read-out:completed'],
      concurrency: { min: 1, max: 1 },
    }),
  });

  // -- interaction ---------------------------------------------------------
  const decision = obj({ decision: { enum: ['accept', 'revise'] }, note: STR });
  const summary = obj({ summary: STR });
  fixtures.push({
    id: 'interaction',
    family: 'positive',
    title: 'The run waits; one typed response resumes the same run',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-interaction',
      title: 'Typed interaction',
      description: 'A persisted wait with a typed response that resumes the same run without any live worker holding it.',
      input: obj({ draft: STR }),
      output: obj({ result: decision }),
      entry: [{ port: 'draft', to: { node: 'prepare', port: 'draft' } }],
      exit: [{ port: 'result', from: { node: 'apply', port: 'out' } }],
      nodes: [
        taskNode('prepare', { input: { draft: STR }, output: { summary } }),
        {
          ...baseNode('approve', 'interaction', { input: { summary }, output: { decision } }),
          prompt: { schema: summary },
          response: { schema: decision },
          expiry: { afterMs: 86400000 },
        },
        taskNode('apply', { input: { decision }, output: { out: decision } }),
      ],
      messages: [
        message(['prepare', 'summary'], ['approve', 'summary']),
        message(['approve', 'decision'], ['apply', 'decision']),
      ],
    }),
    script: script({
      input: { draft: 'd1' },
      handlers: {
        prepare: { query: { summary: { summary: { $concat: ['about: ', '$.draft'] } } } },
        apply: { query: { out: '$.decision' } },
      },
      respond: { node: 'approve', value: { decision: 'accept', note: 'ok' } },
    }),
    expect: positiveExpect({
      output: { result: { decision: 'accept', note: 'ok' } },
      events: ['prepare:completed', 'approve:waiting', 'approve:completed', 'apply:completed'],
      concurrency: { min: 1, max: 1 },
    }),
  });

  // -- checkpoint ----------------------------------------------------------
  fixtures.push({
    id: 'checkpoint',
    family: 'positive',
    title: 'A completed paid node restores with zero duplicate provider calls',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-checkpoint',
      title: 'Checkpoint restore',
      description: 'One paid agent node completes, the process stops, and recovery restores the value instead of buying it again.',
      input: obj({ question: STR }),
      output: obj({ result: obj({ answer: STR }) }),
      entry: [{ port: 'question', to: { node: 'paid', port: 'question' } }],
      exit: [{ port: 'result', from: { node: 'wrap', port: 'out' } }],
      nodes: [
        agentNode('paid', {
          role: 'paid-agent',
          instructionsRevision: instructionsRevisions['paid-agent'],
          adapter: 'plain',
          input: { question: STR },
          output: { answer: STR },
        }),
        taskNode('wrap', { input: { answer: STR }, output: { out: obj({ answer: STR }) } }),
      ],
      messages: [message(['paid', 'answer'], ['wrap', 'answer'])],
    }),
    script: script({
      input: { question: 'q' },
      handlers: { wrap: { query: { out: { answer: '$.answer' } } } },
      agents: {
        paid: { turns: [{ content: 'the answer', usage: { prompt_tokens: 5, completion_tokens: 3 } }] },
      },
      stopAfter: 'paid',
    }),
    expect: positiveExpect({
      output: { result: { answer: 'the answer' } },
      events: ['paid:completed', 'paid:restored', 'wrap:completed'],
      concurrency: { min: 1, max: 1 },
      calls: 1,
      restores: 1,
    }),
  });

  // -- failure-abort -------------------------------------------------------
  fixtures.push({
    id: 'failure-abort',
    family: 'positive',
    title: 'The first failure is named; the concurrent sibling sees abort; no partial output',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-failure-abort',
      title: 'Failure and abort',
      description: 'One scripted failure aborts its concurrent sibling and the run has no partial workflow output.',
      input: obj({ x: NUM }),
      output: obj({ result: obj({ a: NUM, b: NUM }) }),
      entry: [
        { port: 'x', to: { node: 'boom', port: 'x' } },
        { port: 'x', to: { node: 'slow', port: 'x' } },
      ],
      exit: [{ port: 'result', from: { node: 'merge', port: 'out' } }],
      nodes: [
        taskNode('boom', { input: { x: NUM }, output: { out: NUM } }),
        taskNode('slow', { input: { x: NUM }, output: { out: NUM } }),
        taskNode('merge', { input: { a: NUM, b: NUM }, output: { out: obj({ a: NUM, b: NUM }) } }),
      ],
      messages: [
        message(['boom', 'out'], ['merge', 'a']),
        message(['slow', 'out'], ['merge', 'b']),
      ],
    }),
    script: script({
      input: { x: 1 },
      handlers: {
        boom: { query: { out: '$.x' } },
        slow: { query: { out: '$.x' } },
        merge: { query: { out: { a: '$.a', b: '$.b' } } },
      },
      gate: { nodes: ['boom', 'slow'], settleOrder: ['boom'] },
      failAt: 'boom',
    }),
    expect: positiveExpect({
      outcome: 'failed',
      output: null,
      failure: { node: 'boom' },
      events: ['boom:failed', 'slow:aborted'],
      concurrency: { min: 2, max: 2 },
    }),
  });

  // -- weekly-report-manual ------------------------------------------------
  const findings = obj({ findings: arr(STR) });
  const metrics = obj({ metrics: arr(STR) });
  const risks = obj({ risks: arr(STR) });
  const report = obj({ title: STR, sections: arr(STR) });
  const draftUnion: Json = { anyOf: [findings, metrics, risks] };
  fixtures.push({
    id: 'weekly-report-manual',
    family: 'positive',
    title: 'START, three concurrent drafters, one ordered finalizer, END',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-weekly-report',
      title: 'Weekly report',
      description: 'Three drafting agents run concurrently over one brief; the writer receives their validated structured results in declared edge order and finalizes the report.',
      input: obj({ brief: STR }),
      output: obj({ report }),
      entry: [
        { port: 'brief', to: { node: 'researcher', port: 'brief' } },
        { port: 'brief', to: { node: 'data-analyst', port: 'brief' } },
        { port: 'brief', to: { node: 'market-analyst', port: 'brief' } },
      ],
      exit: [{ port: 'report', from: { node: 'writer', port: 'report' } }],
      nodes: [
        agentNode('researcher', {
          role: 'drafter-research',
          instructionsRevision: instructionsRevisions['drafter-research'],
          tools: ['fetch-metrics'],
          adapter: 'markdown-sections',
          input: { brief: STR },
          output: { findings },
        }),
        agentNode('data-analyst', {
          role: 'drafter-data',
          instructionsRevision: instructionsRevisions['drafter-data'],
          tools: ['fetch-metrics'],
          adapter: 'markdown-sections',
          input: { brief: STR },
          output: { metrics },
        }),
        agentNode('market-analyst', {
          role: 'drafter-market',
          instructionsRevision: instructionsRevisions['drafter-market'],
          tools: ['fetch-metrics'],
          adapter: 'markdown-sections',
          input: { brief: STR },
          output: { risks },
        }),
        agentNode('writer', {
          role: 'report-writer',
          instructionsRevision: instructionsRevisions['report-writer'],
          context: ['memory'],
          adapter: 'markdown-sections',
          input: { drafts: arr(draftUnion) },
          output: { report },
        }),
      ],
      messages: [
        message(['researcher', 'findings'], ['writer', 'drafts'], 'ordered-list', 'markdown-sections'),
        message(['data-analyst', 'metrics'], ['writer', 'drafts'], 'ordered-list', 'markdown-sections'),
        message(['market-analyst', 'risks'], ['writer', 'drafts'], 'ordered-list', 'markdown-sections'),
      ],
    }),
    script: script({
      input: { brief: 'Q3 metrics' },
      agents: {
        researcher: {
          turns: [
            { toolCall: { name: 'fetch-metrics', arguments: { metric: 'research' } }, usage: { prompt_tokens: 4, completion_tokens: 2 } },
            { content: 'research summary', usage: { prompt_tokens: 6, completion_tokens: 3 } },
            { content: '{"findings":["research summary"]}', usage: { prompt_tokens: 5, completion_tokens: 4 } },
          ],
        },
        'data-analyst': {
          turns: [
            { toolCall: { name: 'fetch-metrics', arguments: { metric: 'data' } }, usage: { prompt_tokens: 4, completion_tokens: 2 } },
            { content: 'data summary', usage: { prompt_tokens: 6, completion_tokens: 3 } },
            { content: '{"metrics":["data summary"]}', usage: { prompt_tokens: 5, completion_tokens: 4 } },
          ],
        },
        'market-analyst': {
          turns: [
            { toolCall: { name: 'fetch-metrics', arguments: { metric: 'market' } }, usage: { prompt_tokens: 4, completion_tokens: 2 } },
            { content: 'market summary', usage: { prompt_tokens: 6, completion_tokens: 3 } },
            { content: '{"risks":["market summary"]}', usage: { prompt_tokens: 5, completion_tokens: 4 } },
          ],
        },
        writer: {
          turns: [
            { content: 'final report', usage: { prompt_tokens: 8, completion_tokens: 5 } },
            { content: '{"title":"Weekly report","sections":["research summary","data summary","market summary"]}', usage: { prompt_tokens: 7, completion_tokens: 6 } },
          ],
        },
      },
      gate: { nodes: ['researcher', 'data-analyst', 'market-analyst'], settleOrder: ['market-analyst', 'data-analyst', 'researcher'] },
    }),
    expect: positiveExpect({
      output: { report: { title: 'Weekly report', sections: ['research summary', 'data summary', 'market summary'] } },
      events: ['market-analyst:completed', 'data-analyst:completed', 'researcher:completed', 'writer:completed'],
      aggregations: [{ node: 'writer', port: 'drafts', sources: ['researcher', 'data-analyst', 'market-analyst'] }],
      concurrency: { min: 3, max: 3 },
      calls: 11,
      toolCalls: 3,
      contextReads: 1,
    }),
  });

  // -- negative: plain-cycle ----------------------------------------------
  fixtures.push({
    id: 'plain-cycle',
    family: 'negative',
    title: 'A message cycle outside a declared loop refuses at the closing edge',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-neg-cycle',
      title: 'Plain cycle',
      description: 'Three tasks whose third message edge closes an undeclared cycle.',
      input: obj({ seed: STR }),
      output: obj({ result: STR }),
      entry: [{ port: 'seed', to: { node: 'a', port: 'seed' } }],
      exit: [{ port: 'result', from: { node: 'c', port: 'v' } }],
      nodes: [
        taskNode('a', { input: { seed: STR, back: STR }, output: { v: STR } }),
        taskNode('b', { input: { v: STR }, output: { v: STR } }),
        taskNode('c', { input: { v: STR }, output: { v: STR } }),
      ],
      messages: [
        message(['a', 'v'], ['b', 'v']),
        message(['b', 'v'], ['c', 'v']),
        message(['c', 'v'], ['a', 'back']),
      ],
    }),
    script: script({ input: { seed: 's' } }),
    expect: { kind: 'refusal', code: 'TMAS1005', path: '/messages/2' },
  });

  // -- negative: unknown-port ---------------------------------------------
  fixtures.push({
    id: 'unknown-port',
    family: 'negative',
    title: 'A message edge naming an undeclared target port refuses at that member',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-neg-unknown-port',
      title: 'Unknown port',
      description: 'The second edge targets a port the consumer never declared.',
      input: obj({ seed: STR }),
      output: obj({ result: STR }),
      entry: [{ port: 'seed', to: { node: 'a', port: 'seed' } }],
      exit: [{ port: 'result', from: { node: 'b', port: 'v' } }],
      nodes: [
        taskNode('a', { input: { seed: STR }, output: { v: STR } }),
        taskNode('b', { input: { v: STR }, output: { v: STR } }),
      ],
      messages: [
        message(['a', 'v'], ['b', 'v']),
        {
          id: 'a-b-ghost',
          from: { node: 'a', port: 'v' },
          to: { node: 'b', port: 'ghost' },
          adapter: 'json-schema',
          select: null,
          aggregation: 'one',
        },
      ],
    }),
    script: script({ input: { seed: 's' } }),
    expect: { kind: 'refusal', code: 'TMAS1004', path: '/messages/1/to/port' },
  });

  // -- negative: switch-no-default ----------------------------------------
  fixtures.push({
    id: 'switch-no-default',
    family: 'negative',
    title: 'A non-exhaustive switch without a default refuses at the default contract',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-neg-switch-default',
      title: 'Switch without default',
      description: 'Two guards that provably do not cover the input space, and no declared default.',
      input: obj({ value: switchValue }),
      output: obj({ result: routed }),
      entry: [{ port: 'value', to: { node: 'route', port: 'value' } }],
      exit: [{ port: 'result', from: { node: 'route', port: 'routed' } }],
      nodes: [
        {
          ...baseNode('route', 'switch', { input: { value: switchValue }, output: { routed } }),
          mode: 'one-of',
          branches: [
            { id: 'high', when: { $ge: ['$.value.n', 10] }, nodes: ['handle-high'], result: { node: 'handle-high', port: 'out' } },
            { id: 'low', when: { $lt: ['$.value.n', 5] }, nodes: ['handle-low'], result: { node: 'handle-low', port: 'out' } },
          ],
          default: null,
        },
        taskNode('handle-high', { input: { value: switchValue }, output: { out: routed } }),
        taskNode('handle-low', { input: { value: switchValue }, output: { out: routed } }),
      ],
      messages: [
        message(['route', 'value'], ['handle-high', 'value']),
        message(['route', 'value'], ['handle-low', 'value']),
      ],
    }),
    script: script({ input: { value: { n: 7 } } }),
    expect: { kind: 'refusal', code: 'TMAS1006', path: '/nodes/0/default' },
  });

  // -- negative: unbounded-loop -------------------------------------------
  fixtures.push({
    id: 'unbounded-loop',
    family: 'negative',
    title: 'A loop without a positive iteration cap refuses at maxIterations',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-neg-loop',
      title: 'Unbounded loop',
      description: 'The declared cap is zero, which no model output may repair at runtime.',
      input: obj({ seed: counter }),
      output: obj({ result: counter }),
      entry: [{ port: 'seed', to: { node: 'refine', port: 'seed' } }],
      exit: [{ port: 'result', from: { node: 'refine', port: 'result' } }],
      nodes: [
        {
          ...baseNode('refine', 'loop', { input: { seed: counter }, output: { result: counter } }),
          body: 'loop-body',
          init: [{ port: 'seed', to: '' }],
          feedback: [{ from: '', to: '' }],
          result: [{ port: 'result', from: '' }],
          maxIterations: 0,
          termination: { $ge: ['$.output.count', 3] },
        },
      ],
      messages: [],
    }),
    script: script({ input: { seed: { count: 0 } } }),
    expect: { kind: 'refusal', code: 'TMAS1007', path: '/nodes/0/maxIterations' },
  });

  // -- negative: undeclared-tool ------------------------------------------
  fixtures.push({
    id: 'undeclared-tool',
    family: 'negative',
    title: 'An agent requesting a tool the registry does not declare refuses at the reference',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-neg-tool',
      title: 'Undeclared tool',
      description: 'The requested tool subset names a capability no registry snapshot carries.',
      input: obj({ question: STR }),
      output: obj({ result: STR }),
      entry: [{ port: 'question', to: { node: 'paid', port: 'question' } }],
      exit: [{ port: 'result', from: { node: 'paid', port: 'answer' } }],
      nodes: [
        agentNode('paid', {
          role: 'paid-agent',
          instructionsRevision: instructionsRevisions['paid-agent'],
          tools: ['ghost-tool'],
          adapter: 'plain',
          input: { question: STR },
          output: { answer: STR },
        }),
      ],
      messages: [],
    }),
    script: script({ input: { question: 'q' } }),
    expect: { kind: 'refusal', code: 'TMAS1009', path: '/nodes/0/tools/0' },
  });

  // -- negative: child-over-budget ----------------------------------------
  fixtures.push({
    id: 'child-over-budget',
    family: 'negative',
    title: 'A node cap above its workflow cap refuses at the child limit',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-neg-budget',
      title: 'Child over budget',
      description: 'The node asks for more calls than the whole workflow may spend.',
      input: obj({ question: STR }),
      output: obj({ result: STR }),
      entry: [{ port: 'question', to: { node: 'paid', port: 'question' } }],
      exit: [{ port: 'result', from: { node: 'paid', port: 'answer' } }],
      limits: { ...(WORKFLOW_LIMITS as Record<string, Json>), calls: 10 },
      nodes: [
        agentNode('paid', {
          role: 'paid-agent',
          instructionsRevision: instructionsRevisions['paid-agent'],
          adapter: 'plain',
          input: { question: STR },
          output: { answer: STR },
          limits: { calls: 50 },
        }),
      ],
      messages: [],
    }),
    script: script({ input: { question: 'q' } }),
    expect: { kind: 'refusal', code: 'TMAS1008', path: '/nodes/0/limits/calls' },
  });

  // -- negative: incompatible-wire ----------------------------------------
  fixtures.push({
    id: 'incompatible-wire',
    family: 'negative',
    title: 'A message edge whose source cannot satisfy its target schema refuses at the mapping',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-neg-wire',
      title: 'Incompatible wire',
      description: 'A string output feeding a number input can never validate; the wire refuses at compile time.',
      input: obj({ seed: STR }),
      output: obj({ result: NUM }),
      entry: [{ port: 'seed', to: { node: 'a', port: 'seed' } }],
      exit: [{ port: 'result', from: { node: 'b', port: 'v' } }],
      nodes: [
        taskNode('a', { input: { seed: STR }, output: { v: STR } }),
        taskNode('b', { input: { v: NUM }, output: { v: NUM } }),
      ],
      messages: [message(['a', 'v'], ['b', 'v'])],
    }),
    script: script({ input: { seed: 's' } }),
    expect: { kind: 'refusal', code: 'TMAS1004', path: '/messages/0/to' },
  });

  return fixtures;
}

// ---------------------------------------------------------------------------
// the control-order manual fixtures — separate registry, never in the manifest
// ---------------------------------------------------------------------------

const CONTROL_ROLE_INSTRUCTIONS: Record<string, string> = {
  'analyst-alpha': 'Analyze the brief with a conservative lens and answer with the requested structure.',
  'analyst-beta': 'Analyze the brief with an aggressive lens and answer with the requested structure.',
};

async function buildControlRegistry(): Promise<{ document: Json, revision: string, roleRevisions: Record<string, string> }> {
  const roleRevisions: Record<string, string> = {};
  const roles = [];
  for (const [id, instructions] of Object.entries(CONTROL_ROLE_INSTRUCTIONS)) {
    const instructionsRevision = await canonicalSha256(instructions);
    roleRevisions[id] = instructionsRevision;
    roles.push({ id, title: id, instructions, instructionsRevision, capabilities: [] });
  }

  const reflectionBody = await childWorkflow({
    workflowId: 'reflection-body',
    title: 'Reflection body — critique then revise',
    description: 'One reflection round: critique the draft, revise it, raise its quality by one.',
    input: obj({ text: STR, quality: NUM }),
    output: obj({ text: STR, quality: NUM }),
    entry: [{ port: 'text', to: { node: 'reflect', port: 'text' } }, { port: 'quality', to: { node: 'reflect', port: 'quality' } }],
    exit: [{ port: 'text', from: { node: 'revise', port: 'text' } }, { port: 'quality', from: { node: 'revise', port: 'quality' } }],
    state: { schema: obj({}), init: {} },
    nodes: [
      taskNode('reflect', { input: { text: STR, quality: NUM }, output: { critique: obj({ text: STR, quality: NUM }) } }),
      taskNode('revise', { input: { critique: obj({ text: STR, quality: NUM }) }, output: { text: STR, quality: NUM } }),
    ],
    messages: [message(['reflect', 'critique'], ['revise', 'critique'])],
  });

  const retryBody = await childWorkflow({
    workflowId: 'retry-body',
    title: 'Retry body — one bounded recovery attempt',
    description: 'One declared recovery attempt whose failure is a typed value, never a thrown region failure.',
    input: obj({ n: NUM, goal: NUM }),
    output: obj({ ok: BOOL, n: NUM, goal: NUM }),
    entry: [{ port: 'n', to: { node: 'try', port: 'n' } }, { port: 'goal', to: { node: 'try', port: 'goal' } }],
    exit: [
      { port: 'ok', from: { node: 'try', port: 'ok' } },
      { port: 'n', from: { node: 'try', port: 'n' } },
      { port: 'goal', from: { node: 'try', port: 'goal' } },
    ],
    state: { schema: obj({}), init: {} },
    nodes: [
      taskNode('try', { input: { n: NUM, goal: NUM }, output: { ok: BOOL, n: NUM, goal: NUM } }),
    ],
    messages: [],
  });

  const document: Json = {
    $masRegistry: '0.1',
    registryId: 'mas-control-fixtures',
    roles,
    handlers: [
      { id: 'scripted', title: 'Scripted pure step', effect: 'pure', idempotency: 'not-required' },
      { id: 'scripted-effectful', title: 'Scripted effectful step', effect: 'effectful', idempotency: 'honored' },
      { id: 'scripted-read', title: 'Scripted read step', effect: 'read', idempotency: 'not-required' },
    ],
    tools: [],
    messageAdapters: [
      { id: 'json-schema', version: '0.1' },
      { id: 'markdown-sections', version: '0.1' },
      { id: 'plain', version: '0.1' },
    ],
    contextAdapters: [],
    templates: [],
    subgraphs: [
      { id: 'reflection-body', versionId: reflectionBody.versionId as string, workflow: reflectionBody },
      { id: 'retry-body', versionId: retryBody.versionId as string, workflow: retryBody },
    ],
  };
  return { document, revision: await canonicalSha256(document), roleRevisions };
}

async function buildControlFixtures(
  registryRevision: string,
  configRevision: string,
  roleRevisions: Record<string, string>,
): Promise<{ fixtures: FixtureSpec[], template: Json }> {
  const pins = { registryRevision, configRevision };
  const fixtures: FixtureSpec[] = [];
  const draft = obj({ text: STR, quality: NUM });

  // reflection -> critique -> revision loop, terminating on the third result
  fixtures.push({
    id: 'reflection-revision',
    family: 'positive',
    title: 'Reflection, critique and revision terminate on the third oracle result',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-reflection',
      title: 'Reflection loop',
      description: 'A bounded critique/revise cycle whose termination query fires on the third committed body.',
      input: obj({ seed: draft }),
      output: obj({ result: draft }),
      entry: [{ port: 'seed', to: { node: 'polish', port: 'seed' } }],
      exit: [{ port: 'result', from: { node: 'polish', port: 'result' } }],
      nodes: [
        {
          ...baseNode('polish', 'loop', { input: { seed: draft }, output: { result: draft } }),
          body: 'reflection-body',
          init: [{ port: 'seed', to: '' }],
          feedback: [{ from: '', to: '' }],
          result: [{ port: 'result', from: '' }],
          maxIterations: 5,
          termination: { $ge: ['$.output.quality', 3] },
        },
      ],
      messages: [],
    }),
    script: script({
      input: { seed: { text: 'draft zero', quality: 0 } },
      handlers: {
        'polish/reflect': { query: { critique: { text: '$.text', quality: '$.quality' } } },
        'polish/revise': { query: { text: { $concat: ['$.critique.text', '+'] }, quality: { $add: ['$.critique.quality', 1] } } },
      },
    }),
    expect: positiveExpect({
      output: { result: { text: 'draft zero+++', quality: 3 } },
      events: [
        'polish/1/reflect:completed', 'polish/1/revise:completed',
        'polish/2/reflect:completed', 'polish/2/revise:completed',
        'polish/3/reflect:completed', 'polish/3/revise:completed',
        'polish:completed',
      ],
      concurrency: { min: 1, max: 1 },
    }),
  });

  // conditional retry: succeeds on the second declared attempt
  const retryWorkflow = await buildWorkflow({
    ...pins,
    workflowId: 'wf-conditional-retry',
    title: 'Conditional retry',
    description: 'The loop contract as declared recovery: a typed body failure feeds the next attempt; the cap can never be exceeded.',
    input: obj({ start: obj({ n: NUM, goal: NUM }) }),
    output: obj({ result: obj({ ok: BOOL, n: NUM, goal: NUM }) }),
    entry: [{ port: 'start', to: { node: 'attempt', port: 'start' } }],
    exit: [{ port: 'result', from: { node: 'attempt', port: 'result' } }],
    nodes: [
      {
        ...baseNode('attempt', 'loop', { input: { start: obj({ n: NUM, goal: NUM }) }, output: { result: obj({ ok: BOOL, n: NUM, goal: NUM }) } }),
        body: 'retry-body',
        init: [{ port: 'start', to: '' }],
        feedback: [{ from: '/n', to: '/n' }, { from: '/goal', to: '/goal' }],
        result: [{ port: 'result', from: '' }],
        maxIterations: 3,
        termination: { $eq: ['$.output.ok', true] },
      },
    ],
    messages: [],
  });
  fixtures.push({
    id: 'conditional-retry',
    family: 'positive',
    title: 'A conditional retry succeeds once and cannot retry after its cap',
    workflow: retryWorkflow,
    script: script({
      input: { start: { n: 1, goal: 2 } },
      handlers: {
        'attempt/try': { query: { ok: { $ge: ['$.n', '$.goal'] }, n: { $add: ['$.n', 1] }, goal: '$.goal' } },
      },
    }),
    expect: positiveExpect({
      output: { result: { ok: true, n: 3, goal: 2 } },
      events: ['attempt/1/try:completed', 'attempt/2/try:completed', 'attempt:completed'],
      concurrency: { min: 1, max: 1 },
    }),
  });

  // multi-select with a deliberately untaken EFFECTFUL branch
  const flags = obj({ alpha: BOOL, beta: BOOL, gamma: BOOL });
  const branchOut = obj({ branch: STR });
  fixtures.push({
    id: 'multi-select-untaken',
    family: 'positive',
    title: 'The untaken effectful branch records zero attempts, calls and spend',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-multi-untaken',
      title: 'Multi-select with an untaken effectful branch',
      description: 'Two true guards run concurrently; the effectful third branch is never lowered into the dispatched work.',
      input: obj({ flags }),
      output: obj({ result: arr(branchOut) }),
      entry: [{ port: 'flags', to: { node: 'fan', port: 'flags' } }],
      exit: [{ port: 'result', from: { node: 'fan', port: 'results' } }],
      nodes: [
        {
          ...baseNode('fan', 'switch', { input: { flags }, output: { results: arr(branchOut) } }),
          mode: 'multi-select',
          branches: [
            { id: 'alpha', when: '$.flags.alpha', nodes: ['do-alpha'], result: { node: 'do-alpha', port: 'out' } },
            { id: 'beta', when: '$.flags.beta', nodes: ['do-beta'], result: { node: 'do-beta', port: 'out' } },
            { id: 'gamma', when: '$.flags.gamma', nodes: ['do-gamma'], result: { node: 'do-gamma', port: 'out' } },
          ],
          default: 'alpha',
        },
        taskNode('do-alpha', { input: { flags }, output: { out: branchOut } }),
        taskNode('do-beta', { input: { flags }, output: { out: branchOut } }),
        taskNode('do-gamma', { input: { flags }, output: { out: branchOut }, handler: 'scripted-effectful', effect: 'effectful' }),
      ],
      messages: [
        message(['fan', 'flags'], ['do-alpha', 'flags']),
        message(['fan', 'flags'], ['do-beta', 'flags']),
        message(['fan', 'flags'], ['do-gamma', 'flags']),
      ],
    }),
    script: script({
      input: { flags: { alpha: true, beta: true, gamma: false } },
      handlers: {
        'do-alpha': { query: { out: { branch: 'alpha' } } },
        'do-beta': { query: { out: { branch: 'beta' } } },
        'do-gamma': { query: { out: { branch: 'gamma' } } },
      },
      gate: { nodes: ['do-alpha', 'do-beta'], settleOrder: ['do-beta', 'do-alpha'] },
    }),
    expect: positiveExpect({
      output: { result: [{ branch: 'alpha' }, { branch: 'beta' }] },
      events: ['do-beta:completed', 'do-alpha:completed', 'fan:completed'],
      aggregations: [{ node: 'fan', port: 'results', sources: ['do-alpha', 'do-beta'] }],
      concurrency: { min: 2, max: 2 },
    }),
  });

  // peer review: a typed pause, then accept/revise deterministically
  const decision = obj({ decision: { enum: ['accept', 'revise'] }, note: STR });
  const reviewed = obj({ text: STR, disposition: STR });
  fixtures.push({
    id: 'peer-review',
    family: 'positive',
    title: 'Peer review pauses for a typed decision and follows revise deterministically',
    workflow: await buildWorkflow({
      ...pins,
      workflowId: 'wf-peer-review',
      title: 'Peer review',
      description: 'A draft pauses for one typed reviewer decision; the accept/revise gate is a one-of switch over the response.',
      input: obj({ draft: STR }),
      output: obj({ result: reviewed }),
      entry: [{ port: 'draft', to: { node: 'draft', port: 'draft' } }],
      exit: [{ port: 'result', from: { node: 'gate', port: 'routed' } }],
      nodes: [
        taskNode('draft', { input: { draft: STR }, output: { text: STR } }),
        {
          ...baseNode('review', 'interaction', { input: { text: STR }, output: { decision } }),
          prompt: { schema: STR },
          response: { schema: decision },
          expiry: null,
        },
        {
          ...baseNode('gate', 'switch', { input: { decision }, output: { routed: reviewed } }),
          mode: 'one-of',
          branches: [
            { id: 'accept', when: { $eq: ['$.decision.decision', 'accept'] }, nodes: ['publish'], result: { node: 'publish', port: 'out' } },
            { id: 'revise', when: { $eq: ['$.decision.decision', 'revise'] }, nodes: ['revise'], result: { node: 'revise', port: 'out' } },
          ],
          default: 'accept',
        },
        taskNode('publish', { input: { decision }, output: { out: reviewed } }),
        taskNode('revise', { input: { decision }, output: { out: reviewed } }),
      ],
      messages: [
        message(['draft', 'text'], ['review', 'text']),
        message(['review', 'decision'], ['gate', 'decision']),
        message(['gate', 'decision'], ['publish', 'decision']),
        message(['gate', 'decision'], ['revise', 'decision']),
      ],
    }),
    script: script({
      input: { draft: 'v1' },
      handlers: {
        draft: { query: { text: { $concat: ['drafted: ', '$.draft'] } } },
        publish: { query: { out: { text: 'published', disposition: 'accepted' } } },
        revise: { query: { out: { text: { $concat: ['revised per: ', '$.decision.note'] }, disposition: 'revised' } } },
      },
      respond: { node: 'review', value: { decision: 'revise', note: 'tighten the intro' } },
    }),
    expect: positiveExpect({
      output: { result: { text: 'revised per: tighten the intro', disposition: 'revised' } },
      events: ['draft:completed', 'review:waiting', 'review:completed', 'revise:completed', 'gate:completed'],
      concurrency: { min: 1, max: 1 },
    }),
  });

  // the Tangle-authored parallel-analysis template (conformance only — not a GMPL production template)
  const analysis = obj({ points: arr(STR) });
  const fragment = await buildWorkflow({
    ...pins,
    workflowId: 'wf-parallel-analysis',
    title: 'Parallel analysis',
    description: 'Two analysts fan out over one brief and a merger combines their structured results in declared order.',
    input: obj({ brief: STR }),
    output: obj({ merged: arr(analysis) }),
    entry: [
      { port: 'brief', to: { node: 'analyst-one', port: 'brief' } },
      { port: 'brief', to: { node: 'analyst-two', port: 'brief' } },
    ],
    exit: [{ port: 'merged', from: { node: 'merge', port: 'out' } }],
    nodes: [
      agentNode('analyst-one', {
        role: 'analyst-alpha',
        instructionsRevision: roleRevisions['analyst-alpha'],
        adapter: 'markdown-sections',
        input: { brief: STR },
        output: { analysis },
        limits: { calls: 8 },
      }),
      agentNode('analyst-two', {
        role: 'analyst-alpha',
        instructionsRevision: roleRevisions['analyst-alpha'],
        adapter: 'markdown-sections',
        input: { brief: STR },
        output: { analysis },
      }),
      taskNode('merge', { input: { parts: arr(analysis) }, output: { out: arr(analysis) } }),
    ],
    messages: [
      message(['analyst-one', 'analysis'], ['merge', 'parts'], 'ordered-list'),
      message(['analyst-two', 'analysis'], ['merge', 'parts'], 'ordered-list'),
    ],
  });
  const templateDocument: Record<string, Json> = {
    $masTemplate: '0.1',
    templateId: 'parallel-analysis',
    versionId: '0'.repeat(64),
    parentVersionId: null,
    title: 'Parallel analysis (conformance)',
    description: 'A Tangle-authored two-analyst fan-out for conformance measurement — deliberately not one of the six GMPL-owned production templates.',
    provenance: { author: 'tangle-conformance' },
    fragment,
    parameters: {
      schema: obj({
        role: STR,
        instructionsRevision: STR,
        calls: NUM,
      }),
    },
    bindings: [
      { parameterPointer: '/role', targetPointer: '/nodes/0/role', mode: 'role' },
      { parameterPointer: '/instructionsRevision', targetPointer: '/nodes/0/instructionsRevision', mode: 'instructions-revision' },
      { parameterPointer: '/calls', targetPointer: '/nodes/0/limits/calls', mode: 'caps' },
    ],
  };
  {
    const { versionId: _v, provenance: _p, ...semantic } = templateDocument;
    templateDocument.versionId = await canonicalSha256(semantic);
  }
  const template: Json = {
    id: 'parallel-analysis',
    title: 'Parallel analysis template with two declared instances',
    template: templateDocument as unknown as Json,
    instances: {
      a: { role: 'analyst-alpha', instructionsRevision: roleRevisions['analyst-alpha'], calls: 4 },
      b: { role: 'analyst-beta', instructionsRevision: roleRevisions['analyst-beta'], calls: 6 },
    },
    run: {
      script: script({
        input: { brief: 'compare the options' },
        handlers: {
          merge: { query: { out: '$.parts' } },
        },
        agents: {
          'analyst-one': {
            turns: [
              { content: 'alpha analysis', usage: { prompt_tokens: 4, completion_tokens: 2 } },
              { content: '{"points":["alpha analysis"]}', usage: { prompt_tokens: 3, completion_tokens: 2 } },
            ],
          },
          'analyst-two': {
            turns: [
              { content: 'second analysis', usage: { prompt_tokens: 4, completion_tokens: 2 } },
              { content: '{"points":["second analysis"]}', usage: { prompt_tokens: 3, completion_tokens: 2 } },
            ],
          },
        },
        gate: { nodes: ['analyst-one', 'analyst-two'], settleOrder: ['analyst-two', 'analyst-one'] },
      }),
      expect: positiveExpect({
        output: { merged: [{ points: ['alpha analysis'] }, { points: ['second analysis'] }] },
        events: ['analyst-two:completed', 'analyst-one:completed', 'merge:completed'],
        aggregations: [{ node: 'merge', port: 'parts', sources: ['analyst-one', 'analyst-two'] }],
        concurrency: { min: 2, max: 2 },
        calls: 4,
      }),
    },
  };
  return { fixtures, template };
}

// ---------------------------------------------------------------------------
// write everything
// ---------------------------------------------------------------------------

function render(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function emit(path: string, text: string, drift: string[]): Promise<void> {
  const target = join(ROOT, path);
  if (args.flags.has('check')) {
    const current = await readFile(target, 'utf8').catch(() => null);
    if (current !== text) drift.push(path);
    return;
  }
  await writeFile(target, text);
}

const registry = await buildRegistry();
const catalog = await buildConfigCatalog();
const instructionsRevisions: Record<string, string> = {};
for (const [id, instructions] of Object.entries(ROLE_INSTRUCTIONS)) {
  instructionsRevisions[id] = await canonicalSha256(instructions);
}
const fixtures = await buildFixtures(registry.revision, catalog.revision, instructionsRevisions);

if (!args.flags.has('check')) {
  await mkdir(join(ROOT, FIXTURE_DIR, 'positive'), { recursive: true });
  await mkdir(join(ROOT, FIXTURE_DIR, 'negative'), { recursive: true });
}

const controlRegistry = await buildControlRegistry();
const control = await buildControlFixtures(controlRegistry.revision, catalog.revision, controlRegistry.roleRevisions);

if (!args.flags.has('check')) {
  await mkdir(join(ROOT, FIXTURE_DIR, 'control'), { recursive: true });
  await mkdir(join(ROOT, FIXTURE_DIR, 'templates'), { recursive: true });
}

const drift: string[] = [];
await emit(`${FIXTURE_DIR}/registry.json`, render(registry.document), drift);
await emit(`${FIXTURE_DIR}/config-catalog.json`, render(catalog.document), drift);
await emit(`${FIXTURE_DIR}/control-registry.json`, render(controlRegistry.document), drift);
for (const fixture of control.fixtures) {
  await emit(`${FIXTURE_DIR}/control/${fixture.id}.json`, render({
    id: fixture.id,
    family: fixture.family,
    title: fixture.title,
    workflow: fixture.workflow,
    script: fixture.script,
    expect: fixture.expect,
  }), drift);
}
await emit(`${FIXTURE_DIR}/templates/parallel-analysis.json`, render(control.template), drift);

const manifest = {
  manifest: 'mas-conformance-fixtures',
  version: 1,
  registry: { path: `${FIXTURE_DIR}/registry.json`, revision: registry.revision },
  configCatalog: { path: `${FIXTURE_DIR}/config-catalog.json`, revision: catalog.revision },
  positive: [] as Array<{ id: string, path: string, revision: string }>,
  negative: [] as Array<{ id: string, path: string, revision: string }>,
};

for (const fixture of fixtures) {
  const document = {
    id: fixture.id,
    family: fixture.family,
    title: fixture.title,
    workflow: fixture.workflow,
    script: fixture.script,
    expect: fixture.expect,
  };
  const path = `${FIXTURE_DIR}/${fixture.family}/${fixture.id}.json`;
  await emit(path, render(document), drift);
  manifest[fixture.family].push({ id: fixture.id, path, revision: await canonicalSha256(document) });
}

await emit(`${FIXTURE_DIR}/manifest.json`, render(manifest), drift);

if (args.flags.has('check')) {
  if (drift.length > 0) {
    for (const path of drift) console.error(`out of date: ${path}`);
    console.error('The committed MAS fixtures do not reproduce. Run node benchmark/scripts/mas-fixtures.ts.');
    process.exit(1);
  }
  console.log(`mas fixtures reproduce byte-identically (${fixtures.length} fixtures, registry ${registry.revision.slice(0, 12)}…)`);
} else {
  console.log(`wrote ${fixtures.length} fixtures + registry + catalog + manifest (registry ${registry.revision.slice(0, 12)}…)`);
}
