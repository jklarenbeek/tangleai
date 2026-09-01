/**
 * MAS segments over the suite queue: idempotent derived enqueue,
 * versioned kinds (an unregistered kind stays pending, never
 * dead-lettered), TMAS2002 identity fencing before any checkpoint load,
 * namespaced checkpoint delegation without collisions, the crash matrix
 * at every semantic/flow/terminal boundary with zero duplicate scripted
 * external calls, atomic terminal completion pruning the segment's
 * rows, and a throwing onNode observer that cannot shorten the durable
 * trace. Timing is an injected clock; the matrix drives claims directly
 * so no test sleeps.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { nodeDriver } from '@jarenjs/db/node';
import { compileDag } from '@jarenjs/flow';
import { defineDag, edge, input, output, task, type AnyNode, type EdgeDeclaration } from '@jarenjs/linq/flow';
import type { MasStore, MasWorkflow } from '@tangleai/mas';
import {
  createMasSegmentHandlers,
  createMasSegmentWorker,
  createMasStore,
  enqueueMasSegment,
  namespacedRegionCheckpoints,
  openTangleDb,
  type MasSegmentContext,
  type TangleDb,
} from '@tangleai/store';

const workflow = (JSON.parse(await readFile('benchmark/fixtures/mas/positive/sequential.json', 'utf8')) as { workflow: MasWorkflow }).workflow;
const EXECUTABLE = 'e'.repeat(64);
const REGISTRY = 'b'.repeat(64);

interface Rig {
  db: TangleDb;
  store: MasStore;
  clock: { value: number };
  runId: string;
  externalCalls: { count: number };
  executions: { count: number };
  crashAt: { point: string | null };
  restored: string[];
  observerThrows: boolean;
  checkpointLoads: { count: number };
}

async function rig(runId: string): Promise<Rig> {
  const clock = { value: 1_000_000 };
  const db = await openTangleDb({
    driver: nodeDriver(),
    jobs: { now: () => clock.value, random: () => 0.5 },
  });
  let tick = 0;
  const store = createMasStore(db, { now: () => `tick-${String(tick++).padStart(4, '0')}` });
  const created = await store.createRun({
    runId,
    workflowId: workflow.workflowId,
    workflowVersionId: workflow.versionId,
    registryRevision: REGISTRY,
    executableRevision: EXECUTABLE,
    configRegistryRevision: null,
    profile: 'scripted',
    input: { text: 'hello' },
    limits: { calls: 10 },
  });
  assert.ok(created.ok);
  return {
    db,
    store,
    clock,
    runId,
    externalCalls: { count: 0 },
    executions: { count: 0 },
    crashAt: { point: null },
    restored: [],
    observerThrows: false,
    checkpointLoads: { count: 0 },
  };
}

/** The scripted segment executor: one paid node, one pure wrapper, full lifecycle. */
function scriptedExecutor(context: Rig) {
  return async (segment: MasSegmentContext): Promise<void> => {
    context.executions.count += 1;
    const namespace = 'dag0//0';
    const checkpoints = segment.checkpointsFor(namespace);
    const nodes: Record<string, AnyNode> = {
      scope: input(),
      't:pay': task('pay').checkpoint(),
      't:wrap': task('wrap').checkpoint(),
      expose: output(),
    };
    const edges: Array<EdgeDeclaration<string, string>> = [
      edge('scope', 't:pay'),
      edge('t:pay', 't:wrap'),
      edge('t:pay', 'expose', { port: 'pay' }),
      edge('t:wrap', 'expose', { port: 'wrap' }),
    ];
    const graph = defineDag<Record<string, AnyNode>, Array<EdgeDeclaration<string, string>>>({ nodes, edges });

    const lifecycle = (node: string, external: boolean, produce: (value: unknown) => unknown) =>
      async ({ input: value }: { with: unknown, input: unknown }): Promise<unknown> => {
        const begun = await context.store.beginNodeAttempt({
          runId: context.runId,
          idempotencyKey: `${context.runId}/dag0//0/${node}`,
          path: node,
          invocationId: node,
          kind: 'task',
          claimSeq: segment.claimSeq,
        });
        if (begun.kind === 'completed') return begun.attempt.output;
        if (begun.kind !== 'started') throw new Error(`${begun.kind}: ${JSON.stringify('issue' in begun ? begun.issue : null)}`);
        if (context.crashAt.point === `before-external:${node}`) throw new Error(`scripted crash before external work at ${node}`);
        if (external) context.externalCalls.count += 1;
        const output = produce(value);
        const committed = await context.store.commitNodeCompletion({
          runId: context.runId,
          attemptId: begun.attempt.id,
          claimSeq: segment.claimSeq,
          output,
          messages: [],
          state: null,
          spend: { turns: external ? 1 : 0, tokens: external ? 8 : 0, ms: 0 },
          usage: { calls: external ? 1 : 0, toolCalls: 0, contextReads: 0, promptTokens: external ? 5 : 0, completionTokens: external ? 3 : 0 },
          stopReason: external ? 'stop' : null,
          transcript: { state: external ? 'retained' : 'not-configured', text: external ? 'bought' : null, size: external ? 6 : 0, artifact: null },
          toolSteps: [],
          contextReads: [],
          artifacts: [],
          restored: false,
        });
        if (!committed.ok) throw new Error(`commit refused: ${committed.issue.code}`);
        if (context.crashAt.point === `after-semantic:${node}`) throw new Error(`scripted crash after semantic commit at ${node}`);
        return output;
      };

    const compiled = compileDag(graph, {
      tasks: {
        pay: lifecycle('pay', true, () => ({ bought: true })),
        wrap: lifecycle('wrap', false, (value) => ({ wrapped: value })),
      },
      checkpoint: checkpoints,
    });
    const result = await compiled.run({ go: true }, {
      runId: segment.segmentJobId,
      onNode: (record) => {
        if (record.status === 'restored') context.restored.push(record.id);
        if (context.observerThrows) throw new Error('a throwing observer must be isolated');
      },
    });
    if (context.crashAt.point === 'after-flow') throw new Error('scripted crash after flow completion, before the terminal commit');
    const current = await context.store.getRun(context.runId);
    if (current?.status === 'running') {
      const transitioned = await context.store.transitionRun(context.runId, { kind: 'complete', output: result });
      if (!transitioned.ok) throw new Error(`terminal commit refused: ${transitioned.issue.code}`);
    }
    if (context.crashAt.point === 'after-terminal') throw new Error('scripted crash after the terminal commit, before job completion');
    await segment.completeSegment({ status: 'completed', result });
  };
}

/** Drive claims one at a time — deterministic, injected clock, no worker loop. */
async function drive(context: Rig, handlers: Record<string, (payload: unknown, ctx: never) => Promise<unknown>>, rounds: number): Promise<Array<'done' | 'failed' | 'idle'>> {
  const jobs = context.db.jobs;
  assert.ok(jobs !== undefined);
  const outcomes: Array<'done' | 'failed' | 'idle'> = [];
  const kinds = Object.keys(handlers);
  for (let round = 0; round < rounds; round += 1) {
    const owner = `driver-${round}`;
    const job = await jobs.claim({ kinds, owner, leaseMs: 60_000 });
    if (job === undefined) {
      outcomes.push('idle');
      continue;
    }
    const countingCheckpoints = (bound: unknown) => {
      const suite = jobs.checkpointsFor(bound as never);
      return {
        load: (runId: string) => {
          context.checkpointLoads.count += 1;
          return suite.load(runId);
        },
        save: suite.save,
        complete: suite.complete,
      };
    };
    try {
      const result = await handlers[job.kind](job.payload, { job, checkpointsFor: countingCheckpoints, signal: new AbortController().signal } as never);
      await jobs.complete(job.id, owner, result ?? null);
      outcomes.push('done');
    } catch (error) {
      await jobs.fail(job.id, owner, error);
      context.clock.value += 300_000; // pass every backoff deterministically
      outcomes.push('failed');
    }
  }
  return outcomes;
}

async function enqueue(context: Rig, overrides: Partial<{ workflowVersionId: string, maxAttempts: number }> = {}): Promise<string> {
  const jobs = context.db.jobs;
  assert.ok(jobs !== undefined);
  const id = await enqueueMasSegment(context.db, {
    runId: context.runId,
    segment: 0,
    workflowVersionId: overrides.workflowVersionId ?? workflow.versionId,
    registryRevision: REGISTRY,
    executableRevision: EXECUTABLE,
  });
  return id;
}

describe('derived enqueue and versioned kinds', () => {
  it('is idempotent per segment and an unregistered kind stays pending', async () => {
    const context = await rig('run-q');
    try {
      const first = await enqueue(context);
      const second = await enqueue(context);
      assert.equal(first, 'run-q:0000');
      assert.equal(second, first);
      const jobs = context.db.jobs;
      assert.ok(jobs !== undefined);
      assert.equal((await jobs.counts()).pending, 1, 're-enqueueing one segment is the suite no-op');

      // A worker registered for a DIFFERENT executable revision never claims it.
      const otherHandlers = createMasSegmentHandlers(context.store, {
        executableRevisions: ['f'.repeat(64)],
        execute: scriptedExecutor(context),
        owner: 'other',
      });
      const outcomes = await drive(context, otherHandlers as never, 1);
      assert.deepEqual(outcomes, ['idle']);
      const counts = await jobs.counts();
      assert.equal(counts.pending, 1, 'the unknown versioned kind remains pending');
      assert.equal(counts.dead, 0, 'it is not accidentally dead-lettered during rollout');
      assert.equal(counts.pendingKinds[`mas:${EXECUTABLE}`], 1);
    } finally {
      await context.db.close();
    }
  });

  it('refuses TMAS2002 before any checkpoint load and dead-letters after its attempts', async () => {
    const context = await rig('run-x');
    try {
      const jobs = context.db.jobs;
      assert.ok(jobs !== undefined);
      await enqueueMasSegment(context.db, {
        runId: context.runId,
        segment: 0,
        workflowVersionId: 'd'.repeat(64), // disagrees with the run row
        registryRevision: REGISTRY,
        executableRevision: EXECUTABLE,
      });
      const handlers = createMasSegmentHandlers(context.store, {
        executableRevisions: [EXECUTABLE],
        execute: scriptedExecutor(context),
        owner: 'fence',
      });
      // maxAttempts default 5: five failing claims dead-letter the job.
      const outcomes = await drive(context, handlers as never, 5);
      assert.deepEqual(outcomes, ['failed', 'failed', 'failed', 'failed', 'failed']);
      const job = await jobs.get('run-x:0000');
      assert.equal(job?.state, 'dead');
      assert.match(job?.lastError ?? '', /TMAS2002/);
      assert.equal(context.checkpointLoads.count, 0, 'the identity fence sits before every checkpoint load');
      assert.equal(context.executions.count, 0, 'no region executed');
    } finally {
      await context.db.close();
    }
  });
});

describe('namespaced checkpoint delegation', () => {
  it('isolates iterations, keeps the lease guard, and prunes atomically at terminal completion', async () => {
    const context = await rig('run-ns');
    try {
      const jobs = context.db.jobs;
      assert.ok(jobs !== undefined);
      await jobs.enqueue('probe', { input: 1 }, { id: 'run-ns:0000' });
      const job = await jobs.claim({ kinds: ['probe'], owner: 'w1', leaseMs: 60_000 });
      assert.ok(job !== undefined);
      const suite = jobs.checkpointsFor(job);
      const first = namespacedRegionCheckpoints(suite, 'run-ns:0000', 'loop:refine//1');
      const second = namespacedRegionCheckpoints(suite, 'run-ns:0000', 'loop:refine//2');
      await Promise.resolve(first.save('run-ns:0000', 't:bump', { count: 1 }));
      await Promise.resolve(second.save('run-ns:0000', 't:bump', { count: 2 }));
      await Promise.resolve(first.complete('run-ns:0000', { region: 1 }));

      const one = await Promise.resolve(first.load('run-ns:0000')) as { values: Record<string, unknown> };
      const two = await Promise.resolve(second.load('run-ns:0000')) as { values: Record<string, unknown> };
      assert.deepEqual(one.values, { 't:bump': { count: 1 }, __region: { region: 1 } }, 'iteration 1 sees only its namespace');
      assert.deepEqual(two.values, { 't:bump': { count: 2 } }, 'iteration 2 sees only its namespace — same node id, no collision');

      await Promise.resolve(suite.complete('run-ns:0000', { done: true }));
      assert.equal(await Promise.resolve(first.load('run-ns:0000')), null, 'terminal completion pruned the segment rows');
      assert.equal((await jobs.get('run-ns:0000'))?.state, 'done');
    } finally {
      await context.db.close();
    }
  });

  it('a region store rejects a foreign segment id instead of guessing', async () => {
    const suite = { load: () => null, save: () => undefined, complete: () => undefined };
    const bound = namespacedRegionCheckpoints(suite, 'run-a:0000', 'dag0//0');
    await assert.rejects(async () => bound.load('run-b:0000'), /bound to segment/);
  });
});

describe('the crash matrix — same outcome, zero duplicate external calls', () => {
  async function matrixCase(runId: string, point: string | null, prepare?: (context: Rig) => void): Promise<Rig> {
    const context = await rig(runId);
    prepare?.(context);
    const handlers = createMasSegmentHandlers(context.store, {
      executableRevisions: [EXECUTABLE],
      execute: scriptedExecutor(context),
      owner: 'matrix',
    });
    await enqueue(context);
    context.crashAt.point = point;
    const first = await drive(context, handlers as never, 1);
    if (point !== null) {
      assert.deepEqual(first, ['failed'], `${point} crashes the first claim`);
      context.crashAt.point = null;
      const second = await drive(context, handlers as never, 1);
      assert.deepEqual(second, ['done'], 'the reclaim closes the segment');
    } else {
      assert.deepEqual(first, ['done']);
    }
    return context;
  }

  async function assertConverged(context: Rig, expected: { externalCalls: number, executions: number, restored: string[] }): Promise<void> {
    try {
      const run = await context.store.getRun(context.runId);
      assert.equal(run?.status, 'completed');
      assert.deepEqual(run?.output, { pay: { bought: true }, wrap: { wrapped: { bought: true } } });
      assert.deepEqual(run?.budget.spent, { turns: 1, tokens: 8, ms: 0 }, 'the paid spend committed exactly once');
      assert.equal(context.externalCalls.count, expected.externalCalls, 'zero duplicate scripted provider calls');
      assert.equal(context.executions.count, expected.executions);
      assert.deepEqual(context.restored.sort(), expected.restored, 'restored nodes are counted');
      const trace = await context.store.readTrace(context.runId);
      const statuses = trace?.attempts.map((attempt) => `${attempt.invocationId}:${attempt.status}`).sort();
      assert.ok(statuses !== undefined && statuses.includes('pay:completed') && statuses.includes('wrap:completed'));
      const jobs = context.db.jobs;
      assert.ok(jobs !== undefined);
      assert.equal((await jobs.get(`${context.runId}:0000`))?.state, 'done');
    } finally {
      await context.db.close();
    }
  }

  it('clean run: one execution, one paid call, complete trace, observer isolation', async () => {
    const context = await matrixCase('run-m0', null, (rigged) => { rigged.observerThrows = true; });
    await assertConverged(context, { externalCalls: 1, executions: 1, restored: [] });
  });

  it('crash before external work: the reclaim re-runs the handler cleanly', async () => {
    const context = await matrixCase('run-m1', 'before-external:pay');
    await assertConverged(context, { externalCalls: 1, executions: 2, restored: [] });
  });

  it('crash after the semantic commit, before the flow save: the stored completion returns, zero new calls', async () => {
    const context = await matrixCase('run-m2', 'after-semantic:pay');
    await assertConverged(context, { externalCalls: 1, executions: 2, restored: [] });
    // the pay attempt completed exactly once; the reclaim consumed the stored completion
  });

  it('crash after the flow save: the suite restores every checkpointed node without invoking a handler', async () => {
    const context = await matrixCase('run-m3', 'after-flow');
    await assertConverged(context, { externalCalls: 1, executions: 2, restored: ['t:pay', 't:wrap'] });
  });

  it('crash after the terminal commit, before job completion: the reclaim closes without executing a region', async () => {
    const context = await matrixCase('run-m4', 'after-terminal');
    await assertConverged(context, { externalCalls: 1, executions: 1, restored: [] });
  });
});

describe('the suite worker end to end', () => {
  it('claims, executes and completes through createMasSegmentWorker', async () => {
    const context = await rig('run-w');
    try {
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => { resolveDone = resolve; });
      const executor = scriptedExecutor(context);
      const worker = createMasSegmentWorker(context.db, context.store, {
        executableRevisions: [EXECUTABLE],
        execute: async (segment) => {
          await executor(segment);
          resolveDone();
        },
        concurrency: 1,
        pollInterval: 5,
        owner: 'worker-e2e',
      });
      worker.start();
      await enqueue(context);
      await done;
      const stopped = await worker.stop();
      assert.equal(stopped.inFlight, 0);
      assert.ok(worker.stats().claims >= 1);
      const run = await context.store.getRun('run-w');
      assert.equal(run?.status, 'completed');
      const jobs = context.db.jobs;
      assert.ok(jobs !== undefined);
      assert.equal((await jobs.get('run-w:0000'))?.state, 'done', 'the checkpoint-store completion marked the job done; the worker completion is the documented no-op');
    } finally {
      await context.db.close();
    }
  });
});
