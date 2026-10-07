/** Credential-free experiential records and synchronous content validation. */
export type * from './contracts.gen.ts';
export { EXPERIENTIAL_ISSUE_CODES, experientialIssue, refuseExperiential, sortExperientialIssues } from './errors.ts';
export type { ExperientialIssueCode, ExperientialResult } from './errors.ts';
export { experientialSchema, EXPERIENTIAL_RECORD_SCHEMAS, validateExperientialRecord } from './schema.ts';
export type { ExperientialRecordKind, ExperientialRecordMap } from './schema.ts';
export { experientialRevisionOf, experientialHeadKey, experientialRecordId, checkExperientialRecord, sealExperientialRecord } from './identity.ts';
export { EXPERIENCE_TRANSITIONS, TRAINING_TRANSITIONS, ARTIFACT_TRANSITIONS, planExperienceTransition,
  planTrainingTransition, planArtifactTransition, planExperientialActivation, planExperientialRollback } from './lifecycle.ts';
export type { ExperientialStateKind, ExperientialTransitionPlan, ExperientialActivationInput, ExperientialActivationPlan } from './lifecycle.ts';
export { EXPERIENTIAL_TABLE_KINDS, EXPERIENTIAL_TABLES } from './store-types.ts';
export type { ExperientialTable, ExperientialTables, ExperientialTransaction, ExperientialPersistence,
  ExperientialStoreResult, ExperientialWrite, ExperientialStoreStats, ExperientialStore, ExperientialSnapshot } from './store-types.ts';
export { createExperientialStoreAdapter, createExperientialMemoryStore } from './store.ts';
export type { ExperientialStoreOptions } from './store.ts';
export { createExperientialMemoryPersistence } from './persistence-memory.ts';
export type { ExperientialMemoryState, ExperientialMemoryOptions, ExperientialMemoryPersistence } from './persistence-memory.ts';
export { resolveExperientialLineage } from './lineage.ts';
export type { ExperientialLineage } from './lineage.ts';
export { taintOf } from './trust.ts';
export type { ExperientialTaint } from './trust.ts';
export { EXPERIENTIAL_EXCLUSION_REASONS, sealExperientialSelectionPolicy, planExperientialSelection } from './selection.ts';
export type { ExperientialSelectionInput, ExperientialSelectionPlan } from './selection.ts';
export { EXPERIENTIAL_EXAMPLE_TEMPLATE, experientialDatasetManifest, checkExperientialDataset, planExperientialDataset, renderExperientialExamples } from './dataset.ts';
export type { ExperientialDatasetOptions, ExperientialDatasetPlan } from './dataset.ts';
export { validateTrainingSpec, trainingSpecDigest, checkTrainingCapabilities, experientialArtifactChecksum, verifyArtifactReceipt } from './backend.ts';
export type { TrainingBackend, BackendResult, VerifyArtifactReceiptOptions, VerifiedArtifactReceipt } from './backend.ts';
export { createFakeTrainingBackend } from './backend-fake.ts';
export type { FakeTrainingBackendOptions, FakeTrainingBackend } from './backend-fake.ts';

export { initialTrainingProgress, planExperientialTrainingUpdate, checkTrainingBindings, trainingTerminal, type ExperientialTrainingUpdate } from './training.ts';
export { EXPERIENTIAL_TRAINING_DAG, EXPERIENTIAL_TRAINING_NODES, experientialTrainingRevision, experientialTrainingJobKind, planExperientialTraining, createExperientialTrainingTasks, cancelExperientialTraining, ExperientialTrainingPending, ExperientialSubmissionUnknown, type ExperientialTrainingNode, type ExperientialTrainingInput, type ExperientialTrainingPlan, type ExperientialTrainingContext } from './pipeline.ts';

export { createHttpTrainingBackend } from './backend-http.ts';
export type { HttpTrainingBackend, HttpTrainingBackendOptions, HttpTrainingBudget, HttpTrainingStats } from './backend-http.ts';
export { readTrainingEnv, trainingServiceBase } from './training-env.ts';
export type { TrainingEnvironment, TrainingEnvironmentPlan } from './training-env.ts';
export { evaluateExperientialGates, reviseGatePolicy, EXPERIENTIAL_EVALUATION_ROWS, EXPERIENTIAL_RETENTION_LANES } from './gates.ts';
export type { ExperientialGateResult, ExperientialGatePolicyRevisionOptions } from './gates.ts';
export { planExperientialEvaluation, createExperientialEvaluation, recordExperientialEvaluation, evaluationMetricsOf } from './evaluation.ts';
export type { ExperientialEvaluationInput, ExperientialEvaluationPlan, ExperientialEvaluationResultPlan } from './evaluation.ts';
export { experientialEvaluationRegistrationId } from './identity.ts';

export { createExperientialDeployment, experientialBaseDigest, planAutomaticRollback } from './deployment.ts';
export type { ExperientialDeploymentInput } from './deployment.ts';
export { canaryShareOf, routesToCanary } from './canary.ts';
export { resolveExperientialInference, startExperientialInference } from './inference.ts';
export type { ExperientialInferenceInput, ExperientialResolvedInference, ExperientialInferenceBinding, ExperientialInferenceHostInput } from './inference.ts';
export type { ExperientialRollbackInput } from './lifecycle.ts';

export { createExperientialRunner, sealExperientialTriggerPolicy, DEFAULT_EXPERIENTIAL_TRIGGER_POLICY,
  EXPERIENTIAL_TRIGGER_NOOP_REASONS } from './policy.ts';
export type { ExperientialTriggerAdmission, ExperientialTriggerOutcome, ExperientialTriggerReservation,
  ExperientialTriggerCounts, ExperientialTrainingJobs } from './policy.ts';
export { planExperientialRetention, sealExperientialRetentionPolicy } from './retention.ts';
export type { ExperientialRetentionInput, ExperientialRetentionLineage, ExperientialRetentionPlan } from './retention.ts';
export { experientialContractDocument, createExperientialContract, createExperientialHandlers, createExperientialOperations } from './contract.ts';
export type { ExperientialOperations } from './contract.ts';
export { redactExperientialView } from './redact.ts';
