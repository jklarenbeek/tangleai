import type { ExperientialRecordMap, ExperientialRecordKind } from './schema.ts';
import type { ExperientialIssue, ExperientialHead, ExperientialEvaluation, ExperientialInferencePin } from './contracts.gen.ts';
import type { ExperientialEvaluationPlan, ExperientialEvaluationResultPlan } from './evaluation.ts';
import type { ExperientialActivationPlan, ExperientialTransitionPlan } from './lifecycle.ts';
import type { ExperientialTrainingCommand } from './contracts.gen.ts';
import type { ExperientialTrainingUpdate } from './training.ts';

export const EXPERIENTIAL_TABLE_KINDS = Object.freeze({
  experiences: 'experience', assessments: 'assessment', datasets: 'dataset', training_runs: 'trainingRun',
  artifacts: 'artifact', evaluations: 'evaluation', gate_policies: 'gatePolicy', approvals: 'approval',
  deployments: 'deployment', pins: 'inferencePin', retention_decisions: 'retentionDecision', events: 'event', heads: 'head',
} as const satisfies Record<string, ExperientialRecordKind>);
export type ExperientialTable = keyof typeof EXPERIENTIAL_TABLE_KINDS;
export type ExperientialTables = { [K in ExperientialTable]: ExperientialRecordMap[typeof EXPERIENTIAL_TABLE_KINDS[K]] };
export const EXPERIENTIAL_TABLES = Object.freeze(Object.keys(EXPERIENTIAL_TABLE_KINDS) as ExperientialTable[]);

/** Trusted extension: all writes must roll back if task throws. */
export interface ExperientialTransaction {
  get<K extends ExperientialTable>(table: K, id: string): Promise<ExperientialTables[K] | undefined>;
  /** A null scope is reserved for internal global uniqueness checks. */
  list<K extends ExperientialTable>(table: K, scope: string | null): Promise<ExperientialTables[K][]>;
  put<K extends ExperientialTable>(table: K, value: ExperientialTables[K]): Promise<void>;
}
export interface ExperientialPersistence {
  transaction<T>(task: (view: ExperientialTransaction) => Promise<T>): Promise<T>;
}
export type ExperientialStoreResult<T> = { ok: true; value: T; writes: number; replayed: boolean } | { ok: false; issues: ExperientialIssue[] };
export type ExperientialWrite = { [K in ExperientialTable]: { table: K; value: ExperientialTables[K] } }[ExperientialTable];
export interface ExperientialStoreStats { transactions: number; writes: number; activations: number }
export interface ExperientialStore {
  stats(): ExperientialStoreStats;
  get<K extends ExperientialTable>(table: K, id: string): Promise<ExperientialStoreResult<ExperientialTables[K] | null>>;
  list<K extends ExperientialTable>(table: K, scope: string): Promise<ExperientialStoreResult<ExperientialTables[K][]>>;
  put<K extends ExperientialTable>(table: K, value: ExperientialTables[K]): Promise<ExperientialStoreResult<ExperientialTables[K]>>;
  putBatch(writes: readonly ExperientialWrite[]): Promise<ExperientialStoreResult<ExperientialWrite[]>>;
  transition(plan: ExperientialTransitionPlan, options?: { evaluationId?: string }): Promise<ExperientialStoreResult<ExperientialTransitionPlan>>;
  training(runId: string, expectedRevision: number, command: ExperientialTrainingCommand): Promise<ExperientialStoreResult<ExperientialTrainingUpdate>>;
  startEvaluation(plan: ExperientialEvaluationPlan): Promise<ExperientialStoreResult<ExperientialEvaluationPlan>>;
  recordEvaluation(evaluation: ExperientialEvaluation): Promise<ExperientialStoreResult<ExperientialEvaluationResultPlan>>;
  pin(pin: ExperientialInferencePin): Promise<ExperientialStoreResult<ExperientialInferencePin>>;
  head(profile: string, scope: string): Promise<ExperientialStoreResult<ExperientialHead>>;
  activate(plan: ExperientialActivationPlan): Promise<ExperientialStoreResult<ExperientialHead>>;
  rollback(plan: ExperientialActivationPlan): Promise<ExperientialStoreResult<ExperientialHead>>;
}
