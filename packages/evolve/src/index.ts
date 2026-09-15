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

export { EVOLVE_EXECUTOR_MANIFEST } from './manifest.ts';
export type { EvolveExecutorManifest } from './manifest.ts';

export type * from './contracts.gen.ts';
