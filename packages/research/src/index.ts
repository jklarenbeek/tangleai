/** Research records, content identity and lifecycle contracts without host I/O. */
export type * from './contracts.gen.ts';
export { RESEARCH_ERRORS, researchIssue, researchRefuse, researchValidationIssues } from './errors.ts';
export type { ResearchCode, ResearchOutcome } from './errors.ts';
export { researchArtifactIdOf, researchRevisionOf, inputManifestHashOf, stageAttemptIdOf,
  artifactAdmissionIdOf, immutableResearchJson } from './identity.ts';
export { researchSchema, researchSchemaOf, validateResearchShape } from './schema.ts';
export type { ResearchSchemaName } from './schema.ts';
export type { ResearchRecordMap, ResearchRecordKind, ResearchRecordWrite, ResearchRecordEntry } from './records.ts';
export { RESEARCH_RECORD_KINDS } from './records.ts';
export { RESEARCH_EDGES, planProjectCreate, planStateTransition, planContractFreeze, planAmendment, planStageCommit } from './transitions.ts';
export type { ProjectCreatePlan, StateTransitionPlan, ContractFreezePlan, AmendmentPlan,
  StageCommitPlan, ResearchProjection, ResearchPreregistration } from './transitions.ts';
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
export { createResearchCommands, planHumanCommand, researchCommandResponse, interventionReport, researchInterventionReport, researchStatus } from './commands.ts';
export type { ResearchHumanCommandPlan } from './commands.ts';
export { createStagedArtifactRefiner } from './refiner.ts';
export type { ResearchStagedArtifactRefiner, ResearchStagedEditPreview } from './refiner.ts';
export { researchMode } from './modes.ts';
export type { ResearchMode } from './modes.ts';
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
export { RESEARCH_EXECUTION_LIMITS, RESEARCH_STOP_REASONS, isResearchWorkspacePath, createResearchWorkspace,
  validateResearchWorkspace, buildExecutionManifest, validateExecutionManifest } from './execution/manifest.ts';
export type { ResearchExecutionLimits, ResearchExecutionArtifact, ResearchWorkspace, ResearchWorkspaceFile,
  ResearchExecutionManifestInput } from './execution/manifest.ts';
export { RESEARCH_EXECUTOR_CONTRACT, RESEARCH_RAW_OUTPUT_PATH, researchExecutionResult, validateResearchExecutionResult,
  researchRawOutputBytes } from './execution/executor.ts';
export type { ResearchExecutor, ResearchExecutionContext, ResearchExecutionResult,
  ResearchExecutionSettlement } from './execution/executor.ts';
export { createFixtureExecutor } from './execution/fixture-executor.ts';
export type { ResearchFixtureProgram } from './execution/fixture-executor.ts';
export { createEvaluationRegistry, researchObservationSignature } from './execution/registry.ts';
export type { ResearchEvaluator, ResearchMetricValue, ResearchEvaluationInput } from './execution/registry.ts';
export { createResearchExecutionTools } from './stages/execute.ts';
export { researchExecutionRevisionOf } from './execution-contract.ts';
export type { ResearchExecutionPolicy } from './execution-contract.ts';
export { createRemoteResearchExecutor } from './execution/remote-executor.ts';
export { RESEARCH_RUNNER_WIRE_LIMITS, researchExecutionRequest, decodeResearchExecutionRequest, researchExecutionResponse } from './execution/wire.ts';
export { createResearchAnalysis, verifyResearchAnalysis } from './stages/analyze.ts';
export type { ResearchAnalysisInput } from './stages/analyze.ts';
export { researchAggregate } from './statistics.ts';
export type { ResearchPairedStatistic } from './statistics.ts';
export { selectBranch } from './selection.ts';
export type { ResearchBranchCandidate } from './selection.ts';
export { planResearchDecision, validateResearchDecision } from './stages/decide.ts';
export type { ResearchDecisionLedger, ResearchDecisionBudget, ResearchResultReview } from './stages/decide.ts';
export { planResearchReplication } from './stages/replicate.ts';
export { researchAnalysisRevisionOf } from './analysis-contract.ts';
export type { ResearchAnalysisRuntimePolicy } from './analysis-contract.ts';
export { createResearchAnalysisTools } from './analysis.ts';
export { buildClaimLedger, validateResearchWritingInputs, RESEARCH_DRAFT_SECTIONS } from './stages/claims.ts';
export { writeResearchDraft, researchDraftProposal } from './stages/write.ts';
export { verifyResearchDraft } from './stages/verify.ts';
export { renderMetricTable, renderResearchDraft, researchMarkdownSectionIds } from './render.ts';
export { renderMarkdownBundle, rerunBundle, verifyResearchBundleFiles } from './export/markdown.ts';
export type { ResearchMarkdownBundle } from './export/markdown.ts';
export { researchDisclosure, researchWritingEvidenceHash, researchFileHash, RESEARCH_BUNDLE_FILES } from './export/manifest.ts';
export type { ResearchExportSource } from './export/manifest.ts';
export { renderLatexBundle } from './export/latex.ts';
export { createResearchReviews } from './stages/review.ts';
export type { ResearchReviewProposal, ResearchReviewAssessment } from './stages/review.ts';
export { createResearchWritingTools } from './writing.ts';
export { researchWritingRevisionOf, researchWritingRole, RESEARCH_WRITING_CALLS } from './writing-contract.ts';
export type { ResearchWritingPolicy } from './writing-contract.ts';
export { createResearchWritingContextProvider } from './writing-workflow.ts';
