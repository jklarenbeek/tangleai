/**
 * The experiment lifecycle as one immutable workflow version.
 *
 * The shape is forced by a single rule: **no spawn ever happens inside a
 * MAS segment.** A segment handler is not given the suite job lease, and
 * the effect store asserts that the lease's `jobId` is the plan's, so an
 * effect operation is always its own job. Every effectful stage is
 * therefore a PAIR — a task that writes the intent and enqueues it, and an
 * interaction that waits for a worker in another process to answer.
 *
 * Two consequences that are not obvious from the stage list:
 *
 * A switch branch OWNS its nodes rather than routing to them, and has one
 * result port per branch. The flake branch therefore holds the rerun pair
 * AND the fold that turns its settlement back into an envelope, because
 * only the envelope can leave the branch.
 *
 * The base seal is NOT a node. Sealing the base root spawns git —
 * `rev-parse`, `status`, a tracked digest — and a spawn may not happen in
 * a segment, so a seal node would break the same rule the pairs exist to
 * keep. It belongs to the worker instead: the base batch is the one
 * operation that runs in the operator's own root, and the worker brackets
 * that batch with the seal on both sides and reports whether it held. The
 * bracket stays exactly where the sequential path put it, and the
 * workflow keeps its promise that nothing here reaches a process.
 *
 * One envelope schema travels every edge. That is deliberate: a closed
 * per-stage payload would multiply into a dozen near-identical schemas
 * whose only real invariant is that the next stage can read what the last
 * one wrote.
 */

import {
  defineMasWorkflow, taskInvocation, interactionInvocation, switchInvocation, masMessage,
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
    /** Set as soon as any stage refuses; every later stage routes around. */
    decision: { type: 'object' },
    gate: { type: 'string' },
    rerun: { type: 'string' },
    fitness: { type: 'string' },
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
  effect: 'read',
  input: { env: envelope as never, settled: settlement as never },
  output: { env: envelope as never },
});

/** One dispatch → wait → fold triple, and the edges that wire it. */
function stage(name: string, expiryMs: number) {
  const dispatchId = name;
  const waitId = 'await-' + name;
  const foldId = 'read-' + name;
  return {
    nodes: [
      dispatch(dispatchId, 'evolve-dispatch-' + name),
      await_(waitId, expiryMs),
      fold(foldId, 'evolve-read-' + name),
    ],
    messages: [
      masMessage([dispatchId, 'env'], [waitId, 'env']),
      masMessage([dispatchId, 'env'], [foldId, 'env']),
      masMessage([waitId, 'settled'], [foldId, 'settled']),
    ],
    entryId: dispatchId,
    exitId: foldId,
  };
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
  const { experimentMs } = options;

  const isolate = stage('isolate', experimentMs);
  const apply = stage('apply', experimentMs);
  const gate = stage('gate', experimentMs);
  const rerun = stage('gate-rerun', experimentMs);
  const measureBase = stage('measure-base', experimentMs);
  const measureCandidate = stage('measure-candidate', experimentMs);
  const settle = stage('settle', experimentMs);

  return defineMasWorkflow({
    workflowId: EVOLVE_WORKFLOW_ID,
    title: 'Repository experiment lifecycle',
    description:
      'Propose, isolate, apply, gate, measure, decide, settle and record one '
      + 'isolated repository experiment. Every process effect is a typed wait '
      + 'answered by the effect worker; nothing here spawns.',
    registryRevision: options.registryRevision,
    configRegistryRevision: options.configRegistryRevision,
    profile: options.profile,
    // `ms` is the registered `experimentMs` CEILING, not a target: the
    // keyless matrix spends nothing and the cap is asserted, never
    // consumed. The model budgets are the suite defaults because this
    // workflow calls no model at all.
    limits: {
      calls: 32, tokens: 200000, ms: experimentMs,
      toolRounds: 4, fanOut: 8, concurrency: 8, iterations: 8,
      contextChars: 40000, traceBytes: 1000000,
    },
    input: carrier as never,
    output: carrier as never,
    entry: [{ port: 'env', to: { node: 'propose', port: 'env' } }],
    exit: [{ port: 'env', from: { node: 'record', port: 'env' } }],
    nodes: [
      // Loading and validating a proposal reads the base file map and
      // decides nothing about the world. A refusal here ends the run with
      // zero effects, which is why nine of the sixteen registered rows
      // never reach a worktree.
      reads('propose', 'evolve-propose'),

      ...isolate.nodes,
      ...apply.nodes,
      ...gate.nodes,

      // The flake switch. Its branches OWN their nodes, and each branch
      // has exactly one result port — so the rerun's fold is inside the
      // branch, not after it.
      switchInvocation({
        id: 'flake',
        // Disjoint port names on purpose: `env` is the port whose value is
        // RELAYED to the branch members, and `next` is the one branch
        // result that leaves. Sharing a name makes relay addressing
        // ambiguous and the validator refuses it.
        input: { env: envelope as never },
        output: { next: envelope as never },
        mode: 'one-of',
        default: 'straight',
        branches: [
          {
            id: 'rerun',
            when: { $eq: ['$.env.gate', 'red'] },
            nodes: [rerun.entryId, 'await-gate-rerun', rerun.exitId],
            result: { node: rerun.exitId, port: 'env' },
          },
          {
            id: 'straight',
            when: { $ne: ['$.env.gate', 'red'] },
            nodes: ['no-rerun'],
            result: { node: 'no-rerun', port: 'env' },
          },
        ],
      }),
      ...rerun.nodes,
      pure('no-rerun', 'evolve-no-rerun'),

      // Measurement. The base batch carries its own seal, taken by the
      // worker on both sides of it; `read-measure-base` refuses when the
      // settlement says the seal did not hold.
      ...measureBase.nodes,
      ...measureCandidate.nodes,
      reads('read-fitness', 'evolve-read-fitness'),

      // The campaign's one planner. Everything above gathered evidence;
      // nothing above decided what the evidence meant.
      pure('decide', 'evolve-decide'),

      ...settle.nodes,

      // Idempotent because the outcome service reserves and replays every
      // command by key.
      taskInvocation({
        id: 'record',
        handler: 'evolve-record',
        effect: 'effectful',
        input: { env: envelope as never },
        output: { env: envelope as never },
      }),
    ],
    messages: [
      ...isolate.messages,
      ...apply.messages,
      ...gate.messages,
      ...rerun.messages,
      ...measureBase.messages,
      ...measureCandidate.messages,
      ...settle.messages,

      masMessage(['propose', 'env'], [isolate.entryId, 'env']),
      masMessage([isolate.exitId, 'env'], [apply.entryId, 'env']),
      masMessage([apply.exitId, 'env'], [gate.entryId, 'env']),
      masMessage([gate.exitId, 'env'], ['flake', 'env']),

      // A switch's branch members source from the switch's own INPUT port.
      masMessage(['flake', 'env'], [rerun.entryId, 'env']),
      masMessage(['flake', 'env'], ['no-rerun', 'env']),

      masMessage(['flake', 'next'], [measureBase.entryId, 'env']),
      masMessage([measureBase.exitId, 'env'], [measureCandidate.entryId, 'env']),
      masMessage([measureCandidate.exitId, 'env'], ['read-fitness', 'env']),
      masMessage(['read-fitness', 'env'], ['decide', 'env']),
      masMessage(['decide', 'env'], [settle.entryId, 'env']),
      masMessage([settle.exitId, 'env'], ['record', 'env']),
    ],
  });
}
