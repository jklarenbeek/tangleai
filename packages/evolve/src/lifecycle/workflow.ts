/**
 * One durable experiment. Dispatches persist intents; conditional subgraphs
 * wait only for operations that were actually prepared. Interactions belong
 * to graph regions, never to a switch branch's DAG region.
 */

import {
  defineMasWorkflow, taskInvocation, interactionInvocation, switchInvocation, graphInvocation, masMessage,
  type MasWorkflow,
} from '@tangleai/mas';

/** The workflow id. EVOLVE registers exactly one version of exactly one. */
export const EVOLVE_WORKFLOW_ID = 'evolve-experiment-lifecycle';

/**
 * What travels between stages.
 *
 * Open on purpose (`additionalProperties: true` is expressed by leaving
 * the members unconstrained): the envelope is internal plumbing between
 * handlers this package owns, and the RECORDS are where the closed,
 * content-addressed contracts live. Closing this would duplicate them.
 */
export const EVOLVE_ENVELOPE_SCHEMA = {
  type: 'object',
  required: ['experimentId'],
  properties: {
    experimentId: { type: 'string' },
    proposalId: { type: 'string' },
    strategyId: { type: 'string' },
    // Nullable on purpose, and declared nullable rather than merely left
    // open: an envelope that has not reached a stage yet carries `null`
    // there, not an absent member, so the stages can treat "not yet" and
    // "settled" as the same shape. A schema that forbade null would refuse
    // the very first envelope any run is created with.
    /** Set as soon as any stage refuses; every later stage routes around. */
    decision: { type: ['object', 'null'] },
    gate: { type: ['string', 'null'] },
    rerun: { type: ['string', 'null'] },
    fitness: { type: ['string', 'null'] },
    /** Effect plan ids this experiment has settled, in order. */
    settled: { type: 'array', items: { type: 'string' } },
    /** Counted, not derived: the row census must reconcile with it. */
    legs: { type: 'number' },
    unresolved: { type: 'number' },
  },
} as const;

/** What a worker answers an awaiting interaction with. */
export const EVOLVE_SETTLEMENT_SCHEMA = {
  type: 'object',
  required: ['operationId', 'state'],
  properties: {
    operationId: { type: 'string' },
    state: { type: 'string', enum: ['confirmed', 'rejected', 'unresolved'] },
    recordId: { type: 'string' },
    evidence: { type: 'object' },
  },
} as const;

const envelope = EVOLVE_ENVELOPE_SCHEMA as unknown as Record<string, unknown>;
const settlement = EVOLVE_SETTLEMENT_SCHEMA as unknown as Record<string, unknown>;

/** The workflow's own input/output: one closed object whose member the ports name. */
const carrier = {
  type: 'object',
  required: ['env'],
  properties: { env: envelope },
  additionalProperties: false,
} as unknown as Record<string, unknown>;

/** A stage that only reads records and decides. Never spawns. */
const pure = (id: string, handler: string) => taskInvocation({
  id,
  handler,
  effect: 'pure',
  input: { env: envelope as never },
  output: { env: envelope as never },
});

/** A stage that reads records — effect records, a file map — and no process. */
const reads = (id: string, handler: string) => taskInvocation({
  id,
  handler,
  effect: 'read',
  input: { env: envelope as never },
  output: { env: envelope as never },
});

/** A stage that writes an effect intent and enqueues its job. */
const dispatch = (id: string, handler: string) => taskInvocation({
  id,
  handler,
  effect: 'effectful',
  input: { env: envelope as never },
  output: { env: envelope as never },
});

/** The wait that pairs with a dispatch. A worker answers it. */
const await_ = (id: string, expiryMs: number) => interactionInvocation({
  id,
  input: { env: envelope as never },
  output: { settled: settlement as never },
  prompt: envelope as never,
  response: settlement as never,
  expiry: { afterMs: expiryMs },
});

/** The readback that turns a settlement back into an envelope. */
const fold = (id: string, handler: string) => taskInvocation({
  id,
  handler,
  effect: 'effectful',
  input: { env: envelope as never, settled: settlement as never },
  output: { env: envelope as never },
});

/** Registered operations, shared by authoring, handlers and the worker. */
export const EVOLVE_EFFECT_STAGES = [
  'isolate', 'apply', 'gate', 'gate-rerun', 'measure-base', 'measure-candidate',
] as const;

const limitsFor = (ms: number) => ({
  calls: 32, tokens: 200000, ms, toolRounds: 4, fanOut: 8,
  concurrency: 8, iterations: 8, contextChars: 40000, traceBytes: 1000000,
});

/** The same predicates as stageRuns, expressed in the workflow vocabulary. */
function enabled(stage: string): Record<string, unknown> {
  const open = { $eq: ['$.env.decision', null] };
  if (stage === 'gate-rerun') return { $and: [open, { $eq: ['$.env.gate', 'red'] }] };
  if (stage.startsWith('measure-')) return { $and: [open, { $eq: ['$.env.gate', 'green'] }] };
  return open;
}

/** Each wait has its own resumable region, entered only after dispatch. */
export async function buildEvolveEffectGraphs(options: Pick<EvolveLifecycleOptions, 'experimentMs' | 'profile'>): Promise<MasWorkflow[]> {
  return Promise.all(EVOLVE_EFFECT_STAGES.map(name => defineMasWorkflow({
    workflowId: EVOLVE_WORKFLOW_ID + '-' + name,
    title: 'Await ' + name,
    description: 'Read one fenced settlement without running a process.',
    registryRevision: null, configRegistryRevision: null,
    profile: options.profile, limits: limitsFor(options.experimentMs),
    input: carrier as never, output: carrier as never,
    entry: [
      { port: 'env', to: { node: 'await-' + name, port: 'env' } },
      { port: 'env', to: { node: 'read-' + name, port: 'env' } },
    ],
    exit: [{ port: 'env', from: { node: 'read-' + name, port: 'env' } }],
    nodes: [await_('await-' + name, options.experimentMs), fold('read-' + name, 'evolve-read-' + name)],
    messages: [masMessage(['await-' + name, 'settled'], ['read-' + name, 'settled'])],
  })));
}

export interface EvolveLifecycleOptions {
  /** The registered `experimentMs` ceiling. A cap, never a target. */
  experimentMs: number;
  registryRevision: string | null;
  configRegistryRevision: string | null;
  profile: string;
}

/**
 * Author the one lifecycle version.
 *
 * Deterministic: the same options author the same `versionId`, because
 * nothing here reads a clock or a random source. That is what lets a test
 * assert the id is stable across two authorings, and what makes the
 * version safe to store once and reuse forever.
 */
export async function buildEvolveLifecycle(options: EvolveLifecycleOptions): Promise<MasWorkflow> {
  const stages = EVOLVE_EFFECT_STAGES.map(name => ({
    name, route: name + '-route', graph: 'effect-' + name, skip: 'skip-' + name,
  }));
  return defineMasWorkflow({
    workflowId: EVOLVE_WORKFLOW_ID,
    title: 'Repository experiment lifecycle',
    description: 'Propose, dispatch bounded effects, await their settlements, decide and record. Workspace settlement is a host reconciler.',
    registryRevision: options.registryRevision,
    configRegistryRevision: options.configRegistryRevision,
    profile: options.profile, limits: limitsFor(options.experimentMs),
    input: carrier as never, output: carrier as never,
    entry: [{ port: 'env', to: { node: 'propose', port: 'env' } }],
    exit: [{ port: 'env', from: { node: 'record', port: 'env' } }],
    nodes: [
      reads('propose', 'evolve-propose'),
      ...stages.flatMap(({ name, route, graph, skip }) => [
        dispatch(name, 'evolve-dispatch-' + name),
        switchInvocation({
          id: route, input: { env: envelope as never }, output: { next: envelope as never },
          mode: 'one-of', default: 'skip',
          branches: [
            { id: 'run', when: enabled(name) as never, nodes: [graph], result: { node: graph, port: 'env' } },
            { id: 'skip', when: { $not: enabled(name) } as never, nodes: [skip], result: { node: skip, port: 'env' } },
          ],
        }),
        graphInvocation({
          id: graph, subgraph: EVOLVE_WORKFLOW_ID + '-' + name,
          input: { env: envelope as never }, output: { env: envelope as never },
        }),
        pure(skip, 'evolve-no-rerun'),
      ]),
      dispatch('read-fitness', 'evolve-read-fitness'),
      pure('decide', 'evolve-decide'),
      dispatch('record', 'evolve-record'),
    ],
    messages: [
      masMessage(['propose', 'env'], [stages[0].name, 'env']),
      ...stages.flatMap(({ name, route, graph, skip }, index) => [
        masMessage([name, 'env'], [route, 'env']),
        masMessage([route, 'env'], [graph, 'env']),
        masMessage([route, 'env'], [skip, 'env']),
        masMessage([route, 'next'], [stages[index + 1]?.name ?? 'read-fitness', 'env']),
      ]),
      masMessage(['read-fitness', 'env'], ['decide', 'env']),
      masMessage(['decide', 'env'], ['record', 'env']),
    ],
  });
}
