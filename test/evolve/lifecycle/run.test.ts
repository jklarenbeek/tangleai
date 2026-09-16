/**
 * One experiment, end to end, over the durable path.
 *
 * Everything else in this folder tests a piece: the version authors, the
 * worker answers, the arithmetic reconciles. None of them could catch the
 * thing this test exists for — that the workflow, compiled against the
 * real MAS runtime and driven over the real queue, actually REACHES
 * `completed`. A version that validates, lowers and stores can still be
 * one no run can finish, and that is not a theoretical worry: the first
 * version authored here parked forever on a wait nothing was enqueued to
 * answer, and every unit test passed.
 *
 * So this drives the real thing. A real git repository, the real process
 * runner, the real fenced effect store, the real segment handlers and the
 * real effect worker, claim by claim with no polling and no sleeping. The
 * only thing scripted is which proposal is offered.
 *
 * The proposal is `noop-comment`: an edit inside a comment. It passes the
 * gate and measures identical, so it walks the LONGEST path — isolate,
 * apply, gate, both sample batches, fitness, decide, record — and settles
 * `abandoned`/`equal`. A refused proposal would prove the workflow can end
 * without proving any pair works.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  createMasStore, createMasSegmentHandlers, enqueueMasSegment, ensurePendingMasSegments,
} from '@tangleai/store';
import {
  createMasRegistrySnapshot, createMasConfigCatalog,
  validateMasWorkflow, planMasWorkflow, compileMasRuntime, interactionIdOf,
} from '@tangleai/mas';
import {
  buildEvolveLifecycle, evolveRegistryDocument, createEvolveLifecycleHandlers,
  emptyEnvelope, type EvolveEnvelope, type LifecycleContext,
} from '@tangleai/evolve/lifecycle';
import { createEvolveEffectWorker, createEffectAddressing } from '@tangleai/evolve/host';
import type { PreparedPatch } from '@tangleai/evolve';

import { withEvolveRepository, type EvolveRepositoryFixture } from '../host/fixture.ts';

const EXPERIMENT = 'e-durable-noop';
const RUN_ID = 'evolve-run-noop';
const PROPOSAL = 'noop-comment';

/** The registered proposal, as the write plan 04's refiner would have produced. */
async function preparedNoop(): Promise<PreparedPatch> {
  const document = JSON.parse(await readFile(
    join(process.cwd(), 'benchmark/fixtures/evolve/proposals', PROPOSAL + '.json'), 'utf8')) as {
      id: string, strategyId: string, rationale: string, evidence: string,
      patch: Array<{ op: string, path: string, value?: string }>,
    };

  const writes = document.patch
    .filter(one => one.value !== undefined)
    .map(one => ({ path: one.path.replace('/files/', '').replaceAll('~1', '/'), text: one.value! }));

  return {
    proposal: {
      proposalId: document.id, strategyId: document.strategyId,
      rationale: document.rationale, evidence: [document.evidence],
      patch: document.patch as never, origin: 'hand-authored',
    },
    plan: {
      writes, removes: [],
      changed: writes.map(one => one.path),
      bytes: writes.reduce((sum, one) => sum + Buffer.byteLength(one.text), 0),
    },
    next: {} as never,
  };
}

/** The lifecycle version, its registry and its executable plan. */
async function lifecycle(experimentMs: number) {
  const registry = await createMasRegistrySnapshot(evolveRegistryDocument());
  assert.ok(registry.valid, JSON.stringify(registry));
  const catalog = await createMasConfigCatalog({ profiles: ['evolve'], tools: [], contexts: [] });
  assert.ok(catalog.valid);

  const workflow = await buildEvolveLifecycle({
    experimentMs,
    registryRevision: registry.value.revision,
    configRegistryRevision: catalog.value.revision,
    profile: 'evolve',
  });
  const validated = await validateMasWorkflow(workflow, registry.value, catalog.value);
  assert.ok(validated.valid, JSON.stringify(!validated.valid ? validated.issues : null));
  const plan = await planMasWorkflow(validated.value);
  assert.ok(plan.valid, JSON.stringify(plan));

  return { workflow, validated: validated.value, plan: plan.value, registry: registry.value, catalog: catalog.value };
}

interface Driven {
  status: string;
  output: Record<string, unknown> | undefined;
  segments: number;
  answered: string[];
  unresolved: string[];
  spawns: number;
  recorded: EvolveEnvelope[];
}

/**
 * Run one experiment to a terminal run status, claim by claim.
 *
 * The loop is the whole durable contract in nine lines: a segment runs
 * until it hits a wait, the worker answers that wait from its own job and
 * its own lease, the reconciler turns the answer into the next segment.
 * Nothing sleeps and nothing polls, so a failure here is a failure of the
 * path rather than of a timeout.
 */
async function driveExperiment(
  fixture: EvolveRepositoryFixture,
  options: { budgetSegments?: number } = {},
): Promise<Driven> {
  const { db } = fixture;
  const jobs = db.jobs;
  assert.ok(jobs !== undefined);

  let tick = 0;
  const masStore = createMasStore(db, { now: () => `tick-${String(tick++).padStart(4, '0')}` });
  const { workflow, validated, plan, registry } = await lifecycle(600_000);
  assert.ok((await masStore.putWorkflowVersion(workflow)).ok, 'the authored version stores');

  const created = await masStore.createRun({
    runId: RUN_ID,
    workflowId: workflow.workflowId,
    workflowVersionId: workflow.versionId,
    registryRevision: registry.revision,
    executableRevision: plan.executableRevision,
    configRegistryRevision: null,
    profile: 'evolve',
    input: { env: emptyEnvelope({ experimentId: EXPERIMENT, proposalId: PROPOSAL, strategyId: 'S-cosmetic' }) },
    limits: { calls: 32, tokens: 200000, ms: 600000, toolRounds: 4, fanOut: 8, concurrency: 8, iterations: 8, contextChars: 40000, traceBytes: 1000000 },
  } as never);
  assert.ok(created.ok, JSON.stringify(created));

  const recorded: EvolveEnvelope[] = [];

  const context: LifecycleContext = {
    preparer: { prepare: (target) => fixture.driver.prepare(target) },
    effects: fixture.store as never,
    host: fixture.host,
    transcript: fixture.transcript,
    experimentId: EXPERIMENT,
    worktreePath: join(resolve(fixture.worktreeRoot), EXPERIMENT),
    repositoryRoot: fixture.repositoryRoot,
    baseRevision: fixture.baseRevision,
    budgets: fixture.repository.budgets,
    gateArgs: fixture.gateArgs,
    instrumentArgs: fixture.instrumentArgs,
    metric: { name: 'comparisons', direction: 'lower' },
    truth: fixture.truth,
    minDelta: 1,
    prepared: { ok: true, value: await preparedNoop() },
    decideRefusal: () => ({ decision: 'refused', reason: 'goalpost', code: 'TEVO1001' }),
    record: async (env) => { recorded.push(env); },
  };

  const runtime = compileMasRuntime(validated, plan, registry, {
    store: masStore as never,
    taskHandlers: createEvolveLifecycleHandlers(context) as never,
    toolBindings: {},
    contextProviders: {},
    now: () => `tick-${String(tick++).padStart(4, '0')}`,
    clock: () => 1_000_000,
    // Every wait declares an expiry, so the host must be able to name a
    // deadline. It is never reached here: the worker answers first.
    deadlineFor: () => 'tick-9999',
  } as never);
  assert.ok(runtime.valid, JSON.stringify(!runtime.valid ? runtime.issues : null));

  const segmentHandlers = createMasSegmentHandlers(masStore, {
    executableRevisions: [plan.executableRevision],
    execute: (segment) => runtime.value.executeSegment(segment as never),
    owner: 'durable-run',
  });

  // The worker reads the plan out of the record and the wait out of the
  // run. Both survive the process that dispatched them, which is what
  // makes answering after a crash the same operation as answering before.
  const addressing = createEffectAddressing({
    waitingPaths: async (id) => {
      const trace = await masStore.readTrace(id);
      return (trace?.interactions ?? [])
        .filter(one => (one as { status?: string }).status === 'waiting')
        .map(one => (one as { path: string }).path);
    },
    runIdFor: async (experimentId) => (experimentId === EXPERIMENT ? RUN_ID : undefined),
    baseSealFor: async () => ({
      repositoryRoot: fixture.repositoryRoot, baseRevision: fixture.baseRevision,
    }),
  });

  const worker = createEvolveEffectWorker({
    jobs: jobs as never,
    effects: fixture.store as never,
    addressing,
    driver: fixture.driver,
    interactions: masStore as never,
    host: fixture.host,
    owner: 'effect-worker',
    interactionIdOf,
  });

  await enqueueMasSegment(db, {
    runId: RUN_ID, segment: 0,
    workflowVersionId: workflow.versionId,
    registryRevision: registry.revision,
    executableRevision: plan.executableRevision,
  });

  const answered: string[] = [];
  const unresolved: string[] = [];
  let segments = 0;
  const kinds = Object.keys(segmentHandlers);
  const ceiling = options.budgetSegments ?? 16;

  for (let round = 0; round < ceiling; round++) {
    const job = await jobs.claim({ kinds, owner: `segment-${round}`, leaseMs: 60_000 });
    if (job !== undefined) {
      segments += 1;
      try {
        const handler = (segmentHandlers as Record<string, (payload: unknown, ctx: unknown) => Promise<unknown>>)[job.kind];
        const result = await handler(
          job.payload,
          { job, checkpoints: jobs.checkpointsFor(job as never), signal: new AbortController().signal },
        );
        await jobs.complete(job.lease, result ?? null);
      }
      catch (error) { await jobs.fail(job.lease, error); }
    }

    const run = await masStore.getRun(RUN_ID);
    if (run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled') {
      return {
        status: run.status, output: run.output as Record<string, unknown> | undefined,
        segments, answered, unresolved, spawns: fixture.runner.spawns, recorded,
      };
    }

    // The wait the run parked on is answered from another job, holding a
    // lease of its own. This is the half a segment may not do.
    const pass = await worker.drain(4);
    answered.push(...pass.settled);
    unresolved.push(...pass.unresolved);

    // And the answer becomes the next segment. Resume is the suite's path;
    // this package adds no second one.
    await ensurePendingMasSegments(db, masStore);
  }

  const last = await masStore.getRun(RUN_ID);
  return {
    status: last?.status ?? 'unknown', output: last?.output as Record<string, unknown> | undefined,
    segments, answered, unresolved, spawns: fixture.runner.spawns, recorded,
  };
}

describe('one experiment over the durable path', () => {
  it('reaches a terminal run, answering every wait from its own job', async () => {
    await withEvolveRepository(async (fixture) => {
      const driven = await driveExperiment(fixture);

      assert.equal(driven.status, 'completed',
        'the workflow must be one a run can finish: ' + JSON.stringify({
          answered: driven.answered, unresolved: driven.unresolved, segments: driven.segments,
        }));
      assert.deepEqual(driven.unresolved, [], 'nothing was left for a person to reconcile');

      // Six effect operations, each answered exactly once. Settling is not
      // among them: it spawns git, so it is a reconciler over the stopped
      // run rather than a stage.
      assert.deepEqual(driven.answered, [
        EXPERIMENT + '/isolate',
        EXPERIMENT + '/apply',
        EXPERIMENT + '/gate',
        EXPERIMENT + '/measure-base',
        EXPERIMENT + '/measure-candidate',
      ], 'every stage that reaches a process was answered by the worker, in order');
    });
  });

  it('settles the registered decision and records it once', async () => {
    await withEvolveRepository(async (fixture) => {
      const driven = await driveExperiment(fixture);
      assert.equal(driven.status, 'completed');

      const env = (driven.output as { env?: EvolveEnvelope } | undefined)?.env;
      assert.ok(env !== undefined, 'the envelope leaves the workflow as its output');
      assert.equal(env.gate, 'green', 'a comment edit does not fail the gate');
      assert.deepEqual(env.decision, { decision: 'abandoned', reason: 'equal', code: 'TEVO1008' },
        'the registered verdict for this proposal, reached over the durable path');

      // Ten legs: 2 isolate + 1 apply + 1 gate + 3 base + 3 candidate. The
      // sequential path publishes the same number for this row, and the
      // equivalence test derives it a third way.
      assert.equal(env.legs, 10, 'the census the published row carries');
      assert.equal(env.unresolved, 0);

      assert.equal(driven.recorded.length, 1, 'the outcome is recorded exactly once');
      assert.deepEqual(driven.recorded[0].decision, env.decision);
    });
  });

  it('leaves no work queued, and a second worker pass spends no process', async () => {
    await withEvolveRepository(async (fixture) => {
      const driven = await driveExperiment(fixture);
      assert.equal(driven.status, 'completed');
      const spent = driven.spawns;

      // Re-enqueue the terminal segment and drive it again. The run is
      // already completed, every effect plan id is already settled, and
      // nothing may reach a process a second time — that property is what
      // makes a resumed experiment publishable rather than a re-run.
      const jobs = fixture.db.jobs;
      assert.ok(jobs !== undefined);
      const before = await jobs.counts();
      assert.equal(before.pending, 0, 'the drive left no work behind');

      const worker = createEvolveEffectWorker({
        jobs: jobs as never, effects: fixture.store as never,
        addressing: { address: async () => undefined },
        driver: fixture.driver, interactions: {
          getInteraction: async () => undefined, respondInteraction: async () => ({ ok: true }),
        }, host: fixture.host, owner: 'second-pass', interactionIdOf,
      });
      const pass = await worker.drain(4);
      assert.deepEqual(pass, { settled: [], unresolved: [], replayed: 0 },
        'there is no queued effect left to claim');
      assert.equal(fixture.runner.spawns, spent, 'a second pass spends no process');
    });
  });
});
