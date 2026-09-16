/**
 * One experiment on the durable path, drivable and crashable.
 *
 * Everything here is real: a real git repository, the real process runner,
 * the real fenced effect store, the real MAS runtime compiled against the
 * evolve handlers, the real segment handlers and the real effect worker.
 * The only things this module adds are a hand-driven claim loop — so no
 * test sleeps or polls — and one injectable crash point.
 *
 * The crash points are the boundaries that actually exist on this path,
 * named for what has and has not happened when the process dies. They are
 * the whole reason the path is shaped the way it is, so a matrix over them
 * is the honest test of whether the shape was worth it.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  createMasStore, createMasSegmentHandlers, enqueueMasSegment, ensurePendingMasSegments,
} from '@tangleai/store';
import {
  createMasRegistrySnapshot, createMasConfigCatalog,
  validateMasWorkflow, planMasWorkflow, compileMasRuntime, interactionIdOf,
  MasInfrastructureCrash,
} from '@tangleai/mas';
import {
  buildEvolveLifecycle, evolveRegistryDocument, createEvolveLifecycleHandlers,
  emptyEnvelope, type EvolveEnvelope, type LifecycleContext,
} from '@tangleai/evolve/lifecycle';
import { createEvolveEffectWorker, createEffectAddressing } from '@tangleai/evolve/host';
import type { EffectPlan } from '@tangleai/evolve/host';
import type { PreparedPatch } from '@tangleai/evolve';

import { rawGit, type EvolveRepositoryFixture } from '../host/fixture.ts';

export const EXPERIMENT = 'e-durable-noop';
export const RUN_ID = 'evolve-run-noop';
export const PROPOSAL = 'noop-comment';

/**
 * Where a process may die, and what has already happened when it does.
 *
 * `<stage>` is an effect stage id, so a point can be aimed at the exact
 * operation whose window is under test.
 */
export type CrashPoint =
  /** Nothing was recorded; the intent was never written. */
  | `before-prepare:${string}`
  /** The intent is recorded and its job enqueued; the flow never saved. */
  | `after-prepare:${string}`
  /** The flow finished and the run parked; the segment job never completed. */
  | 'after-segment'
  /** The effect RAN. Its answer never reached the wait. */
  | `before-answer:${string}`
  /** The wait is answered; the resume segment was never enqueued. */
  | 'after-answer'
  /** The resume segment is enqueued; nobody claimed it that round. */
  | 'before-resume'
  /** The run reached its terminal status; its job never completed. */
  | 'after-terminal';

export interface DurableRun {
  status: string;
  env: EvolveEnvelope | undefined;
  /** Segment claims that ran a handler, including the ones that threw. */
  segments: number;
  /** Claims that threw. One per armed crash, and otherwise zero. */
  failures: number;
  answered: string[];
  unresolved: string[];
  /** Operations the worker put back because nothing was waiting yet. */
  deferred: string[];
  /** Processes spawned. The convergence number that matters most. */
  spawns: number;
  recorded: EvolveEnvelope[];
  /** Every `prepare` that actually wrote, summed. One per operation. */
  writes: number;
  /** `exp/<id>` branches in the repository when the run stopped. */
  branches: string[];
}

/** The registered proposal, as 04's refiner would have prepared it. */
export async function preparedProposal(id = PROPOSAL): Promise<PreparedPatch> {
  const document = JSON.parse(await readFile(
    join(process.cwd(), 'benchmark/fixtures/evolve/proposals', id + '.json'), 'utf8')) as {
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

/** The lifecycle version, its registry snapshot and its executable plan. */
export async function lifecycleVersion(experimentMs = 600_000) {
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

  return {
    workflow, validated: validated.value, plan: plan.value,
    registry: registry.value, catalog: catalog.value,
  };
}

const stageOf = (plan: EffectPlan): string => plan.id.slice(plan.id.lastIndexOf('/') + 1);

/**
 * Drive one experiment to a terminal run status, claim by claim.
 *
 * The loop IS the durable contract: a segment runs until it hits a wait,
 * the effect worker answers that wait from its own job under its own
 * lease, and the reconciler turns the answer into the next segment. A
 * crash is one throw at one named boundary, disarmed after it fires, so
 * every case is "die once, then converge".
 */
export async function driveExperiment(
  fixture: EvolveRepositoryFixture,
  options: { crashAt?: CrashPoint | null, rounds?: number } = {},
): Promise<DurableRun> {
  const { db } = fixture;
  const jobs = db.jobs;
  assert.ok(jobs !== undefined);

  let armed: CrashPoint | null = options.crashAt ?? null;
  /** Fire once, then never again: the matrix tests recovery, not a loop. */
  const fires = (point: CrashPoint): boolean => {
    if (armed !== point) return false;
    armed = null;
    return true;
  };

  let tick = 0;
  const masStore = createMasStore(db, { now: () => `tick-${String(tick++).padStart(4, '0')}` });
  const { workflow, validated, plan, registry } = await lifecycleVersion();
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
    limits: {
      calls: 32, tokens: 200000, ms: 600000, toolRounds: 4, fanOut: 8,
      concurrency: 8, iterations: 8, contextChars: 40000, traceBytes: 1000000,
    },
  } as never);
  assert.ok(created.ok, JSON.stringify(created));

  const recorded: EvolveEnvelope[] = [];
  let writes = 0;

  const context: LifecycleContext = {
    preparer: {
      prepare: async (target) => {
        // Before: nothing was recorded, so the reclaim has to write the
        // intent itself. After: the intent IS recorded and its job IS
        // enqueued, and the reclaim must find that rather than repeat it.
        // `MasInfrastructureCrash`, not a plain error, because those are
        // two different events and only one of them is what this file is
        // about. A handler that THROWS has failed the node, and a failed
        // node fails the run — a verdict. A crash unwinds the node without
        // touching its attempt, which is what losing the process does.
        if (fires(`before-prepare:${stageOf(target)}` as CrashPoint)) {
          throw new MasInfrastructureCrash('crash before the intent was written at ' + target.id);
        }
        const prepared = await fixture.driver.prepare(target);
        if (prepared.ok) writes += prepared.value.prepared;
        if (fires(`after-prepare:${stageOf(target)}` as CrashPoint)) {
          throw new MasInfrastructureCrash('crash after the intent was written at ' + target.id);
        }
        return prepared;
      },
    },
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
    prepared: { ok: true, value: await preparedProposal() },
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
    execute: async (segment) => {
      await runtime.value.executeSegment(segment as never);
      const run = await masStore.getRun(RUN_ID);
      const terminal = run?.status === 'completed' || run?.status === 'failed';
      // Both of these die with the semantic work already committed and
      // only the job left to close — the cheapest crash there is, and the
      // one a resumed run must not pay for twice.
      if (terminal && fires('after-terminal')) throw new Error('crash after the terminal commit');
      if (fires('after-segment')) throw new Error('crash after the segment settled, before its job closed');
    },
    owner: 'durable-run',
  });

  const answered: string[] = [];
  const unresolved: string[] = [];
  const deferred: string[] = [];

  const worker = createEvolveEffectWorker({
    jobs: jobs as never,
    effects: fixture.store as never,
    addressing: createEffectAddressing({
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
    }),
    driver: fixture.driver,
    interactions: {
      getInteraction: (id: string) => masStore.getInteraction(id) as never,
      respondInteraction: async (id, response, expected, key) => {
        // The window the semantic plan id exists for: the effect HAPPENED
        // and nobody recorded that it was answered. The next pass must
        // replay it rather than run it, and answer under the same key.
        if (fires(`before-answer:${String(key).slice(String(key).lastIndexOf('/') + 1)}` as CrashPoint)) {
          throw new Error('crash after the effect ran, before its wait was answered');
        }
        return masStore.respondInteraction(id, response, expected, key) as never;
      },
    },
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

  let segments = 0;
  let failures = 0;
  const kinds = Object.keys(segmentHandlers);

  for (let round = 0; round < (options.rounds ?? 24); round++) {
    if (!fires('before-resume')) {
      const job = await jobs.claim({ kinds, owner: `segment-${round}`, leaseMs: 60_000 });
      if (job !== undefined) {
        segments += 1;
        try {
          const handler = (segmentHandlers as Record<string, (payload: unknown, ctx: unknown) => Promise<unknown>>)[job.kind];
          const result = await handler(job.payload, {
            job, checkpoints: jobs.checkpointsFor(job as never), signal: new AbortController().signal,
          });
          await jobs.complete(job.lease, result ?? null);
        }
        catch (error) {
          failures += 1;
          await jobs.fail(job.lease, error);
          // Past every backoff, deterministically. Nothing sleeps.
          fixture.clock.value += 300_000;
        }
      }
    }

    const run = await masStore.getRun(RUN_ID);
    const terminal = run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled';
    // A terminal run whose job is still open is not finished: the reclaim
    // has to close it, and that reclaim must execute no region.
    if (terminal && (await jobs.counts()).pending === 0) break;

    try {
      const pass = await worker.drain(4);
      answered.push(...pass.settled);
      unresolved.push(...pass.unresolved);
      deferred.push(...pass.deferred);
      // A deferred job is left claimed until its lease lapses — the same
      // return path a worker that died would take. Real time lapses it;
      // here the clock does, which is that event without the waiting.
      if (pass.deferred.length > 0 || pass.unresolved.length > 0) fixture.clock.value += 300_000;
    }
    catch (error) {
      // A worker that dies mid-pass leaves its lease held. Real time
      // expires it; here the clock does, which is the same event without
      // the wait.
      failures += 1;
      fixture.clock.value += 300_000;
      void error;
    }

    if (!fires('after-answer')) await ensurePendingMasSegments(db, masStore);
  }

  const last = await masStore.getRun(RUN_ID);
  const shown = await rawGit(fixture.repositoryRoot, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/exp');

  return {
    status: last?.status ?? 'unknown',
    env: (last?.output as { env?: EvolveEnvelope } | undefined)?.env,
    segments, failures, answered, unresolved, deferred,
    spawns: fixture.runner.spawns,
    recorded, writes,
    branches: String(shown.stdout ?? '').split('\n').map(one => one.trim()).filter(one => one.length > 0),
  };
}
