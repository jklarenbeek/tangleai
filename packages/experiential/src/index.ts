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
  ExperientialStoreResult, ExperientialWrite, ExperientialStoreStats, ExperientialStore } from './store-types.ts';
export { createExperientialStoreAdapter, createExperientialMemoryStore } from './store.ts';
export type { ExperientialStoreOptions } from './store.ts';
export { createExperientialMemoryPersistence } from './persistence-memory.ts';
export type { ExperientialMemoryState, ExperientialMemoryOptions, ExperientialMemoryPersistence } from './persistence-memory.ts';
export { resolveExperientialLineage } from './lineage.ts';
export type { ExperientialLineage } from './lineage.ts';
