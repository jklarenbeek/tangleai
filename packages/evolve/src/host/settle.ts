/**
 * Settling: the one place a worktree dies, and the one place a branch survives.
 *
 * What happens to the workspace follows from the decision and from nothing
 * else, which is why the decision is taken first, by a pure planner, over
 * records. Three outcomes, three dispositions:
 *
 *  - `kept` — the worktree goes, the BRANCH STAYS. Nothing is merged,
 *    pushed, checked out or rebased, and no verb for doing any of those
 *    exists to call. A kept experiment is a branch and a review bundle
 *    addressed to a person; the campaign never lands its own work.
 *  - `abandoned` / `refused` — worktree and branch both go. The decision
 *    and its reason are the entire trace, because a loss that leaves
 *    debris behind is a loss nobody will clean up. There is no report, no
 *    retry and no escalation on this path: it is the common one.
 *  - `uncertain` — nothing is touched. An effect nobody can account for is
 *    not a licence to tidy up; the workspace and the branch stay exactly
 *    as they are so a person can see what actually happened.
 *
 * A removal or prune that fails is `TEVO1009` and visible. Swallowing it
 * would turn "the workspace may still exist" into a clean decision record,
 * which is the one lie this module could tell.
 *
 * Every disposition moves the experiment through the lifecycle table under
 * its compare-and-swap revision, so a second settle is a refused stale
 * transition rather than a second `worktree remove`.
 */

import { refuseOne, ok, type EvolveOutcome } from '../errors.ts';
import { sealRecord } from '../identity.ts';
import { planExperimentTransition, type ExperimentCommand } from '../transitions.ts';
import type { Decision, EvolveExperiment, EvolveReviewBundle } from '../contracts.gen.ts';
import type { PlannedDecision } from '../decide.ts';
import type { EvolveStore } from '../store.ts';
import type { WorktreeHost } from './worktree.ts';

/** What a settled decision does to the workspace. One table, no default. */
export interface Disposition {
  removeWorktree: boolean;
  deleteBranch: boolean;
  command: ExperimentCommand;
}

export function dispositionOf(decision: Decision): Disposition {
  switch (decision) {
    case 'kept':
      // The branch is the deliverable. Removing it would destroy the work.
      return { removeWorktree: true, deleteBranch: false, command: 'record' };
    case 'abandoned':
      return { removeWorktree: true, deleteBranch: true, command: 'abandon' };
    case 'refused':
      return { removeWorktree: true, deleteBranch: true, command: 'refuse' };
    case 'uncertain':
      // Touch nothing. A person reconciles.
      return { removeWorktree: false, deleteBranch: false, command: 'uncertain' };
  }
}

export interface ReviewBundleInput {
  gateResultIds: string[];
  measurementId: string;
  decisionId: string;
  runIdentityId: string;
  effectRecordIds: string[];
}

export interface SettleOptions {
  host: WorktreeHost;
  store: EvolveStore;
  experiment: EvolveExperiment;
  decision: PlannedDecision;
  /** Absent when nothing was ever isolated — a refusal before any worktree. */
  worktreePath?: string;
  /** Required to write a review bundle, which only a keep produces. */
  bundle?: ReviewBundleInput;
}

export interface SettleOutcome {
  experiment: EvolveExperiment;
  disposition: Disposition;
  worktreeRemoved: boolean;
  branchDeleted: boolean;
  reviewBundle: EvolveReviewBundle | null;
}

/**
 * The cleanup receipt, in the store's key table (first writer wins, an
 * identical write is a no-op). The intent is written BEFORE the swap and
 * names the revision and status the swap produces, the workspace's instance
 * token and whether the branch goes; completion is written once the workspace
 * is gone. Neither is a sealed record: the token differs per workspace, and the
 * sealed records stay byte-reproducible.
 */
export const CLEANUP_INTENT = 'cleanup-intent';
export const CLEANUP_DONE = 'cleanup-done';
export type CleanupIntent = { revision: number, status: string, token: string | null, deleteBranch: boolean };
const DONE = JSON.stringify({ outcome: 'completed' });

export async function settleExperiment(options: SettleOptions): Promise<EvolveOutcome<SettleOutcome>> {
  const { host, store, experiment, decision, worktreePath } = options;

  const disposition = dispositionOf(decision.decision);

  // The transition is planned before anything is removed, so an illegal
  // settle refuses without having already destroyed the evidence.
  const planned = planExperimentTransition(experiment.status, disposition.command);
  if (!planned.ok) return { ok: false, issues: [planned.issue] };

  let reviewBundle: EvolveReviewBundle | null = null;

  // The bundle is written BEFORE the worktree is removed: its diff digest
  // and head revision can only be read while the workspace still exists.
  if (decision.decision === 'kept') {
    if (worktreePath === undefined || options.bundle === undefined) {
      return refuseOne<SettleOutcome>('TEVO1010', '/bundle',
        'A kept experiment needs its workspace and its evidence to build a review bundle.');
    }
    const head = await host.head(worktreePath);
    if (!head.ok) return head as EvolveOutcome<SettleOutcome>;
    const diff = await host.diff(worktreePath, { against: experiment.baseRevision });
    if (!diff.ok) return diff as EvolveOutcome<SettleOutcome>;

    const sealed = await sealRecord<EvolveReviewBundle>({
      schemaVersion: 1,
      kind: 'review-bundle',
      experimentId: experiment.experimentId,
      branch: 'exp/' + experiment.experimentId,
      headRevision: head.value,
      diffDigest: diff.value.digest,
      diffBytes: diff.value.bytes,
      gateResultIds: options.bundle.gateResultIds,
      measurementId: options.bundle.measurementId,
      decisionId: options.bundle.decisionId,
      runIdentityId: options.bundle.runIdentityId,
      effectRecordIds: options.bundle.effectRecordIds,
    });
    if (!sealed.ok) return sealed as EvolveOutcome<SettleOutcome>;
    const written = await store.putRecord(sealed.value);
    if (!written.ok) return written as EvolveOutcome<SettleOutcome>;
    reviewBundle = sealed.value;
  }

  // The intent is durable before the swap: a crash anywhere after this leaves a
  // receipt `reconcileCleanups` can finish, fenced to this workspace instance.
  let present = false;
  if (disposition.removeWorktree && worktreePath !== undefined) {
    const instance = await host.instance(worktreePath);
    if (!instance.ok) return instance as EvolveOutcome<SettleOutcome>;
    present = instance.value.exists;
    const intent: CleanupIntent = { revision: experiment.revision + 1, status: planned.status, token: instance.value.token, deleteBranch: disposition.deleteBranch };
    const written = await store.putKey(CLEANUP_INTENT, experiment.experimentId, JSON.stringify(intent));
    // an earlier settle's receipt already stands (first writer wins); the swap below decides whether this one may go on
    if (!written.ok && written.issues[0]?.code !== 'TEVO1002') return written as EvolveOutcome<SettleOutcome>;
  }

  // The compare-and-swap comes BEFORE the removal, and that ordering is the
  // whole protection against settling twice: a second settle holding a
  // stale revision loses the swap and never reaches a `worktree remove`.
  // Reversing these two would let a repeated settle delete a workspace a
  // later run had already recreated.
  const moved = await store.transitionExperiment(
    experiment.experimentId, disposition.command, experiment.revision);
  if (!moved.ok) return moved as EvolveOutcome<SettleOutcome>;

  let worktreeRemoved = false;
  let branchDeleted = false;
  if (disposition.removeWorktree && worktreePath !== undefined) {
    if (present) {
      const removed = await host.remove(worktreePath, {
        deleteBranch: disposition.deleteBranch,
        experimentId: experiment.experimentId,
      });
      // TEVO1009 travels up unchanged: a workspace that may still exist is
      // uncertain, and uncertainty stops for a person (and the receipt waits for the reconciler).
      if (!removed.ok) return removed as EvolveOutcome<SettleOutcome>;
      worktreeRemoved = true;
      branchDeleted = disposition.deleteBranch;
    }
    else {
      // already gone (a crash after an earlier removal): finish what may remain, the metadata and the branch
      const finished = await host.finish({ experimentId: experiment.experimentId, deleteBranch: disposition.deleteBranch });
      if (!finished.ok) return finished as EvolveOutcome<SettleOutcome>;
      branchDeleted = finished.value.deletedBranch;
    }
    const done = await store.putKey(CLEANUP_DONE, experiment.experimentId, DONE);
    if (!done.ok) return done as EvolveOutcome<SettleOutcome>;
  }

  return ok({
    experiment: moved.value,
    disposition,
    worktreeRemoved,
    branchDeleted,
    reviewBundle,
  });
}

export interface ReconcileCleanupsOutcome {
  examined: number;
  completed: number;
  /** Receipts left for a person: the workspace at the path is another instance, or the experiment moved on. */
  refused: Array<{ experimentId: string, reason: 'recreated' | 'moved' }>;
}

/**
 * Finish every cleanup a settle recorded but did not complete, and only
 * that: the receipt is live while the experiment sits exactly at the revision
 * and status its swap produced (one that never swapped is a settle's to
 * redo), and the workspace is removed only when it is the instance the
 * receipt names; one recreated at the same path is refused and left as it is.
 * Each step is idempotent, so a crash between any two is finished by running
 * this again, and a completed receipt is never reapplied.
 */
export async function reconcileCleanups(options: { store: EvolveStore, host: WorktreeHost }): Promise<EvolveOutcome<ReconcileCleanupsOutcome>> {
  const { store, host } = options;
  const experiments = await store.listRecords({ kind: 'experiment' });
  if (!experiments.ok) return experiments as EvolveOutcome<ReconcileCleanupsOutcome>;
  const outcome: ReconcileCleanupsOutcome = { examined: 0, completed: 0, refused: [] };
  for (const record of experiments.value) {
    const experiment = record as EvolveExperiment;
    const intentText = await store.getKey(CLEANUP_INTENT, experiment.experimentId);
    if (!intentText.ok) return intentText as EvolveOutcome<ReconcileCleanupsOutcome>;
    if (intentText.value === null) continue;
    const done = await store.getKey(CLEANUP_DONE, experiment.experimentId);
    if (!done.ok) return done as EvolveOutcome<ReconcileCleanupsOutcome>;
    if (done.value !== null) continue;
    outcome.examined += 1;
    const intent = JSON.parse(intentText.value) as CleanupIntent;
    const held = await store.getExperiment(experiment.experimentId);
    if (!held.ok) return held as EvolveOutcome<ReconcileCleanupsOutcome>;
    const current = held.value;
    // the swap never happened: the settle that wrote this intent will settle again
    if (current === null || current.revision < intent.revision) continue;
    if (current.revision !== intent.revision || current.status !== intent.status) { outcome.refused.push({ experimentId: experiment.experimentId, reason: 'moved' }); continue; }
    const instance = await host.instance(host.pathOf(experiment.experimentId));
    if (!instance.ok) return instance as EvolveOutcome<ReconcileCleanupsOutcome>;
    if (instance.value.exists && instance.value.token !== intent.token) { outcome.refused.push({ experimentId: experiment.experimentId, reason: 'recreated' }); continue; }
    const finished = await host.finish({ experimentId: experiment.experimentId, deleteBranch: intent.deleteBranch });
    if (!finished.ok) return finished as EvolveOutcome<ReconcileCleanupsOutcome>;
    const written = await store.putKey(CLEANUP_DONE, experiment.experimentId, DONE);
    if (!written.ok) return written as EvolveOutcome<ReconcileCleanupsOutcome>;
    outcome.completed += 1;
  }
  return ok(outcome);
}
