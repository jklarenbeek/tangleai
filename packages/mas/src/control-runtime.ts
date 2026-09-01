/**
 * One control host over suite effects — D4 executed.
 *
 * The host loop's only responsibilities: resume or create the suite
 * `CompiledFsm` session for the current control descriptor, send a
 * declared event with persisted MAS state as context, record the
 * returned state/errors/effect descriptors, dispatch each descriptor by
 * name to the existing DAG-region runner or the interaction transition,
 * and persist the suite snapshot plus host context before continuing.
 * It never calculates readiness, reimplements guard selection or
 * cascades eventlessly: `compileFsm` document order is the whole
 * priority scheme, `snapshotFsm`/`resumeFsmSession` are the state
 * contract (the async Tangle host deliberately does not use
 * `createDurableFsmSession`'s synchronous store), branch selection
 * evaluates the declared Jaren Query guards through `compileJsonQuery`
 * in declaration order, and a recorded `JF2003`/`JF2004` guard/effect
 * error becomes a pointered control failure — never a false branch.
 *
 * The region walker here is the one execution spine: top-level
 * segments, switch branch regions, loop body iterations and nested
 * graph children all walk the same frozen descriptors with a frame
 * carrying path prefix, iteration, state namespace and checkpoint
 * namespace — a switch does not run every branch, a loop cannot exceed
 * its host-checked cap, and an untaken branch records zero attempts,
 * calls, checkpoints and spend.
 */

import { compileFsm, createFsmSession, resumeFsmSession, snapshotFsm } from '@jarenjs/flow';
import { compileJsonQuery } from '@jarenjs/json/query';

import { compileEmbeddedSchema } from './schema.ts';
import { interactionIdOf, invocationPathOf, semanticKeyOf } from './runtime-state.ts';
import { nodeFeeds } from './lower.ts';
import { createNodeLifecycle, MasInfrastructureCrash, type MasRuntimeObserver, type MasTaskHandlerBinding } from './node-lifecycle.ts';
import { type MasToolBinding } from './tools.ts';
import { executeDagRegion } from './dag-runtime.ts';
import type { MasBudgetAccount, MasChatClient } from './budget.ts';
import type { MasContextProvider } from './context.ts';
import type { AgentNode, GraphNode, Invocation, InteractionNode, LoopNode, MasWorkflow, RuntimeError, SwitchNode } from './contracts.gen.ts';
import type { MasMessageAdapter } from './messages.ts';
import type { MasRegistrySnapshot } from './registry.ts';
import type { MasRegionDescriptor, MasWorkflowPlan } from './lower.ts';
import type { ValidatedMasWorkflow } from './validate.ts';
import type { CommitCompletionPlan, MasStore } from './store.ts';

export interface RunContext {
  runId: string;
  claimSeq: number;
  signal: AbortSignal;
  store: MasStore;
  account: MasBudgetAccount;
  snapshot: MasRegistrySnapshot;
  observer?: MasRuntimeObserver;
  now: () => string;
  segmentJobId: string;
  checkpointsFor(namespace: string): {
    load(runId: string): unknown,
    save(runId: string, nodeId: string, value: unknown): unknown,
    complete(runId: string, result: unknown): unknown,
  };
  taskHandlers: Record<string, MasTaskHandlerBinding>;
  clientFor?: (node: AgentNode) => MasChatClient;
  toolBindings: Record<string, MasToolBinding>;
  contextProviders: Record<string, MasContextProvider>;
  messageAdapters: ReadonlyMap<string, MasMessageAdapter>;
  transcriptChars?: number;
  /** Turns a declared expiry window into a deadline comparable with now(). */
  deadlineFor: (afterMs: number) => string;
}

export interface RegionFrame {
  pathPrefix?: string;
  iteration: number;
  /** Prefix for region ids in semantic keys and checkpoint namespaces. */
  keyPrefix: string;
  stateNamespace: string;
  initialState: () => unknown;
  input: unknown;
  nodes: Record<string, unknown>;
}

export type RegionsOutcome =
  | { kind: 'completed' }
  | { kind: 'failed', failure: { node: string | null, error: RuntimeError } }
  | { kind: 'waiting' };

const CONTROL_FAILURE = (node: string, error: { code?: string, docPath?: string, message?: string }): RuntimeError => ({
  code: 'TMAS2004',
  detail: `the control machine recorded an evaluation failure at '${node}'`,
  cause: { code: error.code ?? 'unknown', docPath: error.docPath ?? '', message: error.message ?? '' },
});

/** Aggregate a control node's input from the frame — same feed order as the wires. */
function controlNodeInput(workflow: MasWorkflow, invocation: Invocation, frame: RegionFrame): Record<string, unknown> {
  const feeds = nodeFeeds(workflow, invocation, new Set());
  const aggregationOf = new Map<string, string>();
  for (const edge of workflow.messages) {
    if (edge.to.node === invocation.id) aggregationOf.set(edge.to.port, edge.aggregation);
  }
  const grouped = new Map<string, unknown[]>();
  for (const feed of feeds) {
    const delivered = feed.source.kind === 'entry'
      ? (frame.input as Record<string, unknown>)[feed.source.member]
      : (frame.nodes[feed.source.node] as Record<string, unknown> | undefined)?.[feed.source.port];
    const list = grouped.get(feed.port) ?? [];
    list.push(delivered);
    grouped.set(feed.port, list);
  }
  const value: Record<string, unknown> = {};
  for (const [port, deliveries] of grouped) {
    const aggregation = aggregationOf.get(port) ?? 'one';
    value[port] = aggregation === 'ordered-list' ? deliveries : deliveries[0];
  }
  return value;
}

interface ControlMachine {
  state: string;
  send(event: string, payload?: unknown): Promise<{ state: string, effects: Array<{ run: string, with?: unknown }> }>;
  context: Record<string, unknown>;
  persist(): Promise<void>;
}

/** Resume or create the suite FSM session for one control descriptor. */
async function controlMachine(ctx: RunContext, controlId: string, document: unknown, node: string): Promise<ControlMachine> {
  const fsm = compileFsm(document);
  const run = await ctx.store.getRun(ctx.runId);
  const persisted = (run?.fsm as Record<string, { state: string, context?: Record<string, unknown> }>)[controlId];
  const session = persisted === undefined
    ? createFsmSession(fsm)
    : resumeFsmSession(fsm, { state: persisted.state });
  const machine: ControlMachine = {
    state: session.state,
    context: persisted?.context !== undefined ? structuredClone(persisted.context) : {},
    async send(event, payload) {
      const result = session.send(event, { payload, context: machine.context });
      if (result.errors.length > 0) {
        const first = result.errors[0];
        throw new MasControlFailure(node, CONTROL_FAILURE(node, first));
      }
      machine.state = result.state;
      return { state: result.state, effects: result.effects as Array<{ run: string, with?: unknown }> };
    },
    async persist() {
      const snapshot = snapshotFsm(session);
      const written = await ctx.store.putRunFsm(ctx.runId, controlId, { state: snapshot.state, context: machine.context });
      if (!written.ok) throw new MasInfrastructureCrash(`the FSM snapshot did not persist: ${written.issue.code}`);
    },
  };
  return machine;
}

class MasControlFailure extends Error {
  node: string;
  failure: RuntimeError;
  constructor(node: string, failure: RuntimeError) {
    super(`${failure.code} at ${node}`);
    this.node = node;
    this.failure = failure;
  }
}

/** Begin-or-replay one control node's own attempt; returns the stored output when committed. */
async function beginControlAttempt(ctx: RunContext, frame: RegionFrame, regionId: string, invocation: Invocation): Promise<
  | { kind: 'replayed', output: Record<string, unknown> }
  | { kind: 'started', attemptId: string, path: string, key: string }
  | { kind: 'failed', error: RuntimeError }
> {
  const path = invocationPathOf({
    ...(frame.pathPrefix !== undefined ? { prefix: frame.pathPrefix } : {}),
    branch: '',
    iteration: 0,
    node: invocation.id,
  });
  const key = semanticKeyOf({ runId: ctx.runId, region: `${frame.keyPrefix}${regionId}`, branch: '', iteration: 0, node: invocation.id });
  const begun = await ctx.store.beginNodeAttempt({
    runId: ctx.runId,
    idempotencyKey: key,
    path,
    invocationId: invocation.id,
    kind: invocation.kind,
    claimSeq: ctx.claimSeq,
  });
  if (begun.kind === 'completed') {
    ctx.observer?.onNodeEnter?.(path);
    ctx.observer?.onNodeReplay?.(path);
    return { kind: 'replayed', output: begun.attempt.output as Record<string, unknown> };
  }
  if (begun.kind !== 'started') {
    return { kind: 'failed', error: { code: ('issue' in begun ? begun.issue.code : 'TMAS2003') as RuntimeError['code'], detail: 'issue' in begun ? begun.issue.detail : 'the control attempt did not begin', cause: null } };
  }
  // A control node is not a concurrent work item: its enter/settle pair
  // brackets only the commit, so branch and body members own the measured
  // concurrency exactly as registered.
  return { kind: 'started', attemptId: begun.attempt.id, path, key };
}

async function commitControlAttempt(
  ctx: RunContext,
  workflow: MasWorkflow,
  invocation: Invocation,
  started: { attemptId: string, path: string },
  output: Record<string, unknown>,
  statePlan: CommitCompletionPlan['state'],
  extraMessages: CommitCompletionPlan['messages'] = [],
): Promise<{ ok: true } | { ok: false, error: RuntimeError }> {
  const targetIndex = new Map<string, number>();
  const messages: CommitCompletionPlan['messages'] = [...extraMessages];
  for (const edge of workflow.messages) {
    const key = `${edge.to.node} ${edge.to.port}`;
    const index = targetIndex.get(key) ?? 0;
    targetIndex.set(key, index + 1);
    if (edge.from.node !== invocation.id) continue;
    if (invocation.kind === 'switch' && invocation.input.ports[edge.from.port] !== undefined) {
      continue; // a relay edge to branch members, not an output message
    }
    messages.push({
      edgeId: edge.id,
      from: { path: started.path, port: edge.from.port },
      to: { path: edge.to.node, port: edge.to.port },
      adapter: edge.adapter,
      aggregation: edge.aggregation,
      index,
      payload: output[edge.from.port],
    });
  }
  const committed = await ctx.store.commitNodeCompletion({
    runId: ctx.runId,
    attemptId: started.attemptId,
    claimSeq: ctx.claimSeq,
    output,
    messages,
    state: statePlan,
    spend: { turns: 0, tokens: 0, ms: 0 },
    usage: { calls: 0, toolCalls: 0, contextReads: 0, promptTokens: 0, completionTokens: 0 },
    stopReason: null,
    transcript: { state: 'not-configured', text: null, size: 0, artifact: null },
    toolSteps: [],
    contextReads: [],
    artifacts: [],
    restored: false,
  });
  if (!committed.ok) {
    return { ok: false, error: { code: committed.issue.code as RuntimeError['code'], detail: committed.issue.detail, cause: null } };
  }
  ctx.observer?.onNodeEnter?.(started.path);
  ctx.observer?.onNodeSettle?.(started.path, 'completed');
  return { ok: true };
}

async function failControlAttempt(ctx: RunContext, started: { attemptId: string, path: string }, error: RuntimeError): Promise<void> {
  await ctx.store.failNodeAttempt({
    runId: ctx.runId,
    attemptId: started.attemptId,
    claimSeq: ctx.claimSeq,
    status: 'failed',
    error,
  });
  ctx.observer?.onNodeEnter?.(started.path);
  ctx.observer?.onNodeSettle?.(started.path, 'failed');
}

// ---------------------------------------------------------------------------
// the walker
// ---------------------------------------------------------------------------

export interface WalkTarget {
  validated: ValidatedMasWorkflow;
  plan: MasWorkflowPlan;
}

export async function walkRegions(target: WalkTarget, ctx: RunContext, frame: RegionFrame): Promise<RegionsOutcome> {
  const { plan } = target;

  for (const region of plan.regions) {
    if (region.kind === 'subgraph') continue; // executes inside its dag region
    let outcome: RegionsOutcome;
    if (region.kind === 'dag') {
      outcome = await runDagRegion(target, region, ctx, frame);
    } else if (region.kind === 'fsm-switch') {
      outcome = await runSwitchRegion(target, region, ctx, frame);
    } else if (region.kind === 'fsm-loop') {
      outcome = await runLoopRegion(target, region, ctx, frame);
    } else {
      outcome = await runInteractionRegion(target, region, ctx, frame);
    }
    if (outcome.kind !== 'completed') return outcome;
  }
  return { kind: 'completed' };
}

async function runDagRegion(
  target: WalkTarget,
  region: MasRegionDescriptor & { kind: 'dag' },
  ctx: RunContext,
  frame: RegionFrame,
): Promise<RegionsOutcome> {
  const workflow = target.validated.workflow;
  const alreadyDone = region.invocations.every((invocation) => frame.nodes[invocation] !== undefined);
  if (alreadyDone) return { kind: 'completed' };
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const memberIds = new Set(region.invocations);
  const handlers: Record<string, (props: { with: unknown, input: unknown }, signal: AbortSignal) => Promise<unknown>> = {};
  for (const invocationId of region.invocations) {
    const invocation = byId.get(invocationId) as Invocation;
    handlers[invocationId] = createNodeLifecycle({
      workflow,
      registry: ctx.snapshot.document,
      invocation,
      regionMembers: memberIds,
      region: {
        id: `${frame.keyPrefix}${region.id}`,
        branch: '',
        iteration: frame.iteration,
        ...(frame.pathPrefix !== undefined ? { pathPrefix: frame.pathPrefix } : {}),
      },
      runId: ctx.runId,
      claimSeq: ctx.claimSeq,
      store: ctx.store,
      signal: ctx.signal,
      ...(ctx.observer !== undefined ? { observer: ctx.observer } : {}),
      now: ctx.now,
      stateNamespace: frame.stateNamespace,
      initialState: frame.initialState,
      executeSubgraph: (graphNode, input, meta) => runGraphChild(target, graphNode, input, meta, ctx, frame),
      taskHandlers: ctx.taskHandlers,
      ...(ctx.clientFor !== undefined ? { clientFor: ctx.clientFor } : {}),
      account: ctx.account,
      toolBindings: ctx.toolBindings,
      contextProviders: ctx.contextProviders,
      messageAdapters: ctx.messageAdapters,
      ...(ctx.transcriptChars !== undefined ? { transcriptChars: ctx.transcriptChars } : {}),
    });
  }
  const namespace = `${frame.keyPrefix}${region.id}//${frame.iteration}`;
  const outcome = await executeDagRegion({
    document: target.plan.documents[region.documentKey],
    handlers,
    scope: { input: frame.input, nodes: frame.nodes },
    segmentJobId: ctx.segmentJobId,
    checkpoints: ctx.checkpointsFor(namespace),
    signal: ctx.signal,
    ...(ctx.observer !== undefined ? { observer: ctx.observer } : {}),
    region: {
      branch: '',
      iteration: frame.iteration,
      ...(frame.pathPrefix !== undefined ? { pathPrefix: frame.pathPrefix } : {}),
    },
  });
  if (!outcome.ok) return { kind: 'failed', failure: outcome.failure };
  for (const [invocationId, ported] of Object.entries(outcome.exposed)) {
    frame.nodes[invocationId] = ported;
  }
  return { kind: 'completed' };
}

/** A nested graph child: isolated namespace, declared pull/push only. */
async function runGraphChild(
  target: WalkTarget,
  invocation: GraphNode,
  input: Record<string, unknown>,
  meta: { path: string, idempotencyKey: string },
  ctx: RunContext,
  frame: RegionFrame,
): Promise<
  | { ok: true, output: Record<string, unknown>, parentStatePush: { value: unknown, members: string[] } | null }
  | { ok: false, error: RuntimeError }
> {
  const child = target.validated.subgraphs.get(invocation.subgraph);
  const childPlan = target.plan.subplans[invocation.subgraph];
  if (child === undefined || childPlan === undefined) {
    return { ok: false, error: { code: 'TMAS2002', detail: `subgraph '${invocation.subgraph}' is not in the validated plan`, cause: null } };
  }
  const childCheck = compileEmbeddedSchema(child.workflow.input.schema);
  if (childCheck !== null && !childCheck(input).valid) {
    return { ok: false, error: { code: 'TMAS2004', detail: 'the graph input does not validate against the child workflow input schema', cause: null } };
  }
  // Child state: the child's declared init plus the declared pulls, captured
  // once at invocation — the child receives no parent object reference.
  const parentState = (await ctx.store.latestState(ctx.runId, frame.stateNamespace))?.value ?? frame.initialState();
  const childInit = structuredClone(child.workflow.state.init) as Record<string, unknown>;
  for (const pull of invocation.pull) {
    setPointer(childInit, pull.child, getPointer(parentState, pull.parent));
  }
  const childNamespace = meta.path;
  const childFrame: RegionFrame = {
    pathPrefix: meta.path,
    iteration: 0,
    keyPrefix: `${frame.keyPrefix}sub:${invocation.id}/`,
    stateNamespace: childNamespace,
    initialState: () => childInit,
    input,
    nodes: {},
  };
  const walked = await walkRegions({ validated: child, plan: childPlan }, ctx, childFrame);
  if (walked.kind === 'waiting') {
    return { ok: false, error: { code: 'TMAS2003', detail: 'an interaction inside a nested graph is not supported by this runtime', cause: null } };
  }
  if (walked.kind === 'failed') {
    return {
      ok: false,
      error: {
        code: walked.failure.error.code,
        detail: `subgraph '${invocation.subgraph}' (${child.versionId.slice(0, 12)}…) failed at '${walked.failure.node ?? ''}': ${walked.failure.error.detail}`,
        cause: walked.failure.error.cause,
      },
    };
  }
  const output: Record<string, unknown> = {};
  for (const exit of child.workflow.exit) {
    const ported = childFrame.nodes[exit.from.node] as Record<string, unknown> | undefined;
    output[exit.port] = ported?.[exit.from.port];
  }
  const outputCheck = compileEmbeddedSchema(child.workflow.output.schema);
  if (outputCheck !== null && !outputCheck(output).valid) {
    return { ok: false, error: { code: 'TMAS2004', detail: 'the child workflow output does not validate against its declared schema', cause: null } };
  }
  // Push: declared members only, validated by the parent commit.
  let parentStatePush: { value: unknown, members: string[] } | null = null;
  if (invocation.push.length > 0) {
    const childFinal = (await ctx.store.latestState(ctx.runId, childNamespace))?.value ?? childInit;
    let next = structuredClone(parentState);
    const members: string[] = [];
    for (const push of invocation.push) {
      next = setPointerCopy(next, push.parent, getPointer(childFinal, push.child));
      members.push(push.parent);
    }
    parentStatePush = { value: next, members };
  }
  return { ok: true, output, parentStatePush };
}

function getPointer(document: unknown, pointer: string): unknown {
  if (pointer === '') return document;
  let current: unknown = document;
  for (const segment of pointer.slice(1).split('/')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function setPointer(target: Record<string, unknown>, pointer: string, value: unknown): void {
  const segments = pointer.slice(1).split('/');
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1) as string] = value;
}

function setPointerCopy(document: unknown, pointer: string, value: unknown): unknown {
  const clone = structuredClone(document) as Record<string, unknown>;
  setPointer(clone, pointer, value);
  return clone;
}

// ---------------------------------------------------------------------------
// switch
// ---------------------------------------------------------------------------

async function runSwitchRegion(
  target: WalkTarget,
  region: MasRegionDescriptor & { kind: 'fsm-switch' },
  ctx: RunContext,
  frame: RegionFrame,
): Promise<RegionsOutcome> {
  const workflow = target.validated.workflow;
  const invocation = workflow.nodes.find((node) => node.id === region.invocation) as SwitchNode;
  const controlId = `${frame.keyPrefix}${region.id}`;

  const attempt = await beginControlAttempt(ctx, frame, region.id, invocation);
  if (attempt.kind === 'replayed') {
    frame.nodes[invocation.id] = attempt.output;
    return { kind: 'completed' };
  }
  if (attempt.kind === 'failed') {
    return { kind: 'failed', failure: { node: invocation.id, error: attempt.error } };
  }

  const input = controlNodeInput(workflow, invocation, frame);
  try {
    const machine = await controlMachine(ctx, controlId, target.plan.documents[region.documentKey], invocation.id);

    // Branch selection: the declared Jaren Query guards, evaluated in
    // declaration order by the host — never a display label.
    const selected: string[] = [];
    for (const branch of region.branches) {
      const guard = compileJsonQuery(branch.when as Record<string, unknown>);
      if (guard.ebv(input)) {
        selected.push(branch.id);
        if (invocation.mode === 'one-of') break;
      }
    }
    if (selected.length === 0 && region.default !== null) selected.push(region.default);

    machine.context = { selected };
    const results = new Map<string, unknown>();
    if (invocation.mode === 'one-of') {
      const step = await machine.send('select', { selected: selected[0] });
      await machine.persist();
      const dispatched = step.effects.filter((effect) => effect.run === 'run-branch');
      for (const effect of dispatched) {
        const branchId = (effect.with as { branch: string }).branch;
        const outcome = await runBranch(target, region, branchId, ctx, frame, input, results);
        if (outcome !== null) {
          await machine.send('branch-failed');
          await machine.persist();
          await failControlAttempt(ctx, attempt, outcome.error);
          return { kind: 'failed', failure: { node: outcome.node, error: outcome.error } };
        }
      }
      await machine.send('branch-committed');
      await machine.persist();
    } else {
      const step = await machine.send('select', { selected });
      await machine.persist();
      const dispatched = step.effects.some((effect) => effect.run === 'run-branches');
      if (dispatched) {
        const outcomes = await Promise.all(selected.map((branchId) => runBranch(target, region, branchId, ctx, frame, input, results)));
        const failed = outcomes.find((outcome) => outcome !== null);
        if (failed !== undefined && failed !== null) {
          await machine.send('branch-failed');
          await machine.persist();
          await failControlAttempt(ctx, attempt, failed.error);
          return { kind: 'failed', failure: { node: failed.node, error: failed.error } };
        }
      }
      await machine.send('branches-committed');
      await machine.persist();
    }

    // Merge: one-of takes the selected branch result; multi-select merges in
    // branch DECLARATION order, never completion order. The merge is durable:
    // one message per selected branch result, indexed by declaration order,
    // so the trace answers which sources fed the switch output and in what
    // order — independent of completion timing.
    const outputPort = region.outputPort;
    const selectedBranches = region.branches.filter((branch) => selected.includes(branch.id));
    const merged = invocation.mode === 'one-of'
      ? results.get(selected[0])
      : selectedBranches.map((branch) => results.get(branch.id));
    const mergeMessages: CommitCompletionPlan['messages'] = selectedBranches.map((branch, index) => ({
      edgeId: `merge-${branch.id}`,
      from: { path: branch.result.node, port: branch.result.port },
      to: { path: invocation.id, port: outputPort },
      adapter: 'json-schema',
      aggregation: invocation.mode === 'one-of' ? 'one' : 'ordered-list',
      index,
      payload: results.get(branch.id),
    }));
    const output: Record<string, unknown> = { ...input, [outputPort]: merged };
    const committed = await commitControlAttempt(ctx, workflow, invocation, attempt, output, null, mergeMessages);
    if (!committed.ok) {
      return { kind: 'failed', failure: { node: invocation.id, error: committed.error } };
    }
    frame.nodes[invocation.id] = output;
    return { kind: 'completed' };
  } catch (error) {
    if (error instanceof MasControlFailure) {
      await failControlAttempt(ctx, attempt, error.failure);
      return { kind: 'failed', failure: { node: error.node, error: error.failure } };
    }
    throw error;
  }
}

/** Run one selected branch region; null on success (results filled), failure otherwise. */
async function runBranch(
  target: WalkTarget,
  region: MasRegionDescriptor & { kind: 'fsm-switch' },
  branchId: string,
  ctx: RunContext,
  frame: RegionFrame,
  switchInput: Record<string, unknown>,
  results: Map<string, unknown>,
): Promise<{ node: string, error: RuntimeError } | null> {
  const branch = region.branches.find((candidate) => candidate.id === branchId);
  if (branch === undefined) {
    return { node: region.invocation, error: { code: 'TMAS2003', detail: `'${branchId}' names no planned branch`, cause: null } };
  }
  const branchFrame: RegionFrame = {
    ...(frame.pathPrefix !== undefined ? { pathPrefix: frame.pathPrefix } : {}),
    iteration: frame.iteration,
    keyPrefix: frame.keyPrefix,
    stateNamespace: frame.stateNamespace,
    initialState: frame.initialState,
    input: frame.input,
    nodes: { ...frame.nodes, [region.invocation]: switchInput },
  };
  const outcome = await runDagRegion(target, {
    kind: 'dag',
    id: branch.documentKey,
    documentKey: branch.documentKey,
    invocations: branch.invocations,
    nested: branch.nested,
  }, ctx, branchFrame);
  if (outcome.kind === 'failed') {
    return { node: outcome.failure.node ?? region.invocation, error: outcome.failure.error };
  }
  const resultNode = branchFrame.nodes[branch.result.node] as Record<string, unknown> | undefined;
  results.set(branchId, resultNode?.[branch.result.port]);
  // branch member outputs surface into the parent frame for trace/topology,
  // but only the declared result crosses as the switch output
  for (const invocationId of branch.invocations) {
    frame.nodes[invocationId] = branchFrame.nodes[invocationId] as Record<string, unknown>;
  }
  return null;
}

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------

async function runLoopRegion(
  target: WalkTarget,
  region: MasRegionDescriptor & { kind: 'fsm-loop' },
  ctx: RunContext,
  frame: RegionFrame,
): Promise<RegionsOutcome> {
  const workflow = target.validated.workflow;
  const invocation = workflow.nodes.find((node) => node.id === region.invocation) as LoopNode;
  const controlId = `${frame.keyPrefix}${region.id}`;
  const child = target.validated.subgraphs.get(region.body);
  const childPlan = target.plan.subplans[region.body];
  if (child === undefined || childPlan === undefined) {
    return { kind: 'failed', failure: { node: invocation.id, error: { code: 'TMAS2002', detail: `loop body '${region.body}' is not in the validated plan`, cause: null } } };
  }

  const attempt = await beginControlAttempt(ctx, frame, region.id, invocation);
  if (attempt.kind === 'replayed') {
    frame.nodes[invocation.id] = attempt.output;
    return { kind: 'completed' };
  }
  if (attempt.kind === 'failed') {
    return { kind: 'failed', failure: { node: invocation.id, error: attempt.error } };
  }

  const input = controlNodeInput(workflow, invocation, frame);
  const termination = compileJsonQuery(region.termination as Record<string, unknown>);
  try {
    const machine = await controlMachine(ctx, controlId, target.plan.documents[region.documentKey], invocation.id);

    // Resume mid-loop from the persisted context, or initialize.
    let iteration = (machine.context.iteration as number | undefined) ?? 0;
    let carry = machine.context.carry;
    let lastOutput = machine.context.lastOutput;
    if (machine.state === 'ready') {
      carry = {};
      for (const mapping of region.init) {
        carry = mapping.to === ''
          ? structuredClone(input[mapping.port])
          : setPointerCopy(carry, mapping.to, input[mapping.port]);
      }
      iteration = 1;
      machine.context = { iteration, carry };
      await machine.send('dispatch');
      await machine.persist();
    }

    const loopPath = invocationPathOf({
      ...(frame.pathPrefix !== undefined ? { prefix: frame.pathPrefix } : {}),
      branch: '', iteration: 0, node: invocation.id,
    });
    for (;;) {
      if (machine.state === 'body') {
        const bodyFrame: RegionFrame = {
          pathPrefix: loopPath,
          iteration,
          keyPrefix: `${frame.keyPrefix}${region.id}/${iteration}/`,
          stateNamespace: loopPath,
          initialState: () => child.workflow.state.init,
          input: carry,
          nodes: {},
        };
        const walked = await walkRegions({ validated: child, plan: childPlan }, ctx, bodyFrame);
        if (walked.kind === 'waiting') {
          return { kind: 'failed', failure: { node: invocation.id, error: { code: 'TMAS2003', detail: 'an interaction inside a loop body is not supported by this runtime', cause: null } } };
        }
        if (walked.kind === 'failed') {
          await machine.send('failed');
          await machine.persist();
          await failControlAttempt(ctx, attempt, walked.failure.error);
          return { kind: 'failed', failure: walked.failure };
        }
        const bodyOutput: Record<string, unknown> = {};
        for (const exit of child.workflow.exit) {
          const ported = bodyFrame.nodes[exit.from.node] as Record<string, unknown> | undefined;
          bodyOutput[exit.port] = ported?.[exit.from.port];
        }
        lastOutput = bodyOutput;
        machine.context = { iteration, carry, lastOutput };
        await machine.send('committed');
        await machine.persist();
        continue;
      }
      if (machine.state === 'evaluate') {
        // The termination query runs only after a successfully committed
        // body; the host checks the cap OUTSIDE any model output.
        const done = termination.ebv({ iteration, output: lastOutput });
        if (done) {
          await machine.send('terminate');
          await machine.persist();
          break;
        }
        if (iteration + 1 > region.maxIterations) {
          await machine.send('capped');
          await machine.persist();
          const error: RuntimeError = { code: 'TMAS2009', detail: `the loop reached its declared cap of ${region.maxIterations} iterations without terminating`, cause: null };
          await failControlAttempt(ctx, attempt, error);
          return { kind: 'failed', failure: { node: invocation.id, error } };
        }
        let next = carry;
        for (const mapping of region.feedback) {
          next = mapping.to === ''
            ? structuredClone(getPointer(lastOutput, mapping.from))
            : setPointerCopy(next, mapping.to, getPointer(lastOutput, mapping.from));
        }
        carry = next;
        iteration += 1;
        machine.context = { iteration, carry, lastOutput };
        await machine.send('again');
        await machine.persist();
        continue;
      }
      break;
    }

    const output: Record<string, unknown> = {};
    for (const mapping of region.result) {
      output[mapping.port] = getPointer(lastOutput, mapping.from);
    }
    const committed = await commitControlAttempt(ctx, workflow, invocation, attempt, output, null);
    if (!committed.ok) {
      return { kind: 'failed', failure: { node: invocation.id, error: committed.error } };
    }
    frame.nodes[invocation.id] = { ...input, ...output };
    return { kind: 'completed' };
  } catch (error) {
    if (error instanceof MasControlFailure) {
      await failControlAttempt(ctx, attempt, error.failure);
      return { kind: 'failed', failure: { node: error.node, error: error.failure } };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// interaction
// ---------------------------------------------------------------------------

async function runInteractionRegion(
  target: WalkTarget,
  region: MasRegionDescriptor & { kind: 'interaction-wait' },
  ctx: RunContext,
  frame: RegionFrame,
): Promise<RegionsOutcome> {
  const workflow = target.validated.workflow;
  const invocation = workflow.nodes.find((node) => node.id === region.invocation) as InteractionNode;
  const controlId = `${frame.keyPrefix}${region.id}`;
  const interactionId = interactionIdOf(ctx.runId, invocation.id);

  const attempt = await beginControlAttempt(ctx, frame, region.id, invocation);
  if (attempt.kind === 'replayed') {
    frame.nodes[invocation.id] = attempt.output;
    return { kind: 'completed' };
  }
  if (attempt.kind === 'failed') {
    return { kind: 'failed', failure: { node: invocation.id, error: attempt.error } };
  }

  const input = controlNodeInput(workflow, invocation, frame);
  const ports = Object.keys(invocation.input.ports);
  const prompt = ports.length === 1 ? input[ports[0]] : input;

  const existing = await ctx.store.getInteraction(interactionId);
  if (existing === undefined || existing.status === 'waiting') {
    if (existing === undefined) {
      const run = await ctx.store.getRun(ctx.runId);
      const created = await ctx.store.createInteraction({
        runId: ctx.runId,
        node: invocation.id,
        path: attempt.path,
        prompt,
        responseSchema: invocation.response.schema as Record<string, unknown> | boolean,
        expiry: invocation.expiry === null ? null : { afterMs: invocation.expiry.afterMs, deadline: ctx.deadlineFor(invocation.expiry.afterMs) },
        segment: run?.segment ?? 0,
      });
      if (!created.ok) {
        return { kind: 'failed', failure: { node: invocation.id, error: { code: created.issue.code as RuntimeError['code'], detail: created.issue.detail, cause: null } } };
      }
      const machine = await controlMachine(ctx, controlId, target.plan.documents[region.documentKey], invocation.id);
      await machine.send('request');
      await machine.persist();
    }
    // The machine holds its persisted wait; the current attempt stays
    // running and the SEGMENT ends durably — no worker, lease or timer
    // remains behind for a human.
    ctx.observer?.onNodeEnter?.(attempt.path);
    ctx.observer?.onNodeSettle?.(attempt.path, 'waiting');
    return { kind: 'waiting' };
  }
  if (existing.status === 'responded') {
    const outputPort = Object.keys(invocation.output.ports)[0];
    const output: Record<string, unknown> = { ...input, [outputPort]: existing.response };
    const committed = await commitControlAttempt(ctx, workflow, invocation, attempt, output, null);
    if (!committed.ok) {
      return { kind: 'failed', failure: { node: invocation.id, error: committed.error } };
    }
    frame.nodes[invocation.id] = output;
    return { kind: 'completed' };
  }
  const error: RuntimeError = {
    code: 'TMAS2007',
    detail: `interaction '${invocation.id}' is ${existing.status}; the run cannot resume`,
    cause: null,
  };
  await failControlAttempt(ctx, attempt, error);
  return { kind: 'failed', failure: { node: invocation.id, error } };
}
