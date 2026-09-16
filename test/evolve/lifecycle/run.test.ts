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

import { withEvolveRepository } from '../host/fixture.ts';
import { driveExperiment, EXPERIMENT, type DurableRun } from './rig.ts';

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
