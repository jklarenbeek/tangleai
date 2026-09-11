/**
 * The scripted fixture runner — the registered oracles, executed.
 *
 * Drives one registered acyclic fixture end-to-end through the REAL
 * stack: validated IR → frozen plan → `compileMasRuntime` → durable
 * segments over the suite queue with namespaced checkpoints — under
 * fully scripted hosts built from the fixture's own `script` member
 * (pure Jaren-query task handlers, per-node scripted provider turns,
 * a deferred-promise concurrency gate, one optional infrastructure
 * crash point, one optional scripted failure). Every oracle member is
 * verified — final output, run status, ordered events, aggregation
 * order at every registered fan-in port, measured concurrency by
 * entry/exit counter, scripted call/tool/context/restore counts — and a
 * mismatch THROWS: the instrument never commits a lying row.
 */

import { nodeDriver } from '@jarenjs/db/node';
import { compileJsonQuery } from '@jarenjs/json/query';
import {
  compileMasRuntime,
  MasInfrastructureCrash,
  createMemoryContextProvider,
  type MasChatClient,
  type MasChatCompletion,
  type MasConfigCatalog,
  type MasRegistrySnapshot,
  type MasRuntimeObserver,
  type MasTaskHandlerBinding,
  type MasToolBinding,
  type MasWorkflowPlan,
  type ValidatedMasWorkflow,
} from '@tangleai/mas';
import {
  createMasSegmentHandlers,
  createMasStore,
  enqueueMasSegment,
  ensurePendingMasSegments,
  openTangleDb,
} from '@tangleai/store';

import type { FixtureDocument, IntegratedRow, PositiveExpectation } from './mas-conformance.types.ts';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

interface FixtureGate {
  enter(node: string, signal: AbortSignal): Promise<void>;
}

function createFixtureGate(spec: { nodes: string[], settleOrder: string[] } | null): FixtureGate {
  if (spec === null) return { enter: async () => undefined };
  const gates = new Map<string, Deferred>(spec.nodes.map((node) => [node, deferred()]));
  const entered = new Set<string>();
  return {
    enter(node, signal) {
      const gate = gates.get(node);
      if (gate === undefined) return Promise.resolve();
      entered.add(node);
      if (entered.size === spec.nodes.length) {
        // Release one microtask later so the last enterer's own continuation
        // is registered first — the settle order is then exactly the
        // scripted order, not an artifact of registration timing.
        queueMicrotask(() => {
          for (const release of spec.settleOrder) gates.get(release)?.resolve();
        });
      }
      return new Promise<void>((resolve, reject) => {
        void gate.promise.then(resolve);
        signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
      });
    },
  };
}

/** The script key for a hierarchical path: segments minus iteration numbers. */
function scriptKeyOf(path: string): string {
  return path.split('/').filter((segment) => !/^\d+$/.test(segment)).join('/');
}

export interface FixtureDrive {
  row: IntegratedRow;
  events: string[];
  output: unknown;
  spend: { turns: number, tokens: number, ms: number };
  messagesBrief: Array<{ edgeId: string, from: string, to: string, index: number }>;
  scriptedClientCalls: number;
}

export interface DriveOptions {
  /** Arm a one-shot infrastructure crash before this node (test matrix only). */
  crashBefore?: string | null;
  /** Skip the exact event/restore equality (crash variants add restores). */
  relaxEventOracle?: boolean;
}

/** The strict conformance entry: every registered oracle member, or a throw. */
export async function runAcyclicFixture(
  fixture: FixtureDocument,
  validated: ValidatedMasWorkflow,
  plan: MasWorkflowPlan,
  snapshot: MasRegistrySnapshot,
  catalog: MasConfigCatalog,
): Promise<IntegratedRow> {
  const drive = await driveAcyclicFixture(fixture, validated, plan, snapshot, catalog, {});
  return drive.row;
}

export async function driveAcyclicFixture(
  fixture: FixtureDocument,
  validated: ValidatedMasWorkflow,
  plan: MasWorkflowPlan,
  snapshot: MasRegistrySnapshot,
  catalog: MasConfigCatalog,
  options: DriveOptions = {},
): Promise<FixtureDrive> {
  const expect = fixture.expect as PositiveExpectation;
  const script = fixture.script;
  const runId = `fx-${fixture.id}`;

  const clock = { value: 1_000_000 };
  const db = await openTangleDb({ driver: nodeDriver(), jobs: { now: () => clock.value, random: () => 0.5 } });
  try {
    let tick = 0;
    const store = createMasStore(db, { now: () => `tick-${String(tick++).padStart(4, '0')}` });
    const created = await store.createRun({
      runId,
      workflowId: validated.workflow.workflowId,
      workflowVersionId: validated.versionId,
      registryRevision: snapshot.revision,
      executableRevision: plan.executableRevision,
      configRegistryRevision: catalog.revision,
      profile: validated.workflow.config.profile,
      input: script.input,
      limits: validated.workflow.limits as unknown as Record<string, number>,
    });
    if (!created.ok) throw new Error(`the fixture run did not create: ${created.issue.code}`);

    // -- scripted hosts ------------------------------------------------------
    const gate = createFixtureGate(script.gate);
    const events: string[] = [];
    let inFlight = 0;
    let maxObservedConcurrency = 0;
    let restores = 0;
    const observer: MasRuntimeObserver = {
      onNodeEnter: () => {
        inFlight += 1;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, inFlight);
      },
      onNodeSettle: (path, status) => {
        inFlight -= 1;
        events.push(`${path}:${status}`);
      },
      onNodeReplay: () => {
        inFlight -= 1;
      },
      onNodeCrash: () => {
        inFlight -= 1;
      },
      onNodeRestored: (path) => {
        restores += 1;
        events.push(`${path}:restored`);
      },
    };

    // the node executed right after `stopAfter` carries the one-shot crash
    let crashBefore: string | null = options.crashBefore ?? null;
    if (crashBefore === null && script.stopAfter !== null) {
      const dagRegion = plan.regions.find((region) => region.kind === 'dag');
      if (dagRegion !== undefined && dagRegion.kind === 'dag') {
        const index = dagRegion.invocations.indexOf(script.stopAfter);
        crashBefore = dagRegion.invocations[index + 1] ?? null;
      }
    }
    const crashArmed = { value: crashBefore !== null };

    const compiledQueries = new Map<string, (value: unknown) => unknown>();
    for (const [key, handler] of Object.entries(script.handlers)) {
      compiledQueries.set(key, compileJsonQuery(handler.query as Record<string, unknown>) as (value: unknown) => unknown);
    }
    const scriptedTask: MasTaskHandlerBinding = async ({ value, node, path, signal }) => {
      if (crashArmed.value && crashBefore === node) {
        crashArmed.value = false;
        throw new MasInfrastructureCrash(`scripted process stop before '${node}'`);
      }
      await gate.enter(node, signal);
      if (script.failAt === node) throw new Error(`scripted failure at '${node}'`);
      const query = compiledQueries.get(scriptKeyOf(path));
      if (query === undefined) throw new Error(`the fixture script binds no handler for '${scriptKeyOf(path)}'`);
      return query(value);
    };
    const taskHandlers: Record<string, MasTaskHandlerBinding> = {
      scripted: scriptedTask,
      'scripted-read': scriptedTask,
      'scripted-effectful': scriptedTask,
    };

    const turnCursors = new Map<string, number>();
    const clientFor = (node: { id: string }): MasChatClient => ({
      endpoint: { provider: 'scripted' },
      complete: async (request: unknown): Promise<MasChatCompletion> => {
        const agentScript = script.agents[node.id];
        if (agentScript === undefined) throw new Error(`the fixture script has no agent turns for '${node.id}'`);
        const cursor = turnCursors.get(node.id) ?? 0;
        if (cursor === 0) {
          const controller = new AbortController();
          await gate.enter(node.id, controller.signal);
        }
        const turn = agentScript.turns[cursor];
        if (turn === undefined) throw new Error(`agent '${node.id}' asked for turn ${cursor + 1} but the script has ${agentScript.turns.length}`);
        turnCursors.set(node.id, cursor + 1);
        void request;
        if (turn.toolCall !== undefined) {
          return {
            message: {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: `call-${node.id}-${cursor}`, name: turn.toolCall.name, arguments: JSON.stringify(turn.toolCall.arguments) }],
            },
            finishReason: 'tool_calls',
            usage: turn.usage,
          };
        }
        return {
          message: { role: 'assistant', content: turn.content ?? '' },
          finishReason: 'stop',
          usage: turn.usage,
        };
      },
    });

    const toolBindings: Record<string, MasToolBinding> = {
      'fetch-metrics': {
        handler: (input) => ({ metric: (input as { metric: string }).metric, value: 42 }),
      },
    };
    const contextProviders = {
      memory: createMemoryContextProvider({
        recall: async () => [{ id: 'm1', text: 'previous weekly report style: crisp titled sections' }],
      }),
    };

    const runtime = compileMasRuntime(validated, plan, snapshot, {
      store,
      taskHandlers,
      toolBindings,
      contextProviders,
      clientFor,
      now: () => `tick-${String(tick++).padStart(4, '0')}`,
      clock: () => clock.value,
      observer,
      deadlineFor: () => 'tick-9999', // fixture interactions never expire under the injected ticks
    });
    if (!runtime.valid) {
      throw new Error(`the runtime did not compile: ${runtime.issues[0]?.code} ${runtime.issues[0]?.path} — ${runtime.issues[0]?.detail}`);
    }

    // -- durable drive -------------------------------------------------------
    await enqueueMasSegment(db, {
      runId,
      segment: 0,
      workflowVersionId: validated.versionId,
      registryRevision: snapshot.revision,
      executableRevision: plan.executableRevision,
    });
    const handlers = createMasSegmentHandlers(store, {
      executableRevisions: [plan.executableRevision],
      execute: (segment) => runtime.value.executeSegment(segment),
      owner: 'fixture',
    });
    const jobs = db.jobs;
    if (jobs === undefined) throw new Error('jobs must be enabled');
    const kind = Object.keys(handlers)[0];
    let responded = false;
    for (let round = 0; round < 6; round += 1) {
      const job = await jobs.claim({ kinds: [kind], owner: `fixture-${round}`, leaseMs: 60_000 });
      if (job === undefined) {
        // A durable wait holds no job: apply the scripted typed response,
        // reconcile the reserved resume segment, and keep driving.
        const current = await store.getRun(runId);
        if (current?.status === 'waiting_for_input' && script.respond !== null && !responded) {
          responded = true;
          const interactionId = `${runId}:i:${script.respond.node}`;
          const interaction = await store.getInteraction(interactionId);
          if (interaction === undefined) throw new Error(`the wait persisted no interaction '${interactionId}'`);
          const accepted = await store.respondInteraction(interactionId, script.respond.value, interaction.revision, 'fixture-response');
          if (!accepted.ok) throw new Error(`the scripted response refused: ${accepted.issue.code} — ${accepted.issue.detail}`);
          const reconciled = await ensurePendingMasSegments(db, store);
          if (reconciled.enqueued !== 1) throw new Error(`the reconciler enqueued ${reconciled.enqueued} segments, not 1`);
          const again = await ensurePendingMasSegments(db, store);
          if (again.examined !== 0) throw new Error('the second identical reconciliation must examine zero rows');
          continue;
        }
        break;
      }
      try {
        const result = await handlers[kind](job.payload, {
          job,
          checkpoints: jobs.checkpointsFor(job),
          signal: new AbortController().signal,
        } as never);
        await jobs.complete(job.lease, result ?? null);
      } catch (error) {
        await jobs.fail(job.lease, error);
        clock.value += 300_000;
      }
    }

    // -- the oracle ----------------------------------------------------------
    const trace = await store.readTrace(runId);
    if (trace === undefined) throw new Error('the run left no trace');
    const oracle = (holds: boolean, what: string): void => {
      if (!holds) throw new Error(`fixture ${fixture.id}: ${what}`);
    };

    if (expect.outcome === 'completed') {
      oracle(trace.run.status === 'completed', `the run is '${trace.run.status}', not completed`);
      oracle(JSON.stringify(trace.run.output) === JSON.stringify(expect.output), `output ${JSON.stringify(trace.run.output)} != registered ${JSON.stringify(expect.output)}`);
    } else {
      oracle(trace.run.status === 'failed', `the run is '${trace.run.status}', not failed`);
      oracle(trace.run.output === null, 'a failed run must have no partial output');
      const failedNode = trace.run.failure?.node ?? null;
      oracle(failedNode === (expect.failure?.node ?? null), `failure node '${failedNode}' != registered '${expect.failure?.node}'`);
    }
    if (options.relaxEventOracle !== true) {
      oracle(JSON.stringify(events) === JSON.stringify(expect.events), `events ${JSON.stringify(events)} != registered ${JSON.stringify(expect.events)}`);
    }
    for (const aggregation of expect.aggregations) {
      const inbound = trace.messages
        .filter((message) => message.to.path === aggregation.node && message.to.port === aggregation.port)
        .sort((a, b) => a.index - b.index);
      const sources = inbound.map((message) => message.from.path);
      oracle(
        JSON.stringify(sources) === JSON.stringify(aggregation.sources),
        `aggregation at ${aggregation.node}.${aggregation.port} delivered [${sources.join(', ')}], registered [${aggregation.sources.join(', ')}]`,
      );
    }
    oracle(
      maxObservedConcurrency >= expect.concurrency.min && maxObservedConcurrency <= expect.concurrency.max,
      `measured concurrency ${maxObservedConcurrency} outside registered [${expect.concurrency.min}, ${expect.concurrency.max}]`,
    );
    const calls = trace.attempts.reduce((sum, attempt) => sum + attempt.usage.calls, 0);
    const toolCalls = trace.attempts.reduce((sum, attempt) => sum + attempt.usage.toolCalls, 0);
    const contextReads = trace.attempts.reduce((sum, attempt) => sum + attempt.usage.contextReads, 0);
    oracle(calls === expect.calls, `scripted calls ${calls} != registered ${expect.calls}`);
    oracle(toolCalls === expect.toolCalls, `tool calls ${toolCalls} != registered ${expect.toolCalls}`);
    oracle(contextReads === expect.contextReads, `context reads ${contextReads} != registered ${expect.contextReads}`);
    if (options.relaxEventOracle !== true) {
      oracle(restores === expect.restores, `restores ${restores} != registered ${expect.restores}`);
    }

    let scriptedClientCalls = 0;
    for (const cursor of turnCursors.values()) scriptedClientCalls += cursor;
    return {
      row: {
        id: fixture.id,
        family: 'positive',
        state: 'runtime-pass',
        reason: null,
        workflowVersionId: validated.versionId,
        registryRevision: snapshot.revision,
        executableRevision: plan.executableRevision,
        attempts: trace.attempts.length,
        calls,
        toolCalls,
        contextReads,
        restores,
        maxObservedConcurrency,
        refusal: null,
      },
      events,
      output: trace.run.output,
      spend: trace.run.budget.spent,
      messagesBrief: trace.messages.map((message) => ({
        edgeId: message.edgeId,
        from: message.from.path,
        to: `${message.to.path}.${message.to.port}`,
        index: message.index,
      })),
      scriptedClientCalls,
    };
  } finally {
    await db.close();
  }
}
