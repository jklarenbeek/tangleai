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
    const removed = await host.remove(worktreePath, {
      deleteBranch: disposition.deleteBranch,
      experimentId: experiment.experimentId,
    });
    // TEVO1009 travels up unchanged: a workspace that may still exist is
    // uncertain, and uncertainty stops for a person.
    if (!removed.ok) return removed as EvolveOutcome<SettleOutcome>;
    worktreeRemoved = true;
    branchDeleted = disposition.deleteBranch;
  }

  return ok({
    experiment: moved.value,
    disposition,
    worktreeRemoved,
    branchDeleted,
    reviewBundle,
  });
}
