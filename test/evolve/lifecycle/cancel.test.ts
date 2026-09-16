/**
 * Cancellation, expiry, and the reconciler that cleans up after both.
 *
 * The rule under test is the one that is easy to get wrong: a cancelled
 * run executes no further segment, so cleanup CANNOT be a node. If it
 * were, the worktree would outlive the cancel and the branch would stay.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  cancelExperiment, reconcileCancelledExperiments, cancelDecision,
} from '@tangleai/evolve/host';
import { ok } from '@tangleai/evolve';

const interactionIdOf = (runId: string, path: string) => `${runId}:i:${path}`;

function storeRig(interactionStatus = 'waiting') {
  const calls: string[] = [];
  return {
    calls,
    getRun: async (id: string) => ({ id, status: 'waiting_for_input' }),
    getInteraction: async () => ({ revision: 4, status: interactionStatus }),
    resolveInteraction: async (id: string, status: string, revision: number) => {
      calls.push(`resolve:${id}:${status}:${revision}`);
      return { ok: true };
    },
    transitionRun: async (runId: string, command: { kind: string }) => {
      calls.push(`run:${runId}:${command.kind}`);
      return { ok: true };
    },
  };
}

describe('cancelling a waiting experiment', () => {
  it('resolves the wait and cancels the run', async () => {
    const store = storeRig();
    const done = await cancelExperiment({
      store, runId: 'run-1', interactionPath: 'await-gate',
      interactionIdOf, principalId: 'operator-1',
    });

    assert.ok(done.ok);
    assert.deepEqual(store.calls, [
      'resolve:run-1:i:await-gate:cancelled:4',
      'run:run-1:cancel',
    ]);
    assert.equal(done.value.resolvedInteraction, true);
  });

  it('records a cancel inside the existing vocabulary, not a new reason', async () => {
    const store = storeRig();
    const done = await cancelExperiment({
      store, runId: 'run-2', interactionPath: 'await-gate',
      interactionIdOf, principalId: 'operator-1',
    });
    assert.ok(done.ok);
    // There is no `cancelled` reason, and adding one would widen a closed
    // set a schema, a census and a planner all depend on.
    assert.deepEqual(done.value.decision,
      { decision: 'abandoned', reason: 'command', code: 'TEVO1006' });
  });

  it('records an expiry against the registered ceiling', () => {
    assert.deepEqual(cancelDecision('expired'),
      { decision: 'abandoned', reason: 'over-budget', code: 'TEVO1005' });
  });

  it('still cancels the run when the worker answered first', async () => {
    // The race is real: a worker can settle between the operator deciding
    // and the cancel arriving. A resolved interaction accepts nothing
    // further, and that is not an error.
    const store = storeRig('responded');
    const done = await cancelExperiment({
      store, runId: 'run-3', interactionPath: 'await-gate',
      interactionIdOf, principalId: 'operator-1',
    });
    assert.ok(done.ok);
    assert.equal(done.value.resolvedInteraction, false);
    assert.deepEqual(store.calls, ['run:run-3:cancel'], 'the run is still cancelled');
  });

  it('refuses a run it cannot find rather than inventing one', async () => {
    const store = { ...storeRig(), getRun: async () => undefined };
    const done = await cancelExperiment({
      store, runId: 'nope', interactionPath: null,
      interactionIdOf, principalId: 'operator-1',
    });
    assert.equal(done.ok, false);
    assert.equal((done as { issues: Array<{ code: string }> }).issues[0].code, 'TEVO1010');
  });
});

describe('reconciling what a cancel left behind', () => {
  function reconcileRig(terminal = new Set<string>()) {
    const settled: string[] = [];
    return {
      settled, terminal,
      cancelledRuns: async () => [
        { runId: 'run-a', experimentId: 'exp-a', as: 'cancelled' as const },
        { runId: 'run-b', experimentId: 'exp-b', as: 'expired' as const },
      ],
      needsSettling: async (id: string) => !terminal.has(id),
      settle: async (input: { experimentId: string }) => {
        settled.push(input.experimentId);
        terminal.add(input.experimentId);
        return ok(true);
      },
    };
  }

  it('settles every cancelled experiment that still holds something', async () => {
    const rig = reconcileRig();
    const pass = await reconcileCancelledExperiments(rig);
    assert.deepEqual(pass, { examined: 2, settled: 2 });
    assert.deepEqual(rig.settled, ['exp-a', 'exp-b']);
  });

  it('settles zero on the second pass — the two-run surface', async () => {
    const rig = reconcileRig();
    await reconcileCancelledExperiments(rig);
    const second = await reconcileCancelledExperiments(rig);
    assert.deepEqual(second, { examined: 2, settled: 0 },
      'it examines the same runs and writes nothing');
  });

  it('carries the reason each run was stopped for', async () => {
    const decisions: Array<{ experimentId: string, reason: string }> = [];
    await reconcileCancelledExperiments({
      cancelledRuns: async () => [
        { runId: 'run-a', experimentId: 'exp-a', as: 'cancelled' },
        { runId: 'run-b', experimentId: 'exp-b', as: 'expired' },
      ],
      needsSettling: async () => true,
      settle: async (input) => {
        decisions.push({ experimentId: input.experimentId, reason: input.decision.reason });
        return ok(true);
      },
    });
    assert.deepEqual(decisions, [
      { experimentId: 'exp-a', reason: 'command' },
      { experimentId: 'exp-b', reason: 'over-budget' },
    ]);
  });
});
