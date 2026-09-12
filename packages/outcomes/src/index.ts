/** Evidenced decision records and atomic, host-injected persistence. */
export { outcomesSchema, DEFAULT_OUTCOME_POLICY } from './schema.ts';
export { scopeIdOf, recordIdOf, validateRecord, outcomeRevision } from './identity.ts';
export { createMemoryOutcomeStore, createOutcomeStoreAdapter } from './store.ts';
export type { OutcomeStore, OutcomePersistence, OutcomeTransaction, Tables, Query, MemoryOutcomeStoreOptions } from './store.ts';
export type { OutcomeAdapter, EvidenceResolver, EvaluationSlot, OutcomeHost, OutcomePrincipal, OutcomeProposer } from './adapters.ts';
export type { OutcomeResult, OutcomeIssue } from './errors.ts';
export { EMPTY_HEAD, planHeadTransition, assertCapacity, planPromotion, eligibilityIssues } from './transitions.ts';
export type * from './outcomes.contracts.gen.ts';
export { createOutcomeService } from './service.ts';
export type { OutcomeService, OutcomeServiceOptions } from './service.ts';
export { changedLeafPaths, preparePayload } from './refinement.ts';
export { outcomeGatePolicyId, RETROSPECTIVE_RULES } from './evaluation.ts';
export { createOutcomeContract, outcomeContractDocument, createOutcomeHandlers, OUTCOME_MODEL_OPERATIONS } from './contract.ts';
export type { OutcomeHandlerOptions, OutcomeHandlerBinding } from './handlers.ts';
