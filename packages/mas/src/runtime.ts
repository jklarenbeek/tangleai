/**
 * `compileMasRuntime` — one validated immutable plan bound to host
 * capabilities, returning the segment executor durable hosting drives.
 *
 * The compiler refuses any binding whose id, revision or capability
 * differs from the pinned snapshot: task handlers must cover every
 * referenced handler id, tool bindings must exist and honor idempotency
 * where the registry demands it, message adapters must match the
 * snapshot's declarations, context providers must cover every requested
 * adapter, and agent workflows need a client factory. Functions remain
 * host-only and can never change canonical bytes. It resolves no
 * provider URL and holds no credential — the client factory arrives
 * already resolved from CONFIG.
 *
 * `executeSegment` walks the frozen region list in order over one
 * shared budget account (stop/reserve before every call, seeded from
 * the run's durable spend), completes the run's output against its
 * declared schema, and ends every runnable segment in exactly one
 * terminal outcome: completed, failed, or (with the control order)
 * durably waiting. Control regions refuse until that order lands —
 * a workflow cannot execute on a path that says "future node".
 */

import { createBudgetAccount } from '@jarenjs/ai';

import { masIssue, refuse, type MasIssue, type MasValidated } from './errors.ts';
import { compileEmbeddedSchema } from './schema.ts';
import { MasInfrastructureCrash, type MasRuntimeObserver, type MasTaskHandlerBinding } from './node-lifecycle.ts';
import { walkRegions, type RegionFrame, type RunContext } from './control-runtime.ts';
import { validateToolBindings, type MasToolBinding } from './tools.ts';
import { BUILTIN_MESSAGE_ADAPTERS, type MasMessageAdapter } from './messages.ts';
import type { MasChatClient } from './budget.ts';
import type { MasContextProvider } from './context.ts';
import type { AgentNode, Invocation, MasWorkflow, RuntimeError } from './contracts.gen.ts';
import type { MasRegistrySnapshot } from './registry.ts';
import type { MasWorkflowPlan } from './lower.ts';
import type { ValidatedMasWorkflow } from './validate.ts';
import type { MasStore } from './store.ts';

export { MasInfrastructureCrash };

export interface MasHostBindings {
  store: MasStore;
  taskHandlers: Record<string, MasTaskHandlerBinding>;
  toolBindings: Record<string, MasToolBinding>;
  contextProviders: Record<string, MasContextProvider>;
  clientFor?: (node: AgentNode) => MasChatClient;
  messageAdapters?: ReadonlyMap<string, MasMessageAdapter>;
  now: () => string;
  clock: () => number;
  observer?: MasRuntimeObserver;
  transcriptChars?: number;
  /**
   * Turns a declared interaction expiry window into a deadline string
   * comparable with `now()`; required when a workflow declares expiring
   * interactions (the package holds no clock of its own).
   */
  deadlineFor?: (afterMs: number) => string;
}

export interface MasSegmentHost {
  run: { id: string, budget: { limits: Record<string, unknown> | object, spent: { turns: number, tokens: number, ms: number } } };
  segmentJobId: string;
  claimSeq: number;
  signal: AbortSignal;
  checkpointsFor(namespace: string): {
    load(runId: string): unknown,
    save(runId: string, nodeId: string, value: unknown): unknown,
    complete(runId: string, result: unknown): unknown,
  };
  completeSegment(result: unknown): Promise<void>;
}

export interface MasRuntime {
  workflow: MasWorkflow;
  plan: MasWorkflowPlan;
  executeSegment(host: MasSegmentHost): Promise<void>;
}

export function compileMasRuntime(
  validated: ValidatedMasWorkflow,
  plan: MasWorkflowPlan,
  snapshot: MasRegistrySnapshot,
  bindings: MasHostBindings,
): MasValidated<MasRuntime> {
  const workflow = validated.workflow;
  const issues: MasIssue[] = [];
  if (plan.workflowVersionId !== validated.versionId || plan.registryRevision !== validated.registryRevision
    || snapshot.revision !== validated.registryRevision || plan.configCatalogRevision !== validated.configCatalogRevision) {
    return refuse([masIssue('TMAS1009', '/plan', 'the executable plan, validated workflow and registry must share the same pinned identities')]);
  }

  const walkNodes = (nodes: readonly Invocation[]): void => {
    for (const [index, node] of nodes.entries()) {
      if (node.kind === 'task') {
        if (bindings.taskHandlers[node.handler] === undefined) {
          issues.push(masIssue('TMAS1009', `/nodes/${index}/handler`, `no host binding covers handler '${node.handler}'`));
        }
      } else if (node.kind === 'agent') {
        if (bindings.clientFor === undefined) {
          issues.push(masIssue('TMAS1009', `/nodes/${index}`, 'the workflow has agent nodes but no client factory is bound'));
        }
        const toolOutcome = validateToolBindings(snapshot.document, node.tools, bindings.toolBindings);
        if (!toolOutcome.valid) {
          for (const issue of toolOutcome.issues) {
            issues.push(masIssue(issue.code, `/nodes/${index}${issue.path}`, issue.detail));
          }
        }
        for (const [contextIndex, contextId] of node.context.entries()) {
          if (bindings.contextProviders[contextId] === undefined) {
            issues.push(masIssue('TMAS1009', `/nodes/${index}/context/${contextIndex}`, `no context provider is bound for '${contextId}'`));
          }
        }
        const adapters = bindings.messageAdapters ?? BUILTIN_MESSAGE_ADAPTERS;
        if (adapters.get(node.messageAdapter) === undefined) {
          issues.push(masIssue('TMAS1009', `/nodes/${index}/messageAdapter`, `no message adapter is bound for '${node.messageAdapter}'`));
        }
        if (Object.keys(node.output.ports).length !== 1) {
          issues.push(masIssue('TMAS1004', `/nodes/${index}/output`, 'an agent node declares exactly one output port'));
        }
      }
    }
  };
  walkNodes(workflow.nodes);
  const declaredAdapters = new Set(snapshot.document.messageAdapters.map((adapter) => adapter.id));
  for (const [id] of bindings.messageAdapters ?? BUILTIN_MESSAGE_ADAPTERS) {
    if (!declaredAdapters.has(id)) {
      issues.push(masIssue('TMAS1009', '/messageAdapters', `adapter '${id}' is bound but not declared by the pinned snapshot`));
    }
  }
  if (issues.length > 0) return refuse(issues);

  const adapters = bindings.messageAdapters ?? BUILTIN_MESSAGE_ADAPTERS;
  const outputCheck = compileEmbeddedSchema(workflow.output.schema);

  const executeSegment = async (host: MasSegmentHost): Promise<void> => {
    const limits = host.run.budget.limits as Record<string, unknown>;
    const cap = (name: string): number | undefined => (typeof limits[name] === 'number' ? limits[name] as number : undefined);
    const account = createBudgetAccount({
      ...(cap('calls') !== undefined ? { turns: cap('calls') } : {}),
      ...(cap('tokens') !== undefined ? { tokens: cap('tokens') } : {}),
      ...(cap('ms') !== undefined ? { ms: cap('ms') } : {}),
      spent: host.run.budget.spent,
    }, bindings.clock);

    const failRun = async (node: string | null, error: RuntimeError): Promise<void> => {
      const transitioned = await bindings.store.transitionRun(host.run.id, { kind: 'fail', failure: { node, error } });
      if (!transitioned.ok) throw new MasInfrastructureCrash(`the failure transition refused: ${transitioned.issue.code}`);
      await host.completeSegment({ status: 'failed', failure: { node, error } });
    };

    // Rebuild the region scope from committed attempts — the durable truth.
    const trace = await bindings.store.readTrace(host.run.id);
    if (trace === undefined) throw new MasInfrastructureCrash(`run '${host.run.id}' has no trace`);
    const scope: Record<string, unknown> = {};
    for (const attempt of trace.attempts) {
      if (attempt.status === 'completed' && !attempt.path.includes('/')) {
        scope[attempt.invocationId] = attempt.output;
      }
    }

    const context: RunContext = {
      runId: host.run.id,
      claimSeq: host.claimSeq,
      signal: host.signal,
      store: bindings.store,
      account,
      snapshot,
      ...(bindings.observer !== undefined ? { observer: bindings.observer } : {}),
      now: bindings.now,
      segmentJobId: host.segmentJobId,
      checkpointsFor: host.checkpointsFor,
      taskHandlers: bindings.taskHandlers,
      ...(bindings.clientFor !== undefined ? { clientFor: bindings.clientFor } : {}),
      toolBindings: bindings.toolBindings,
      contextProviders: bindings.contextProviders,
      messageAdapters: adapters,
      ...(bindings.transcriptChars !== undefined ? { transcriptChars: bindings.transcriptChars } : {}),
      deadlineFor: bindings.deadlineFor ?? (() => {
        throw new MasInfrastructureCrash('an expiring interaction needs a host deadlineFor binding');
      }),
    };
    const frame: RegionFrame = {
      iteration: 0,
      keyPrefix: '',
      stateNamespace: '',
      initialState: () => workflow.state.init,
      input: trace.run.input,
      nodes: scope,
    };

    const outcome = await walkRegions({ validated, plan }, context, frame);
    if (outcome.kind === 'failed') {
      await failRun(outcome.failure.node, outcome.failure.error);
      return;
    }
    if (outcome.kind === 'waiting') {
      const transitioned = await bindings.store.transitionRun(host.run.id, { kind: 'wait' });
      if (!transitioned.ok) throw new MasInfrastructureCrash(`the wait transition refused: ${transitioned.issue.code}`);
      await host.completeSegment({ status: 'waiting_for_input' });
      return;
    }

    const output: Record<string, unknown> = {};
    for (const exit of workflow.exit) {
      const ported = frame.nodes[exit.from.node] as Record<string, unknown> | undefined;
      output[exit.port] = ported?.[exit.from.port];
    }
    if (outputCheck !== null && !outputCheck(output).valid) {
      await failRun(null, { code: 'TMAS2004', detail: 'the assembled workflow output does not validate against its declared schema', cause: null });
      return;
    }
    const transitioned = await bindings.store.transitionRun(host.run.id, { kind: 'complete', output });
    if (!transitioned.ok) throw new MasInfrastructureCrash(`the completion transition refused: ${transitioned.issue.code}`);
    await host.completeSegment({ status: 'completed', output });
  };

  return { valid: true, value: { workflow, plan, executeSegment } };
}
