/**
 * The Node-only host half.
 *
 * Deliberately NOT re-exported from the package root: the root import
 * stays browser-safe, and a consumer that wants to execute experiments
 * reaches for this subpath explicitly. That is also what lets a consumer
 * inject an executor rather than import one.
 */

export { createProcessRunner } from './runner.ts';
export type {
  ProcessRunner, ProcessRunnerOptions, AllowedCommand, RunnerEnv, RunnerLimits,
  RunnerRoots, RunRequest, RunResult, RunnerCwd,
} from './runner.ts';

export {
  validateGitArgs, neverWriteSet, refuseProtectedRef,
  isExperimentBranch, isPinnedRevision, EXPERIMENT_BRANCH, PINNED_REVISION,
} from './git-allow.ts';

export { createWorktreeHost } from './worktree.ts';
export type { WorktreeHost, WorktreeHostOptions, WorktreeStatus, ChangedPath } from './worktree.ts';

export { createEffectExecutor, classifyEffect, authorizeEffect, unresolvedRefusal } from './effects.ts';
export type { EffectRequest, EffectResponse, EffectExecutorOptions, DispatchContext, ClassifiedEffect, AuthorizeOptions } from './effects.ts';

export { createEffectDriver } from './driver.ts';
export type { EffectDriverOptions, EffectPlan, EffectPlanLeg, EffectRunResult, FencedEffectStore, ExternalEffects, JobQueue } from './driver.ts';
