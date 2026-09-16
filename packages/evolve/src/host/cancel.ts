/**
 * Cancelling an experiment, and cleaning up after one.
 *
 * Cancel is a HOST CALL and deliberately not a contract operation. The
 * contract this package publishes is read-only: there is no operation
 * that merges, promotes, approves, runs or stops an experiment, and none
 * can be added without a breaking contract diff. An operator cancels
 * through the host they already run.
 *
 * The cleanup cannot live in a workflow node. A cancelled run executes no
 * further segment, so a "cleanup" node would simply never fire and the
 * worktree would survive the cancel — the exact failure the cancel exists
 * to prevent. It is a reconciler instead, driven over cancelled runs, and
 * idempotent through the experiment's own compare-and-swap transition.
 *
 * The decision vocabulary has no `cancelled` reason, and it is not given
 * one here. An operator cancel is `abandoned` / `command` / `TEVO1006`,
 * and an expiry is `abandoned` / `over-budget` / `TEVO1005` against the
 * registered `experimentMs`. Both are honest in the existing vocabulary;
 * inventing an eleventh reason would widen a closed set that a schema,
 * a census and a planner all depend on being closed. Which of the two it
 * was, and who asked, lives in the run trace and the cited record — never
 * on the decision, which has no member for it.
 */

import { refuseOne, ok, type EvolveOutcome } from '../errors.ts';
import type { EnvelopeDecision } from '../lifecycle/state.ts';

/** The MAS store members cancellation touches. Injected, never imported. */
export interface CancelStore {
  getInteraction(id: string): Promise<{ revision: number, status: string } | undefined>;
  resolveInteraction(
    id: string, status: 'cancelled' | 'expired', expectedRevision: number,
  ): Promise<unknown>;
  transitionRun(runId: string, command: { kind: string }): Promise<unknown>;
  getRun(runId: string): Promise<{ id: string, status: string } | undefined>;
}

export interface CancelOptions {
  store: CancelStore;
  runId: string;
  /** The wait the run is parked on, if it is parked on one. */
  interactionPath: string | null;
  interactionIdOf: (runId: string, path: string) => string;
  /** Who asked. Recorded in the run trace, never on the decision. */
  principalId: string;
  /** `cancelled` for an operator; `expired` when a deadline fired. */
  as?: 'cancelled' | 'expired';
}

export interface CancelOutcome {
  runId: string;
  /** What the experiment's decision must become when it is settled. */
  decision: EnvelopeDecision;
  /** Whether a waiting interaction was actually resolved by this call. */
  resolvedInteraction: boolean;
}

/**
 * The decision a cancel or an expiry settles to.
 *
 * Exported because the reconciler and the tests must agree on it exactly,
 * and because it is the one place the "no cancelled reason" rule is
 * written down as code rather than as prose.
 */
export function cancelDecision(as: 'cancelled' | 'expired'): EnvelopeDecision {
  return as === 'expired'
    ? { decision: 'abandoned', reason: 'over-budget', code: 'TEVO1005' }
    : { decision: 'abandoned', reason: 'command', code: 'TEVO1006' };
}

/** Stop a waiting experiment. Does not clean up — the reconciler does. */
export async function cancelExperiment(options: CancelOptions): Promise<EvolveOutcome<CancelOutcome>> {
  const { store, runId, interactionIdOf } = options;
  const as = options.as ?? 'cancelled';

  const run = await store.getRun(runId);
  if (run === undefined) {
    return refuseOne<CancelOutcome>('TEVO1010', '/runId', 'No such experiment run.');
  }

  let resolvedInteraction = false;
  if (options.interactionPath !== null) {
    const id = interactionIdOf(runId, options.interactionPath);
    const waiting = await store.getInteraction(id);
    // A resolved interaction accepts nothing further. That is not an
    // error here: the worker may have answered between the operator
    // deciding and this call arriving, and the run cancel still stands.
    if (waiting !== undefined && waiting.status === 'waiting') {
      await store.resolveInteraction(id, as, waiting.revision);
      resolvedInteraction = true;
    }
  }

  await store.transitionRun(runId, { kind: 'cancel' });
  return ok({ runId, decision: cancelDecision(as), resolvedInteraction });
}

/** What a reconciliation pass did. Zero on the second pass, by design. */
export interface ReconcileOutcome {
  examined: number;
  settled: number;
}

/** A run that has stopped, and the decision its experiment settles to. */
export interface StoppedRun {
  runId: string;
  experimentId: string;
  decision: EnvelopeDecision;
}

export interface ReconcileStoppedOptions {
  /** Runs that have stopped and may still hold a worktree. */
  stoppedRuns: () => Promise<StoppedRun[]>;
  /** Whether this experiment still needs settling. False once terminal. */
  needsSettling: (experimentId: string) => Promise<boolean>;
  /** Remove the worktree, delete the branch, record the decision. */
  settle: (input: { experimentId: string, decision: EnvelopeDecision }) => Promise<EvolveOutcome<unknown>>;
}

/**
 * Settle every stopped experiment that still holds anything.
 *
 * This is the ONLY path that removes a workspace, and it is a reconciler
 * rather than a stage for a reason that applies to both ways a run can
 * stop. A cancelled run executes no further segment, so a cleanup node
 * would never fire. A completed run executes no further segment either —
 * and settling spawns git, which a segment may not do. Both therefore
 * settle from outside, over runs that have already stopped.
 *
 * Idempotent through `needsSettling`, which reads the experiment's own
 * status: once the experiment is terminal the second pass examines the
 * same runs and settles none. That is the two-run/no-change surface.
 */
export async function reconcileStoppedExperiments(
  options: ReconcileStoppedOptions,
): Promise<ReconcileOutcome> {
  const runs = await options.stoppedRuns();
  let settled = 0;

  for (const run of runs) {
    if (!await options.needsSettling(run.experimentId)) continue;
    const done = await options.settle({
      experimentId: run.experimentId,
      decision: run.decision,
    });
    if (done.ok) settled += 1;
  }

  return { examined: runs.length, settled };
}

export interface ReconcileOptions {
  /** Runs that were cancelled or expired and may still hold a worktree. */
  cancelledRuns: () => Promise<Array<{ runId: string, experimentId: string, as: 'cancelled' | 'expired' }>>;
  /** Whether this experiment still needs settling. False once terminal. */
  needsSettling: (experimentId: string) => Promise<boolean>;
  /** Remove the worktree, delete the branch, record the decision. */
  settle: (input: { experimentId: string, decision: EnvelopeDecision }) => Promise<EvolveOutcome<unknown>>;
}

/**
 * Settle every cancelled experiment that still holds anything.
 *
 * The cancelled case of `reconcileStoppedExperiments`, with the one thing
 * that is specific to it applied here: a cancel settles to the decision
 * `cancelDecision` names, and nothing else may name it.
 */
export async function reconcileCancelledExperiments(
  options: ReconcileOptions,
): Promise<ReconcileOutcome> {
  return reconcileStoppedExperiments({
    stoppedRuns: async () => (await options.cancelledRuns()).map(run => ({
      runId: run.runId,
      experimentId: run.experimentId,
      decision: cancelDecision(run.as),
    })),
    needsSettling: options.needsSettling,
    settle: options.settle,
  });
}
