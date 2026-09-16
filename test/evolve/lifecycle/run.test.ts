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
 * The proposal is `noop-comment`: an edit inside a comment. It passes the
 * gate and measures identical, so it walks the LONGEST path — isolate,
 * apply, gate, both sample batches, fitness, decide, record — and settles
 * `abandoned`/`equal`. A refused proposal would prove the workflow can end
 * without proving any pair works.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createEvolveEffectWorker } from '@tangleai/evolve/host';
import { interactionIdOf } from '@tangleai/mas';

import { createMasStore } from '@tangleai/store';

import { withEvolveRepository } from '../host/fixture.ts';
import { driveExperiment, EXPERIMENT, RUN_ID, type DurableRun } from './rig.ts';

describe('one experiment over the durable path', () => {
  it('reaches a terminal run, answering every wait from its own job', async () => {
    await withEvolveRepository(async (fixture) => {
      const driven = await driveExperiment(fixture);

      assert.equal(driven.status, 'completed',
        'the workflow must be one a run can finish: ' + JSON.stringify({
          answered: driven.answered, unresolved: driven.unresolved, segments: driven.segments,
        }));
      assert.deepEqual(driven.unresolved, [], 'nothing was left for a person to reconcile');
      assert.equal(driven.failures, 0, 'a clean run throws nowhere');

      // Five effect operations, each answered exactly once. Settling is
      // not among them: it spawns git, so it is a reconciler over the
      // stopped run rather than a stage.
      assert.deepEqual(driven.answered, [
        EXPERIMENT + '/isolate',
        EXPERIMENT + '/apply',
        EXPERIMENT + '/gate',
        EXPERIMENT + '/measure-base',
        EXPERIMENT + '/measure-candidate',
      ], 'every stage that reaches a process was answered by the worker, in order');
      assert.equal(driven.writes, 5, 'one recorded intent per operation, and no more');
    });
  });

  it('settles the registered decision and records it once', async () => {
    await withEvolveRepository(async (fixture) => {
      const driven: DurableRun = await driveExperiment(fixture);
      assert.equal(driven.status, 'completed');

      const env = driven.env;
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

      // The experiment branch survives the run: settling is what removes
      // it, and settling is a reconciler the run does not perform.
      assert.deepEqual(driven.branches, ['exp/' + EXPERIMENT]);
    });
  });

  it('leaves no work queued, and a second worker pass spends no process', async () => {
    await withEvolveRepository(async (fixture) => {
      const driven = await driveExperiment(fixture);
      assert.equal(driven.status, 'completed');
      const spent = driven.spawns;

      const jobs = fixture.db.jobs;
      assert.ok(jobs !== undefined);
      const counts = await jobs.counts();
      assert.equal(counts.pending, 0, 'the drive left no work behind');
      assert.equal(counts.dead, 0, 'and dead-lettered nothing');

      const worker = createEvolveEffectWorker({
        jobs: jobs as never, effects: fixture.store as never,
        addressing: { address: async () => undefined },
        driver: fixture.driver, interactions: {
          getInteraction: async () => undefined, respondInteraction: async () => ({ ok: true }),
        }, host: fixture.host, owner: 'second-pass', interactionIdOf,
      });
      const pass = await worker.drain(4);
      assert.deepEqual(pass, { settled: [], deferred: [], unresolved: [], replayed: 0 },
        'there is no queued effect left to claim');
      assert.equal(fixture.runner.spawns, spent, 'a second pass spends no process');
    });
  });
});

/**
 * The two experiments the durable path cannot finish, pinned by what they
 * actually do rather than by what a comment says they do.
 *
 * This is most of the campaign. Nine of the sixteen registered proposals
 * are refused before anything runs and skip every stage; every red-gate
 * proposal skips both measurements. The clean run above passes only
 * because `noop-comment` happens to run every stage — it proved one path,
 * not the workflow.
 *
 * One cause, two shapes. An interaction WAITS once a run reaches it,
 * whether or not its dispatch wrote an intent for a worker to answer. At
 * the top level that is a silent park; inside a switch branch it is a hard
 * failure, because the partitioner carves branch members into a dag
 * subregion and an interaction needs the control host.
 *
 * These tests exist to be DELETED. When the effect middle becomes
 * subgraphs — which get their own region walk, as
 * `test/mas/nested-interaction.test.ts` demonstrates with a durable pause
 * and resume — both of these become ordinary completed runs, and the fix
 * is checkable against this file rather than against a memory.
 */
describe('the experiments the durable path cannot finish yet', () => {
  it('a refused proposal parks on a wait nothing will ever answer', async () => {
    await withEvolveRepository(async (fixture) => {
      const driven = await driveExperiment(fixture, { refuse: true, rounds: 8 });

      assert.equal(driven.spawns, 0,
        'the refusal is still free — nothing reached a process, which is the one '
        + 'property this failure does not cost');
      assert.deepEqual(driven.answered, [], 'no operation was dispatched, so none was answered');

      // And that is exactly the problem: nothing was dispatched, so nothing
      // will ever be enqueued, so no worker will ever be told to answer the
      // wait the run is now parked on.
      assert.equal(driven.status, 'waiting_for_input',
        'a refused proposal should reach `record` with its decision; it stops here instead');

      const store = createMasStore(fixture.db, { now: () => 'probe' });
      const trace = await store.readTrace(RUN_ID);
      assert.deepEqual((trace?.interactions ?? []).map(one => `${(one as { path: string }).path}:${(one as { status: string }).status}`),
        ['await-isolate:waiting'],
        'parked on the first wait of the first stage it declined to run');
    });
  });

  it('a red gate FAILS inside the flake branch rather than parking', async () => {
    await withEvolveRepository(async (fixture) => {
      // `regress-off-by-one` is the registered proposal whose gate goes red,
      // which earns the single rerun — and the rerun's wait is owned by the
      // flake switch's branch. A branch may not own an interaction.
      const driven = await driveExperiment(fixture, { proposal: 'regress-off-by-one', rounds: 12 });

      assert.deepEqual(driven.answered, [
        EXPERIMENT + '/isolate', EXPERIMENT + '/apply', EXPERIMENT + '/gate',
      ], 'it gets as far as the gate, and the gate is red');

      assert.equal(driven.status, 'failed',
        'the rerun is a wait inside a switch branch, and that does not park — it fails');

      const store = createMasStore(fixture.db, { now: () => 'probe' });
      const trace = await store.readTrace(RUN_ID);
      const failure = (trace as { run?: { failure?: { node?: string, error?: { code?: string } } } } | undefined)?.run?.failure;
      assert.equal(failure?.node, 'await-gate-rerun');
      assert.equal(failure?.error?.code, 'TMAS2003',
        'the partitioner carves branch members into a dag subregion, and an '
        + 'interaction needs the control host — so the branch that was supposed '
        + 'to guard the rerun is the thing that breaks it');
    });
  });
});
