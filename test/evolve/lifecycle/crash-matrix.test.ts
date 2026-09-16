/**
 * The crash matrix: die once at every boundary, converge to one answer.
 *
 * This is the test the durable path exists for. Every other property —
 * the semantic plan id, the fence, the pair of dispatch and wait, the
 * response key that is the record id — was chosen so that a process dying
 * at a particular instant costs nothing and duplicates nothing. None of
 * those choices is worth anything unless that is actually true, and the
 * only way to know is to kill the process at each instant and check.
 *
 * Seven boundaries, named for what has and has not happened when the
 * process dies:
 *
 *   1. before the intent was written — nothing is recorded
 *   2. after the intent was written — the record and its job exist, the
 *      flow never saved
 *   3. after the segment settled — the run parked, its job never closed
 *   4. after the effect RAN, before its wait was answered — the expensive
 *      window, and the whole reason the plan id is semantic
 *   5. after the wait was answered — the resume segment was never enqueued
 *   6. after the resume segment was enqueued — nobody claimed it
 *   7. after the terminal commit — the run is done, its job is not closed
 *
 * Convergence means the SAME answer, not merely a terminal one: the same
 * decision, the same leg census, the same recorded outcome, the same
 * branch — and above all the same number of processes spawned. A crash
 * that costs an extra spawn is a crash that re-ran a gate or re-took a
 * measurement, which is exactly what would make a resumed experiment
 * unpublishable.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { withEvolveRepository } from '../host/fixture.ts';
import { driveExperiment, EXPERIMENT, type CrashPoint, type DurableRun } from './rig.ts';

/** What every case must reach, whatever it died in the middle of. */
const CONVERGED = {
  status: 'completed',
  decision: { decision: 'abandoned', reason: 'equal', code: 'TEVO1008' },
  legs: 10,
  unresolved: 0,
  answered: [
    EXPERIMENT + '/isolate',
    EXPERIMENT + '/apply',
    EXPERIMENT + '/gate',
    EXPERIMENT + '/measure-base',
    EXPERIMENT + '/measure-candidate',
  ],
  writes: 5,
  branches: ['exp/' + EXPERIMENT],
} as const;

/**
 * The clean run's spawn count, measured once and reused as the ceiling.
 *
 * Read rather than written down: the fixture's own gate and instrument
 * decide it, and a hard-coded number would turn a legitimate change to
 * the fixture into a failure of this file.
 */
let cleanSpawns: number | null = null;

function assertConverged(
  driven: DurableRun, note: string,
  expected: { decision?: typeof CONVERGED.decision | Record<string, unknown>, legs?: number, answered?: readonly string[] } = {},
): void {
  assert.equal(driven.status, CONVERGED.status,
    `${note}: the run must still finish — ${JSON.stringify({
      answered: driven.answered, unresolved: driven.unresolved,
      segments: driven.segments, failures: driven.failures,
    })}`);

  assert.deepEqual(driven.env?.decision, expected.decision ?? CONVERGED.decision,
    `${note}: a resumed run must reach the SAME verdict, not merely a verdict`);
  assert.equal(driven.env?.legs, expected.legs ?? CONVERGED.legs,
    `${note}: the published leg census moved, so the row would move`);
  assert.equal(driven.env?.unresolved, CONVERGED.unresolved, `${note}: left something unaccounted for`);

  assert.deepEqual(driven.answered, expected.answered ?? CONVERGED.answered,
    `${note}: every operation is answered exactly once, in order`);
  assert.deepEqual(driven.unresolved, [], `${note}: nothing was left for a person`);

  assert.equal(driven.writes, CONVERGED.writes,
    `${note}: an intent was written twice, so the fence did not recognise the replay`);
  assert.equal(driven.recorded.length, 1,
    `${note}: the outcome was recorded ${driven.recorded.length} times`);
  assert.deepEqual(driven.branches, CONVERGED.branches,
    `${note}: an experiment left more than its own branch behind`);

  // The control runs first and every other case is measured against it.
  // Said out loud rather than assumed: if this file is ever reordered, or
  // node:test is asked to run a describe's cases concurrently, the whole
  // matrix would silently compare against nothing.
  assert.ok(cleanSpawns !== null,
    `${note}: the clean control has not run yet, so there is nothing to converge to`);
  assert.equal(driven.spawns, cleanSpawns,
    `${note}: spent ${driven.spawns} processes against the clean run's ${cleanSpawns} — `
    + 'a crash that costs a spawn re-ran a gate or re-took a measurement, and a '
    + 'measurement taken twice is not the measurement that was published');
}

/** Run one case: die once at `point`, then drive to the end. */
async function matrixCase(point: CrashPoint | null): Promise<DurableRun> {
  return withEvolveRepository(async (fixture) => driveExperiment(fixture, { crashAt: point }));
}

describe('the crash matrix — one answer, whatever died', () => {
  it('measures the clean run first, and everything else is compared to it', async () => {
    const clean = await matrixCase(null);
    cleanSpawns = clean.spawns;
    assert.equal(clean.failures, 0, 'the control throws nowhere');
    assert.ok(cleanSpawns > 0, 'the control actually reached processes');
    assertConverged(clean, 'clean');
  });

  it('1. crash before the intent was written: the reclaim writes it, once', async () => {
    // Nothing is recorded, so there is nothing to replay — the reclaim has
    // to do the whole dispatch. The property is that it does it ONCE.
    const driven = await matrixCase('before-prepare:gate');
    assert.equal(driven.failures, 1, 'exactly one crash fired');
    assertConverged(driven, 'before-prepare:gate');
  });

  it('2. crash after the intent was written: the reclaim finds it rather than repeating it', async () => {
    // The record exists AND its job is enqueued — the fenced store wrote
    // both in one transaction. A reclaim that prepared again would either
    // write a second intent or be refused a shared job identity; instead
    // preparing is a read, and `writes` stays at one per operation.
    const driven = await matrixCase('after-prepare:gate');
    assert.equal(driven.failures, 1);
    assertConverged(driven, 'after-prepare:gate');
  });

  it('2b. the same, at the measurement — the expensive intent to duplicate', async () => {
    const driven = await matrixCase('after-prepare:measure-candidate');
    assert.equal(driven.failures, 1);
    assertConverged(driven, 'after-prepare:measure-candidate');
  });

  it('3. crash after the segment settled, before its job closed: the reclaim restores', async () => {
    // The flow finished and the run parked; only the job is open. The
    // reclaim must reach the same place without executing a region again.
    const driven = await matrixCase('after-segment');
    assert.equal(driven.failures, 1);
    assertConverged(driven, 'after-segment');
  });

  it('4. crash after the effect RAN, before its wait was answered: the replay answers', async () => {
    // The window every other choice was made for. The gate has already
    // run; if the next pass ran it again, the experiment would be
    // published from a second gate nobody compared against the first.
    // Instead the same semantic plan id finds every leg settled, replays
    // without spawning, and answers under the same key — which the store
    // reads as the same response rather than a conflict.
    const driven = await matrixCase('before-answer:gate');
    assert.ok(driven.failures >= 1, 'the answer was lost at least once');
    assertConverged(driven, 'before-answer:gate');
  });

  // 4b — the same crash at the BASE sample batch — is deliberately absent,
  // and what is missing is worth more than what is here.
  //
  // It cannot be driven to convergence yet, for a reason that has nothing
  // to do with crashes. A lost answer on the base batch makes that
  // experiment `uncertain`, and a decided envelope makes every later stage
  // decline to run — at which point the run parks on `await-measure-candidate`
  // forever, because an interaction node WAITS whether or not its dispatch
  // wrote anything for a worker to answer.
  //
  // So the durable path today completes exactly the experiments that skip
  // no stage. That is not most of them: nine of the sixteen registered
  // proposals are refused before anything runs and skip all five, and every
  // red-gate proposal skips both measurements. The clean run passes here
  // only because `noop-comment` happens to run every stage.
  //
  // The fix is structural and is not a guard: a switch branch may not
  // contain an interaction — the partitioner carves branch members into a
  // dag subregion, and an interaction needs the control host, so it fails
  // `TMAS2003`. (The `flake` branch holds `await-gate-rerun` and has the
  // same defect today, unexercised.) What does work is a SUBGRAPH, which
  // gets its own region walk; `test/mas/nested-interaction.test.ts` drives
  // a durable pause and resume inside one. That is the next order's work.
  //
  // What the attempt did settle is kept: a worker answering from a replay
  // reports `sealHeld: null`, because it did not take the batch and cannot
  // say whether the base held while somebody else did. `worker.test.ts`
  // pins it.

  it('5. crash after the wait was answered: the reconciler enqueues the resume', async () => {
    // The answer landed; nothing turned it into a segment. `ensurePending`
    // is the suite's own path and this package adds no second one, so the
    // next pass picks it up with no special handling at all.
    const driven = await matrixCase('after-answer');
    assertConverged(driven, 'after-answer');
  });

  it('6. crash after the resume was enqueued: the next claim takes it', async () => {
    const driven = await matrixCase('before-resume');
    assertConverged(driven, 'before-resume');
  });

  it('7. crash after the terminal commit: the reclaim closes without executing a region', async () => {
    // Everything is decided and recorded; only the job is open. The
    // reclaim must not record a second outcome — which is the assertion
    // `recorded.length === 1` makes inside `assertConverged`.
    const driven = await matrixCase('after-terminal');
    assert.equal(driven.failures, 1);
    assertConverged(driven, 'after-terminal');
  });
});
