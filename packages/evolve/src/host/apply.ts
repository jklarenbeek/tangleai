/**
 * Isolation and application: the two fenced stages that turn an accepted
 * write plan into a committed candidate revision.
 *
 * They are two operations rather than one because something happens
 * between them. Once the files are written, git can be asked what actually
 * changed — and git's staged view knows things the file map does not: that
 * a write landed as a rename, that a path is a symlink, that a mode moved.
 * The surface policy gets its SECOND look there, over git's answer rather
 * than over the proposal's own account of itself, and a proposal that
 * passed the first look and fails the second never reaches a commit.
 *
 * Each stage is prepared under its own semantic id, so a run that died
 * between writing and committing resumes by reading what it already did
 * instead of creating a second worktree on a branch that exists.
 *
 * Nothing here decides anything. A refusal travels up as a refusal, and
 * the caller settles it — which is the only place a worktree dies.
 */

import { refuseOne, ok, type EvolveOutcome } from '../errors.ts';
import type { WritePlan } from '../patch.ts';
import type { FileMap } from '../policy.ts';
import type { EffectPlan } from './driver.ts';
import type { WorktreeHost, WorktreeStatus } from './worktree.ts';
import type { GateDriver } from './gate.ts';

export interface ApplyOptions {
  driver: GateDriver;
  host: WorktreeHost;
  experimentId: string;
  baseRevision: string;
  /** Where the worktree will be. Deterministic, so a replay names the same one. */
  worktreePath: string;
  plan: WritePlan;
  message: string;
  /**
   * The surface policy's second look, over git's staged view. A refusal
   * here stops the candidate before it is committed.
   */
  verify?: (previous: FileMap, next: FileMap, status: WorktreeStatus) => EvolveOutcome<true>;
  /** The base file map the first look was taken against. */
  baseFiles?: FileMap;
}

export interface ApplyOutcome {
  worktreePath: string;
  branch: string;
  /** The candidate revision — this order's only mechanical input. */
  revision: string;
  effectRecordIds: string[];
}

/** Create the worktree and write the accepted plan into it. */
export function isolatePlan(options: {
  experimentId: string, baseRevision: string, worktreePath: string, plan: WritePlan,
}): EffectPlan {
  const id = options.experimentId + '/isolate';
  const files: Record<string, string | null> = {};
  for (const write of options.plan.writes) files[write.path] = write.text;
  for (const path of options.plan.removes) files[path] = null;

  return {
    id,
    jobId: id,
    kind: 'evolve-effect',
    actor: 'evolve-automation',
    reason: 'isolate',
    hashVersion: '1',
    legs: [
      {
        id: 'create',
        request: {
          safety: 'single-send',
          worktree: { op: 'create', input: { experimentId: options.experimentId, baseRevision: options.baseRevision } },
        },
        maxAttempts: 1,
      },
      {
        id: 'write-files',
        request: {
          safety: 'single-send',
          worktree: { op: 'write-files', input: { path: options.worktreePath, plan: files } },
        },
        maxAttempts: 1,
      },
    ],
  };
}

/** Commit what was written, on the experiment's own branch. */
export function commitPlan(options: {
  experimentId: string, worktreePath: string, message: string,
}): EffectPlan {
  const id = options.experimentId + '/apply';
  return {
    id,
    jobId: id,
    kind: 'evolve-effect',
    actor: 'evolve-automation',
    reason: 'apply',
    hashVersion: '1',
    legs: [{
      id: 'commit',
      request: {
        safety: 'single-send',
        worktree: {
          op: 'commit',
          input: { path: options.worktreePath, experimentId: options.experimentId, message: options.message },
        },
      },
      maxAttempts: 1,
    }],
  };
}

export async function applyProposal(options: ApplyOptions): Promise<EvolveOutcome<ApplyOutcome>> {
  const { driver, host, experimentId, baseRevision, worktreePath, plan, message } = options;

  const isolate = isolatePlan({ experimentId, baseRevision, worktreePath, plan });
  const isolated = await driver.run(isolate);
  if (!isolated.ok) return isolated as EvolveOutcome<ApplyOutcome>;
  // A worktree operation that answered a refusal settles as a rejected leg;
  // the plan "completed" and the experiment still has no workspace.
  const isolateRejected = isolated.value.legs.find(leg => leg.state !== 'confirmed');
  if (isolateRejected !== undefined) {
    return refuseOne<ApplyOutcome>('TEVO1003', '/legs/' + isolateRejected.id,
      'Isolating the experiment did not succeed at ' + isolateRejected.id + '.');
  }

  // The second look, over what git says changed rather than over what the
  // proposal said it would change.
  if (options.verify !== undefined) {
    const status = await host.status(worktreePath);
    if (!status.ok) return status as EvolveOutcome<ApplyOutcome>;
    const next = await host.fileMap(worktreePath);
    if (!next.ok) return next as EvolveOutcome<ApplyOutcome>;
    const verified = options.verify(options.baseFiles ?? {}, next.value.files, status.value);
    if (!verified.ok) return verified as EvolveOutcome<ApplyOutcome>;
  }

  const applied = await driver.run(commitPlan({ experimentId, worktreePath, message }));
  if (!applied.ok) return applied as EvolveOutcome<ApplyOutcome>;
  const commitRejected = applied.value.legs.find(leg => leg.state !== 'confirmed');
  if (commitRejected !== undefined) {
    return refuseOne<ApplyOutcome>('TEVO1003', '/legs/' + commitRejected.id,
      'Committing the candidate did not succeed.');
  }

  // HEAD is read back rather than remembered: the commit leg records that
  // it happened, not what it produced.
  const revision = await host.head(worktreePath);
  if (!revision.ok) return revision as EvolveOutcome<ApplyOutcome>;

  return ok({
    worktreePath,
    branch: 'exp/' + experimentId,
    revision: revision.value,
    effectRecordIds: [isolate.id, experimentId + '/apply'],
  });
}
