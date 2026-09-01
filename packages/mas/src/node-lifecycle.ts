/**
 * The transactional node lifecycle — the eight steps every lowered
 * agent/task node walks inside its Jaren task handler.
 *
 *   1. begin the attempt under the semantic idempotency key
 *   2. return a prior committed output immediately; stop on uncertain
 *   3. assemble inbound messages in edge order and validate the input
 *   4. resolve bounded context with explicit outcomes and addresses
 *   5. execute the task handler or agent under the shared signal/budgets
 *   6. validate/normalize the output
 *   7. commit the completion atomically (messages, state, budget, artifacts)
 *   8. return the validated ported output so flow checkpoints it
 *
 * Runtime failures become `TMAS2xxx` values on the attempt and then ONE
 * `MasNodeFailure` thrown into flow, so `JF2006`'s abort behavior stays
 * authoritative; an infrastructure crash (`MasInfrastructureCrash`)
 * deliberately bypasses the semantic trace and rides the queue's retry
 * path instead. `onNode` is telemetry and never the commit.
 */

import { compileJsonQuery } from '@jarenjs/json/query';
import { cloneJson } from '@jarenjs/core/object';

import { masIssue, type MasIssue } from './errors.ts';
import { compileEmbeddedSchema } from './schema.ts';
import { semanticKeyOf, invocationPathOf } from './runtime-state.ts';
import { nodeFeeds, type Feed } from './lower.ts';
import { runAgentNode } from './agent-executor.ts';
import { buildEffectiveToolbox, MasUncertainEffect, type MasToolBinding } from './tools.ts';
import { MasBudgetStop, createSharedBudgetClient, type MasBudgetAccount, type MasChatClient } from './budget.ts';
import type { AgentNode, ContextRead, Invocation, MasRegistry, MasWorkflow, RuntimeError, TaskNode } from './contracts.gen.ts';
import type { MasContextProvider } from './context.ts';
import type { MasMessageAdapter, MasRenderableInput } from './messages.ts';
import type { CommitCompletionPlan, CompletionMessagePlan, MasStore } from './store.ts';

/** A semantic node failure: the attempt is terminal; flow aborts the region. */
export class MasNodeFailure extends Error {
  issue: MasIssue;
  node: string;
  constructor(node: string, issue: MasIssue) {
    super(`${issue.code} at ${node}: ${issue.detail}`);
    this.issue = issue;
    this.node = node;
  }
}

/** A process-level crash seam: rides the queue retry path, never the semantic trace. */
export class MasInfrastructureCrash extends Error {}

export interface MasTaskInput {
  value: Record<string, unknown>;
  state: Record<string, unknown>;
  node: string;
  path: string;
  idempotencyKey: string;
  signal: AbortSignal;
}

export type MasTaskHandlerBinding = (input: MasTaskInput) => unknown | Promise<unknown>;

export interface MasRuntimeObserver {
  onNodeEnter?(path: string): void;
  onNodeSettle?(path: string, status: 'completed' | 'failed' | 'aborted' | 'uncertain' | 'waiting'): void;
  /** The begin found a committed completion: replayed, not re-executed. */
  onNodeReplay?(path: string): void;
  onNodeRestored?(path: string): void;
  /** An infrastructure crash unwound this node without touching its attempt. */
  onNodeCrash?(path: string): void;
}

export interface NodeLifecycleDeps {
  workflow: MasWorkflow;
  registry: MasRegistry;
  invocation: Invocation;
  regionMembers: Set<string>;
  region: { id: string, branch: string, iteration: number, pathPrefix?: string };
  runId: string;
  claimSeq: number;
  store: MasStore;
  signal: AbortSignal;
  observer?: MasRuntimeObserver;
  now: () => string;
  /** The state namespace this node reads and pushes ('' at the root). */
  stateNamespace?: string;
  /** The state value before any committed revision in the namespace. */
  initialState?: () => unknown;
  /** Executes a graph node's child plan in place (bound by the walker). */
  executeSubgraph?: (invocation: Invocation & { kind: 'graph' }, input: Record<string, unknown>, meta: { path: string, idempotencyKey: string }) => Promise<
    | { ok: true, output: Record<string, unknown>, parentStatePush: { value: unknown, members: string[] } | null }
    | { ok: false, error: RuntimeError }
  >;
  // execution capabilities
  taskHandlers: Record<string, MasTaskHandlerBinding>;
  clientFor?: (node: AgentNode) => MasChatClient;
  account?: MasBudgetAccount;
  toolBindings: Record<string, MasToolBinding>;
  contextProviders: Record<string, MasContextProvider>;
  messageAdapters: ReadonlyMap<string, MasMessageAdapter>;
  transcriptChars?: number;
}

interface CompiledFeedPlan {
  feeds: Feed[];
  perPort: Map<string, { aggregation: string, jarenPorts: string[], sources: string[] }>;
  checks: Map<string, (value: unknown) => { valid: boolean }>;
}

function compileFeeds(deps: NodeLifecycleDeps): CompiledFeedPlan {
  const feeds = nodeFeeds(deps.workflow, deps.invocation, deps.regionMembers);
  const perPort = new Map<string, { aggregation: string, jarenPorts: string[], sources: string[] }>();
  const aggregationOf = new Map<string, string>();
  for (const edge of deps.workflow.messages) {
    if (edge.to.node === deps.invocation.id) aggregationOf.set(edge.to.port, edge.aggregation);
  }
  for (const feed of feeds) {
    const entry = perPort.get(feed.port) ?? {
      aggregation: aggregationOf.get(feed.port) ?? 'one',
      jarenPorts: [],
      sources: [],
    };
    entry.jarenPorts.push(feed.jarenPort);
    entry.sources.push(feed.source.kind === 'entry' ? 'input' : feed.source.node);
    perPort.set(feed.port, entry);
  }
  const checks = new Map<string, (value: unknown) => { valid: boolean }>();
  for (const [port, declaration] of Object.entries(deps.invocation.input.ports)) {
    const check = compileEmbeddedSchema(declaration.schema);
    if (check !== null) checks.set(port, check);
  }
  return { feeds, perPort, checks };
}

interface OutboundPlan {
  edgeId: string;
  fromPort: string;
  to: { node: string, port: string };
  adapter: string;
  aggregation: CompletionMessagePlan['aggregation'];
  index: number;
  select: ((value: unknown) => unknown) | null;
}

function compileOutbound(deps: NodeLifecycleDeps): OutboundPlan[] {
  const targetIndex = new Map<string, number>();
  const plans: OutboundPlan[] = [];
  for (const edge of deps.workflow.messages) {
    const key = `${edge.to.node} ${edge.to.port}`;
    const index = targetIndex.get(key) ?? 0;
    targetIndex.set(key, index + 1);
    if (edge.from.node !== deps.invocation.id) continue;
    plans.push({
      edgeId: edge.id,
      fromPort: edge.from.port,
      to: edge.to,
      adapter: edge.adapter,
      aggregation: edge.aggregation,
      index,
      select: edge.select === null ? null : compileJsonQuery(edge.select as Record<string, unknown>) as (value: unknown) => unknown,
    });
  }
  return plans;
}

function stateMember(state: unknown, pointer: string): unknown {
  if (pointer === '') return state;
  let current: unknown = state;
  for (const segment of pointer.slice(1).split('/')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function withStateMember(state: unknown, pointer: string, value: unknown): unknown {
  if (pointer === '') return value;
  const clone = cloneJson(state) as Record<string, unknown>;
  const segments = pointer.slice(1).split('/');
  let current: Record<string, unknown> = clone;
  for (const segment of segments.slice(0, -1)) {
    current = current[segment] as Record<string, unknown>;
  }
  current[segments.at(-1) as string] = value;
  return clone;
}

/**
 * Build one lowered Jaren task handler for one invocation. The
 * `execute` seam runs the node body once the input is assembled; agent
 * and task bodies share every other step.
 */
export function createNodeLifecycle(deps: NodeLifecycleDeps): (props: { with: unknown, input: unknown }, signal: AbortSignal) => Promise<unknown> {
  const invocation = deps.invocation;
  const path = invocationPathOf({
    prefix: deps.region.pathPrefix,
    branch: deps.region.branch,
    iteration: deps.region.iteration,
    node: invocation.id,
  });
  const key = semanticKeyOf({
    runId: deps.runId,
    region: deps.region.id,
    branch: deps.region.branch,
    iteration: deps.region.iteration,
    node: invocation.id,
  });
  const feedPlan = compileFeeds(deps);
  const outbound = compileOutbound(deps);
  const outputChecks = new Map<string, (value: unknown) => { valid: boolean }>();
  for (const [port, declaration] of Object.entries(invocation.output.ports)) {
    const check = compileEmbeddedSchema(declaration.schema);
    if (check !== null) outputChecks.set(port, check);
  }

  return async ({ input: jarenScope }, signal) => {
    // A graph node is composition: its enter/settle pair brackets only its
    // own commit so the child's members own the measured concurrency.
    let entered = false;
    const enter = (): void => {
      if (entered) return;
      entered = true;
      deps.observer?.onNodeEnter?.(path);
    };
    if (invocation.kind !== 'graph') enter();
    const begun = await deps.store.beginNodeAttempt({
      runId: deps.runId,
      idempotencyKey: key,
      path,
      invocationId: invocation.id,
      kind: invocation.kind,
      claimSeq: deps.claimSeq,
    });
    if (begun.kind === 'completed') {
      enter();
      deps.observer?.onNodeReplay?.(path);
      return begun.attempt.output;
    }
    if (begun.kind === 'uncertain') {
      throw new MasNodeFailure(invocation.id, begun.issue);
    }
    if (begun.kind === 'refused') {
      throw new MasNodeFailure(invocation.id, begun.issue);
    }
    const attempt = begun.attempt;

    const fail = async (status: 'failed' | 'aborted' | 'uncertain', error: RuntimeError): Promise<never> => {
      await deps.store.failNodeAttempt({
        runId: deps.runId,
        attemptId: attempt.id,
        claimSeq: deps.claimSeq,
        status,
        error,
      });
      enter();
      deps.observer?.onNodeSettle?.(path, status);
      throw new MasNodeFailure(invocation.id, masIssue(error.code as MasIssue['code'], `/${invocation.id}`, error.detail));
    };

    try {
      // 3. assemble and validate the input
      const scope = jarenScope as Record<string, unknown>;
      const value: Record<string, unknown> = {};
      const units: Array<MasRenderableInput['units'][number]> = [];
      for (const [port, plan] of feedPlan.perPort) {
        let aggregated: unknown;
        if (plan.aggregation === 'ordered-list') {
          // The aggregated value IS the ordered list of deliveries, in edge
          // document order — one edge still delivers a one-element list.
          aggregated = plan.jarenPorts.map((jarenPort) => scope[jarenPort]);
        } else if (plan.aggregation === 'named-object') {
          const named: Record<string, unknown> = {};
          plan.jarenPorts.forEach((jarenPort, index) => { named[plan.sources[index]] = scope[jarenPort]; });
          aggregated = named;
        } else {
          aggregated = scope[plan.jarenPorts[0]];
        }
        value[port] = aggregated;
      }
      for (const feed of feedPlan.feeds) {
        units.push({
          source: feed.source.kind === 'entry' ? 'input' : feed.source.node,
          port: feed.port,
          payload: (jarenScope as Record<string, unknown>)[feed.jarenPort],
        });
      }
      for (const [port, check] of feedPlan.checks) {
        if (!check(value[port]).valid) {
          return await fail('failed', {
            code: 'TMAS2004',
            detail: `the aggregated input for port '${port}' does not validate against its declared schema`,
            cause: null,
          });
        }
      }

      const namespace = deps.stateNamespace ?? '';
      const stateRow = await deps.store.latestState(deps.runId, namespace);
      const stateValue = stateRow?.value ?? (deps.initialState !== undefined ? deps.initialState() : deps.workflow.state.init);
      const pulledState: Record<string, unknown> = {};
      for (const pull of invocation.statePull) {
        const member = stateMember(stateValue, pull.member);
        value[pull.as] = member;
        pulledState[pull.as] = member;
      }

      // 5-6. execute and validate
      let output: Record<string, unknown>;
      let usage = { calls: 0, toolCalls: 0, contextReads: 0, promptTokens: 0, completionTokens: 0 };
      let stopReason: string | null = null;
      let transcript: CommitCompletionPlan['transcript'] = { state: 'not-configured', text: null, size: 0, artifact: null };
      let toolSteps: CommitCompletionPlan['toolSteps'] = [];
      let contextReads: ContextRead[] = [];
      const artifacts: CommitCompletionPlan['artifacts'] = [];
      let graphStatePush: { value: unknown, members: string[] } | null = null;

      if (invocation.kind === 'graph' && deps.executeSubgraph !== undefined) {
        const child = await deps.executeSubgraph(invocation, value, { path, idempotencyKey: key });
        if (!child.ok) {
          return await fail('failed', child.error);
        }
        output = child.output;
        graphStatePush = child.parentStatePush;
      } else if (invocation.kind === 'task') {
        const node = invocation as TaskNode;
        const handler = deps.taskHandlers[node.handler];
        if (handler === undefined) {
          return await fail('failed', { code: 'TMAS2004', detail: `no host binding for handler '${node.handler}'`, cause: null });
        }
        const produced = await handler({ value, state: pulledState, node: invocation.id, path, idempotencyKey: key, signal });
        output = produced as Record<string, unknown>;
      } else if (invocation.kind === 'agent') {
        const node = invocation as AgentNode;
        if (deps.clientFor === undefined || deps.account === undefined) {
          return await fail('failed', { code: 'TMAS2004', detail: 'no client factory or shared budget account is bound for agent nodes', cause: null });
        }
        const role = deps.registry.roles.find((candidate) => candidate.id === node.role);
        if (role === undefined) {
          return await fail('failed', { code: 'TMAS2004', detail: `role '${node.role}' is not in the pinned snapshot`, cause: null });
        }
        const adapter = deps.messageAdapters.get(node.messageAdapter);
        if (adapter === undefined) {
          return await fail('failed', { code: 'TMAS2004', detail: `message adapter '${node.messageAdapter}' is not bound`, cause: null });
        }
        const callCounter = { calls: 0, promptTokens: 0, completionTokens: 0 };
        const client = createSharedBudgetClient(deps.clientFor(node), deps.account, {
          onCall: ({ usage: callUsage }) => {
            callCounter.calls += 1;
            const shaped = callUsage as { prompt_tokens?: number, completion_tokens?: number } | undefined;
            callCounter.promptTokens += shaped?.prompt_tokens ?? 0;
            callCounter.completionTokens += shaped?.completion_tokens ?? 0;
          },
        });
        const built = buildEffectiveToolbox({
          registry: deps.registry,
          requested: node.tools,
          bindings: deps.toolBindings,
          signal,
          idempotencyKeyFor: (tool, callIndex) => `${key}/tool/${tool}/${callIndex}`,
        });
        if (!built.valid) {
          return await fail('failed', { code: 'TMAS2004', detail: built.issues[0]?.detail ?? 'the toolbox does not bind', cause: null });
        }
        const reads: Array<{ adapter: string, outcome: Awaited<ReturnType<MasContextProvider['read']>> }> = [];
        for (const contextId of node.context) {
          const provider = deps.contextProviders[contextId];
          if (provider === undefined) {
            reads.push({ adapter: contextId, outcome: { outcome: 'unavailable', reason: 'no provider is bound for this adapter' } });
            continue;
          }
          const maxChars = node.limits?.contextChars ?? deps.workflow.limits.contextChars;
          reads.push({
            adapter: contextId,
            outcome: await provider.read({ node: invocation.id, query: value }, { signal, maxUnits: 4, maxChars }),
          });
        }
        const run = await runAgentNode({
          node,
          role,
          client,
          toolbox: built.value.toolbox,
          adapter,
          input: { value, units },
          contextReads: reads,
          signal,
          localBudget: {
            ...(node.limits?.calls !== undefined ? { turns: node.limits.calls } : {}),
            ...(node.limits?.tokens !== undefined ? { tokens: node.limits.tokens } : {}),
          },
          maxToolRounds: node.limits?.toolRounds ?? deps.workflow.limits.toolRounds,
          transcriptChars: deps.transcriptChars ?? 4000,
          callCounter,
        });
        if (built.value.uncertainty.value !== null) {
          return await fail('uncertain', {
            code: 'TMAS2006',
            detail: `tool '${built.value.uncertainty.value.toolName}' reported an external success with no durable outcome; automatic repetition is refused`,
            cause: null,
          });
        }
        if (!run.ok) {
          const budgetStopped = run.issue.path === '/agent/budget';
          return await fail('failed', {
            code: budgetStopped ? 'TMAS2009' : 'TMAS2004',
            detail: run.issue.detail,
            cause: null,
          });
        }
        output = run.value.output;
        usage = run.value.usage;
        stopReason = run.value.stopReason;
        transcript = run.value.transcript;
        toolSteps = run.value.toolSteps;
        contextReads = run.value.contextReads;
        if (transcript.text !== null) {
          artifacts.push({ kind: 'transcript', state: transcript.state as 'retained' | 'truncated', size: transcript.size, bytes: transcript.text });
        }
        if (run.value.normalizationRaw !== null) {
          artifacts.push({ kind: 'normalization', state: 'retained', size: run.value.normalizationRaw.length, bytes: run.value.normalizationRaw });
        }
      } else {
        return await fail('failed', {
          code: 'TMAS2003',
          detail: `a '${invocation.kind}' node executes through the control host, which a later order supplies`,
          cause: null,
        });
      }

      for (const [port, check] of outputChecks) {
        if (!check(output?.[port]).valid) {
          return await fail('failed', {
            code: 'TMAS2004',
            detail: `the output for port '${port}' does not validate against its declared schema`,
            cause: null,
          });
        }
      }

      // 7. one atomic semantic completion
      const messages: CompletionMessagePlan[] = outbound.map((plan) => ({
        edgeId: plan.edgeId,
        from: { path, port: plan.fromPort },
        to: { path: plan.to.node, port: plan.to.port },
        adapter: plan.adapter,
        aggregation: plan.aggregation,
        index: plan.index,
        payload: plan.select === null ? output[plan.fromPort] : plan.select(output[plan.fromPort]),
      }));
      let statePlan: CommitCompletionPlan['state'] = null;
      if (invocation.statePush.length > 0 || graphStatePush !== null) {
        let nextState = graphStatePush !== null ? graphStatePush.value : stateValue;
        const members: string[] = graphStatePush !== null ? [...graphStatePush.members] : [];
        for (const push of invocation.statePush) {
          nextState = withStateMember(nextState, push.member, output[push.from]);
          members.push(push.member);
        }
        statePlan = { namespace, value: nextState, members };
      }
      const committed = await deps.store.commitNodeCompletion({
        runId: deps.runId,
        attemptId: attempt.id,
        claimSeq: deps.claimSeq,
        output,
        messages,
        state: statePlan,
        spend: { turns: usage.calls, tokens: usage.promptTokens + usage.completionTokens, ms: 0 },
        usage,
        stopReason,
        transcript,
        toolSteps,
        contextReads,
        artifacts,
        restored: false,
      });
      if (!committed.ok) {
        return await fail('failed', { code: committed.issue.code as RuntimeError['code'], detail: committed.issue.detail, cause: null });
      }
      enter();
      deps.observer?.onNodeSettle?.(path, 'completed');
      // 8. flow checkpoints the returned validated output
      return output;
    } catch (error) {
      if (error instanceof MasNodeFailure) throw error;
      if (error instanceof MasInfrastructureCrash) {
        deps.observer?.onNodeCrash?.(path);
        throw error;
      }
      if (error instanceof MasUncertainEffect) {
        return await fail('uncertain', {
          code: 'TMAS2006',
          detail: `tool '${error.toolName}' reported an external success with no durable outcome; automatic repetition is refused`,
          cause: null,
        });
      }
      if (error instanceof MasBudgetStop) {
        return await fail('failed', {
          code: 'TMAS2009',
          detail: error.message,
          cause: null,
        });
      }
      if (signal.aborted) {
        return await fail('aborted', {
          code: 'TMAS2003',
          detail: 'the shared abort signal ended this node before completion',
          cause: null,
        });
      }
      return await fail('failed', {
        code: 'TMAS2004',
        detail: (error as Error).message ?? String(error),
        cause: null,
      });
    }
  };
}
