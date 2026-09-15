/**
 * Contracts and pure policy for repository experiments.
 *
 * Nothing here reaches a process, a file or a clock: the root import is
 * zero-I/O and browser-safe, and the host half lives behind its own
 * Node-only subpath. That split is what lets a consumer inject an
 * executor instead of importing one.
 */

export { EVOLVE_CODES, evolveIssue, sortEvolveIssues, refuse, refuseOne, ok } from './errors.ts';
export type { EvolveCode, EvolveIssue, EvolveOutcome } from './errors.ts';

export { evolveSchema, checkShape, checkRecordShape } from './schema.ts';

export { evolveRevision, recordIdOf, validateRecord, sealRecord, experimentKey } from './identity.ts';

export {
  planExperimentTransition, isTerminalStatus,
  EXPERIMENT_STATUSES, EXPERIMENT_COMMANDS, TERMINAL_STATUSES,
} from './transitions.ts';
export type { ExperimentCommand, ExperimentTransition } from './transitions.ts';

export { assertAuthority, checkPrincipal, AUTOMATION_PRINCIPAL, EVOLVE_ACTIONS } from './authority.ts';
export type { EvolveAction } from './authority.ts';

export { checkBudgets, checkBudget, DEFAULT_EVOLVE_BUDGETS, BUDGET_NAMES } from './budgets.ts';
export type { BudgetName } from './budgets.ts';

export { createMemoryEvolveStore, planExperimentWrite, recordExperimentId } from './store.ts';
export type { EvolveStore, ListQuery, StoredRecord, WriteReceipt } from './store.ts';

export { createStrategyLibrary } from './strategy.ts';
export type { StrategyLibrary, StrategyLedger, StrategyMemoryStore, StrategyRegistration, StrategyCarrier } from './strategy.ts';

export { loadProposal, operationPath, patchIdOf, patchBytes, decodePointerSegment, EVOLVE_PROPOSAL_SCHEMA } from './proposal.ts';
export type { EvolveProposalInput, ProposalOperation, PatchOp } from './proposal.ts';

export { compileSurfacePolicy, policyFromRepository } from './policy.ts';
export type { SurfacePolicy, SurfacePolicyInput, SurfaceStatus, FileMap } from './policy.ts';

export { planExperimentDecision, DECISION_INPUT_SPACE } from './decide.ts';
export type { DecisionInput, PlannedDecision, GateVerdict, FitnessVerdict } from './decide.ts';

export { parseSample, summarize, compareFitness, collectSamples } from './fitness.ts';
export type { Sample, SampleSet, Comparison, CompareInput, FitnessComparison } from './fitness.ts';

export { createPatchRefiner } from './patch.ts';
export type { PatchRefinerOptions, PreparedPatch, WritePlan } from './patch.ts';

export { EVOLVE_EXECUTOR_MANIFEST } from './manifest.ts';
export type { EvolveExecutorManifest } from './manifest.ts';

export type * from './contracts.gen.ts';

export {
  recordExperimentOutcome, resolveEvolveEvidence, createSourceRegistry, outcomeChronology,
} from './outcome-binding.ts';
export type {
  RecordOutcomeOptions, RecordedOutcome, OutcomeServiceLike, OutcomeResult,
  SourceRegistry, EvolveRecordReader, EvolveEvidenceSource,
} from './outcome-binding.ts';

export { createStrategyRefiner, evidenceOperation, STRATEGY_EVIDENCE_PATH } from './strategy-refiner.ts';
export type {
  StrategyRefinerOptions, RefinableLedger, LedgerSnapshot, EvidenceOperation, AppendEvidenceInput,
} from './strategy-refiner.ts';
