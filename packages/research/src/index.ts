/** Research records, content identity and lifecycle contracts without host I/O. */
export type * from './contracts.gen.ts';
export { RESEARCH_ERRORS, researchIssue, researchRefuse, researchValidationIssues } from './errors.ts';
export type { ResearchCode, ResearchOutcome } from './errors.ts';
export { researchArtifactIdOf, researchRevisionOf, inputManifestHashOf, stageAttemptIdOf,
  artifactAdmissionIdOf, immutableResearchJson } from './identity.ts';
export { researchSchema, researchSchemaOf, validateResearchShape } from './schema.ts';
export type { ResearchSchemaName } from './schema.ts';
export type { ResearchRecordMap, ResearchRecordKind, ResearchRecordWrite, ResearchRecordEntry } from './records.ts';
export { RESEARCH_EDGES, planProjectCreate, planStateTransition, planContractFreeze, planAmendment, planStageCommit } from './transitions.ts';
export type { ProjectCreatePlan, StateTransitionPlan, ContractFreezePlan, AmendmentPlan,
  StageCommitPlan, ResearchProjection } from './transitions.ts';
export { createMemoryResearchStore, createMemoryResearchPersistence, createResearchStoreAdapter } from './store.ts';
export type { ResearchStore, ResearchStoreOutcome, ResearchSnapshot, ResearchTables, ResearchTable,
  ResearchTransaction, ResearchPersistence, ResearchPhysicalRow, ResearchMemoryState, ResearchMemoryOptions } from './store.ts';
