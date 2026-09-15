/**
 * The gate, and the distinction the whole flake policy rests on.
 *
 * A gate that exits non-zero has REACHED a verdict about the change, and
 * that verdict earns the single rerun. A gate that was killed at its
 * deadline, drowned in output, or refused before it started reached no
 * verdict at all, and must never be credited with one — because `red`
 * spends a rerun, and a command that cannot finish would spend it on
 * running out of budget a second time.
 *
 * `flaky-marker-file` is the registered row that proves the policy holds
 * in both directions: red, then green on the one rerun, and then no third
 * attempt no matter how tempting a green looks.
 *
 * Every case is wrapped in the operator-repository digest probe, so each
 * assertion about a gate is also an assertion that nothing escaped into
 * the operator's tree while it ran.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runGate, gateVerdictOf, earnsRerun } from '@tangleai/evolve/host';
import type { EvolveGateResult } from '@tangleai/evolve/contracts';

import { withEvolveRepository, stageProposal, operatorDigest, type EvolveRepositoryFixture } from './fixture.ts';

/** Run a gate leg over a staged proposal, with the operator probe wrapped round it. */
async function gateOver(
  fixture: EvolveRepositoryFixture,
  experimentId: string,
  proposalId: string,
  leg: 'gate' | 'gate-rerun' = 'gate',
  staged?: { path: string },
) {
  const before = await operatorDigest(fixture.repositoryRoot, fixture.repository.protectedRefs);
  const workspace = staged ?? await stageProposal(fixture, experimentId, proposalId);
  const outcome = await runGate({
    driver: fixture.driver,
    effects: fixture.store,
    host: fixture.host,
    experimentId,
    worktreePath: workspace.path,
    args: fixture.gateArgs,
    budgets: fixture.repository.budgets,
    leg,
    transcript: fixture.transcript,
  });
  const after = await operatorDigest(fixture.repositoryRoot, fixture.repository.protectedRefs);
  assert.equal(after, before, 'the operator repository is untouched by a gate');
  return { outcome, workspace };
}

describe('the gate verdict', () => {
  it('reads a budget refusal as over-budget and never as red', () => {
    assert.equal(gateVerdictOf({ id: 'gate', state: 'rejected', evidence: { code: 'TEVO1005' } }), 'over-budget');
    assert.equal(gateVerdictOf({ id: 'gate', state: 'rejected', evidence: { code: 'TEVO1006' } }), 'command-refused');
    assert.equal(gateVerdictOf({ id: 'gate', state: 'confirmed', evidence: { exitCode: 0 } }), 'green');
    assert.equal(gateVerdictOf({ id: 'gate', state: 'rejected', evidence: { exitCode: 1, signal: null } }), 'red');

    // Killed, or drowned: neither reached a verdict about the change.
    assert.equal(gateVerdictOf({ id: 'gate', state: 'rejected', evidence: { exitCode: null, signal: 'SIGKILL' } }), 'over-budget');
    assert.equal(gateVerdictOf({
      id: 'gate', state: 'rejected', evidence: { exitCode: 0, truncated: { stdout: true, stderr: false } },
    }), 'over-budget', 'a flood is a budget even behind a zero exit');

    // A leg that settled with nothing readable is not a verdict either.
    assert.equal(gateVerdictOf({ id: 'gate', state: 'rejected', evidence: {} }), 'command-refused');
  });

  it('grants a rerun to red alone', () => {
    assert.equal(earnsRerun('red'), true);
    for (const verdict of ['green', 'over-budget', 'command-refused', null] as const) {
      assert.equal(earnsRerun(verdict), false, String(verdict) + ' must not earn a rerun');
    }
  });
});

describe('running the registered gate', () => {
  it('passes the base itself, and fails a regression on one leg', async () => {
    await withEvolveRepository(async (fixture) => {
      // The no-op proposal changes a comment; the gate must still pass.
      const green = await gateOver(fixture, 'e-noop', 'noop-comment');
      assert.equal(green.outcome.ok, true, JSON.stringify(green.outcome));
      const passed = (green.outcome as { value: { verdict: string, record: { exitCode: number } } }).value;
      assert.equal(passed.verdict, 'green');
      assert.equal(passed.record.exitCode, 0);

      const spawnsAfterGreen = fixture.runner.spawns;
      const red = await gateOver(fixture, 'e-regress', 'regress-off-by-one');
      assert.equal(red.outcome.ok, true, 'a red gate happened; its outcome was red');
      const failed = (red.outcome as { value: { verdict: string, record: { exitCode: number, signal: null } } }).value;
      assert.equal(failed.verdict, 'red', 'a clean non-zero exit is the one thing that is red');
      assert.notEqual(failed.record.exitCode, 0);
      assert.equal(failed.record.signal, null, 'nothing killed it; it decided');
      assert.ok(fixture.runner.spawns > spawnsAfterGreen, 'the gate really ran');
    });
  });

  it('gives the flaky row exactly two legs: red, then green, and no third', async () => {
    await withEvolveRepository(async (fixture) => {
      const staged = await stageProposal(fixture, 'e-flaky', 'flaky-marker-file');

      const first = await gateOver(fixture, 'e-flaky', 'flaky-marker-file', 'gate', staged);
      const firstVerdict = (first.outcome as { value: { verdict: string } }).value.verdict;
      assert.equal(firstVerdict, 'red', 'the cold cache throws on the first import');
      assert.equal(earnsRerun(firstVerdict), true);

      // The marker the first leg wrote is what makes the second one green.
      const rerun = await gateOver(fixture, 'e-flaky', 'flaky-marker-file', 'gate-rerun', staged);
      const rerunVerdict = (rerun.outcome as { value: { verdict: string, record: { leg: string } } }).value;
      assert.equal(rerunVerdict.verdict, 'green', 'the warm cache passes');
      assert.equal(rerunVerdict.record.leg, 'gate-rerun', 'the record says which leg it was');

      // And the policy stops there: green earns nothing further.
      assert.equal(earnsRerun(rerunVerdict.verdict), false,
        'red-then-green is ambiguous, not an invitation to try again');
    });
  });

  it('kills a gate that will not finish, and calls it over-budget with no rerun', async () => {
    await withEvolveRepository(async (fixture) => {
      const killed = await gateOver(fixture, 'e-timeout', 'timeout-gate');
      assert.equal(killed.outcome.ok, true, JSON.stringify(killed.outcome));
      const verdict = (killed.outcome as { value: { verdict: string, record: { signal: string | null } } }).value;
      assert.equal(verdict.verdict, 'over-budget', 'a killed gate reached no verdict');
      assert.equal(earnsRerun(verdict.verdict), false, 'and so earns no rerun');
    }, { legMs: 1500 });
  });

  it('calls a flood over-budget rather than reading what it printed', async () => {
    await withEvolveRepository(async (fixture) => {
      const drowned = await gateOver(fixture, 'e-flood', 'output-flood');
      assert.equal(drowned.outcome.ok, true, JSON.stringify(drowned.outcome));
      const verdict = (drowned.outcome as { value: { verdict: string, record: { truncated: { stdout: boolean } } } }).value;
      assert.equal(verdict.verdict, 'over-budget');
      assert.equal(verdict.record.truncated.stdout, true, 'the truncation is reported, not hidden');
      assert.equal(earnsRerun(verdict.verdict), false);
    }, { stdoutBytes: 65536 });
  });

  it('walks the workspace after a green gate, because the runner only watches the pipes', async () => {
    await withEvolveRepository(async (fixture) => {
      const flooded = await gateOver(fixture, 'e-workspace', 'workspace-flood');
      assert.equal(flooded.outcome.ok, true, JSON.stringify(flooded.outcome));
      const verdict = (flooded.outcome as { value: { verdict: string, record: { exitCode: number } } }).value;
      assert.equal(verdict.record.exitCode, 0, 'the tests themselves passed');
      assert.equal(verdict.verdict, 'over-budget',
        'and the change still exceeded a budget, by writing rather than by printing');
    }, { legMs: 20000 });
  });
});

describe('what the gate keeps and what it never keeps', () => {
  it('captures stdout for a reviewer and puts it in no identity', async () => {
    await withEvolveRepository(async (fixture) => {
      const run = await gateOver(fixture, 'e-capture', 'noop-comment');
      const value = (run.outcome as { value: { stdout: string, record: EvolveGateResult } }).value;
      assert.ok(value.stdout.length > 0, 'the reviewer gets the text');

      // The record carries byte counts and an exit code — never the bytes.
      const serialized = JSON.stringify(value.record);
      for (const fragment of ['topK', 'pass ', '# tests']) {
        assert.equal(serialized.includes(fragment), false,
          'the gate record must not carry ' + fragment + ' from what the child printed');
      }
      assert.ok(!Object.hasOwn(value.record, 'stdout'), 'there is no stdout field to hash');
      assert.ok((value.record as { stdoutBytes: number }).stdoutBytes > 0, 'how much, not what');
    });
  });

  it('replays from the record without spawning the gate again', async () => {
    await withEvolveRepository(async (fixture) => {
      const staged = await stageProposal(fixture, 'e-replay', 'noop-comment');
      const first = await gateOver(fixture, 'e-replay', 'noop-comment', 'gate', staged);
      assert.equal((first.outcome as { value: { verdict: string } }).value.verdict, 'green');
      const spawns = fixture.runner.spawns;

      const again = await gateOver(fixture, 'e-replay', 'noop-comment', 'gate', staged);
      assert.equal(again.outcome.ok, true, JSON.stringify(again.outcome));
      const replayed = (again.outcome as { value: { verdict: string, record: { id: string } } }).value;
      assert.equal(replayed.verdict, 'green', 'the recorded verdict is the answer');
      assert.equal(fixture.runner.spawns, spawns, 'a replayed gate must not run the tests a second time');
      assert.equal(
        replayed.record.id,
        (first.outcome as { value: { record: { id: string } } }).value.record.id,
        'and it seals to the same identity');
    });
  });

  it('never writes into the fixture repository the registration pins', async () => {
    await withEvolveRepository(async (fixture) => {
      const registered = JSON.parse(await readFile(
        join(process.cwd(), 'benchmark/fixtures/evolve/manifest.json'), 'utf8')) as {
          fixture: { baseRevision: string },
        };
      await gateOver(fixture, 'e-pin', 'regress-off-by-one');

      const inspected = await fixture.host.inspect();
      assert.equal(inspected.ok, true, JSON.stringify(inspected));
      assert.equal((inspected as { value: { revision: string } }).value.revision,
        registered.fixture.baseRevision, 'the base is where the registration says it is');
      assert.equal((inspected as { value: { clean: boolean } }).value.clean, true);
    });
  });
});
