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
export type {
  EffectDriverOptions, EffectPlan, EffectPlanLeg, EffectRunResult, EffectPreparation,
  EffectResources, FencedEffectStore, ExternalEffects, JobQueue,
} from './driver.ts';

export { createEvolveClassifier, createTranscript, sampleOf, SAMPLE_LEG } from './classify.ts';
export type { Transcript, LegTranscript, EvolveClassifierOptions } from './classify.ts';

export { runGate, readGateResult, gateVerdictOf, gatePlan, earnsRerun, GATE_COMMAND } from './gate.ts';
export type { GateLeg, GateOutcome, RunGateOptions, SettledLeg, GateDriver, GateEffectStore } from './gate.ts';

export {
  measureFitness, readMeasurement, sealBaseRoot, baseSealHolds, measurePlan,
  INSTRUMENT_COMMAND, BASE_INSTRUMENT_COMMAND,
} from './measure.ts';
export type { MeasureOptions, MeasureOutcome, MeasureSide, BaseSeal } from './measure.ts';

export { applyProposal, isolatePlan, commitPlan } from './apply.ts';
export type { ApplyOptions, ApplyOutcome } from './apply.ts';

export { settleExperiment, dispositionOf } from './settle.ts';
export type { SettleOptions, SettleOutcome, Disposition, ReviewBundleInput } from './settle.ts';

export { createEvolveEffectWorker, createEffectAddressing, EVOLVE_EFFECT_KIND } from './worker.ts';
export type {
  EvolveEffectJob, EvolveSettlementMessage, EvolveEffectWorkerOptions,
  WorkerDriver, WorkerInteractionStore, WorkerJobQueue, WorkerEffectReader, WorkerPass,
  EffectAddress, EffectAddressing, EffectAddressingOptions,
} from './worker.ts';

export {
  cancelExperiment, reconcileCancelledExperiments, reconcileStoppedExperiments, cancelDecision,
} from './cancel.ts';
export type {
  CancelOptions, CancelOutcome, CancelStore, ReconcileOptions, ReconcileOutcome,
  ReconcileStoppedOptions, StoppedRun,
} from './cancel.ts';
