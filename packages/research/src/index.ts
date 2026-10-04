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
export { ResearchFailure, researchValue, createResearchBinding, initialResearchFrame, researchProjectHash } from './workflow-contract.ts';
export type { ResearchWorkflowBinding, ResearchBindingOptions } from './workflow-contract.ts';
export { inputManifestOf, researchFrameInputs } from './manifest.ts';
export { RESEARCH_STAGES, RESEARCH_FRAME_SCHEMA, RESEARCH_RESPONSE_SCHEMA, createResearchRegistry,
  defineResearchWorkflow, prepareResearchWorkflow } from './workflow.ts';
export type { ResearchStageName, PreparedResearchWorkflow } from './workflow.ts';
export { gateReviewOf, checkResearchGate, gateResponseSchema, overdueGates, applyOverduePolicy } from './gates.ts';
export type { ResearchOverduePolicy, ResearchOverdueGate } from './gates.ts';
export { createResearchTaskHandlers, RESEARCH_FRAME_MEDIA_TYPE } from './handlers.ts';
export type { ResearchTaskTools, ResearchTaskHandlers, ResearchStageOperation, ResearchStageResult, ResearchStageAccess } from './handlers.ts';
export { createResearchHostBindings } from './host.ts';
export * from './adapters/index.ts';
export { createQueryPlan, discoveryRevisionOf, executeScholarlyDiscovery, createDiscoveryStageTools } from './stages/discovery.ts';
export type { ResearchDiscoveryOptions } from './stages/discovery.ts';
export { createInclusionCriteria, screenLiterature } from './stages/screening.ts';
export { acquireResearchSources } from './stages/acquire.ts';
export type { ResearchDocumentHost, ResearchAcquisitionLimits } from './stages/acquire.ts';
export { extractEvidenceCards, toAdmittedArtifact, resolveEvidenceCard } from './stages/cards.ts';
export { createResearchSynthesis } from './stages/synthesis.ts';
export { createResearchHypotheses } from './stages/hypothesis.ts';
export { createResearchDesign } from './stages/design.ts';
export type { ResearchDesignBounds } from './stages/design.ts';
export { researchArtifacts, createResearchDomainBinding, createResearchPatternHost, prepareResearchPattern } from './domain.ts';
export type { PreparedResearchPattern } from './domain.ts';
export { RESEARCH_PROMPT_NAMES, RESEARCH_PROMPT_VARIABLES, researchProposalSchema } from './prompt-contracts.ts';
export type { ResearchPromptName, ResearchPatternPurpose } from './prompt-contracts.ts';
export { createResearchNoveltyPlan, executeResearchNovelty } from './stages/novelty.ts';
export type { ResearchNoveltyPolicy } from './stages/novelty.ts';
export { createResearchReasoningTools } from './reasoning.ts';
export { researchReasoningRevisionOf } from './reasoning-contract.ts';
export type { ResearchReasoningPolicy } from './reasoning-contract.ts';
export { createResearchReadTools, RESEARCH_READ_TOOLS } from './tools.ts';
