/** Closed configuration for native model stages; no provider or scheduler lives here. */
import { gmplSchemaOf, type GmplInput } from '@tangleai/gmpl';
import type { JsonSchema, MasNodeAttempt, MasRun, MasStore } from '@tangleai/mas';
import type { ResearchWorkflowFrame, ResearchCost, QueryPlan, ResearchInputArtifact } from './contracts.gen.ts';
import type { ResearchStageAccess, ResearchStageOperation, ResearchStageResult } from './handlers.ts';
import type { ResearchNoveltyPolicy } from './stages/novelty.ts';
import { researchSchemaOf } from './schema.ts';
import { researchArtifacts } from './domain.ts';
import { researchRevisionOf } from './identity.ts';
import { researchFail } from './workflow-contract.ts';

export const RESEARCH_MODEL_STAGES = ['synthesis', 'hypothesis', 'design'] as const;
export type ResearchModelStage = typeof RESEARCH_MODEL_STAGES[number];
export interface ResearchReasoningPolicy {
  mode: 'single-agent' | 'debate';
  maxCards: number;
  novelty: ResearchNoveltyPolicy;
}
export interface ResearchPreparation {
  stage: ResearchModelStage | 'execute' | 'decide';
  scope: string;
  commitPath: string;
  manifestHash: string;
  attemptId: string;
  stateRevision: number;
  frame: ResearchWorkflowFrame;
}
export const RESEARCH_PREPARATION_SCHEMA: JsonSchema = { type: 'object', additionalProperties: false,
  required: ['stage', 'scope', 'commitPath', 'manifestHash', 'attemptId', 'stateRevision', 'frame'], properties: {
    stage: { enum: [...RESEARCH_MODEL_STAGES] }, scope: { type: 'string', minLength: 1 }, commitPath: { type: 'string', minLength: 1 },
    manifestHash: researchSchemaOf('Sha256'), attemptId: researchSchemaOf('ResearchId'),
    stateRevision: { type: 'integer', minimum: 0 }, frame: researchSchemaOf('ResearchWorkflowFrame'),
  } };
export const RESEARCH_PATTERN_INPUT_SCHEMA = gmplSchemaOf('gmplInput');
export interface ResearchReasoningRuntime {
  policy: ResearchReasoningPolicy;
  retainLiteratureInputs(operation: ResearchStageOperation, access: ResearchStageAccess): Promise<ResearchInputArtifact[]>;
  prepare(operation: ResearchStageOperation, access: ResearchStageAccess): Promise<{ variables: Record<string, unknown>; input: GmplInput }>;
  complete(operation: ResearchStageOperation, access: ResearchStageAccess, proposal: unknown, spend: ResearchCost,
    admitPlan: (plan: QueryPlan) => Promise<void>): Promise<ResearchStageResult>;
}
export async function researchReasoningRevisionOf(policy: ResearchReasoningPolicy): Promise<string> {
  if (!['single-agent', 'debate'].includes(policy.mode) || !Number.isSafeInteger(policy.maxCards) || policy.maxCards < 1 || policy.maxCards > 64)
    researchFail('TRSH1001', '/reasoning', 'Reasoning requires a registered mode and a bounded visible card count.');
  return researchRevisionOf({ owner: 'research-reasoning-v1', catalog: researchArtifacts.revision, policy });
}
export function researchNativeCost(attempts: readonly MasNodeAttempt[], scope: string): ResearchCost {
  // Composition attempts summarize their children; count physical agent attempts exactly once.
  return attempts.filter(row => row.kind === 'agent' && row.path.startsWith(scope + '/')).reduce((sum, row) => ({
    calls: sum.calls + row.usage.calls, tokens: sum.tokens + row.usage.promptTokens + row.usage.completionTokens + (row.usage.estimatedTokens ?? 0),
    ms: sum.ms + row.spend.ms, physical: sum.physical + row.usage.calls,
  }), { calls: 0, tokens: 0, ms: 0, physical: 0 });
}
export interface ResearchHandlerAdmission {
  reconcileFailure?(runId: string, failure: MasRun['failure']): Promise<void>;
  toolBindings?: import('@tangleai/mas').MasHostBindings['toolBindings'];
  reasoning?: ResearchReasoningPolicy;
  execution?: import('./execution-contract.ts').ResearchExecutionPolicy;
  analysis?: import('./analysis-contract.ts').ResearchAnalysisRuntimePolicy;
}
export async function researchPreparationFor(store: Pick<MasStore, 'readTrace'>, invocation: { runId: string; path: string }): Promise<ResearchPreparation> {
  const trace = await store.readTrace(invocation.runId);
  if (trace?.run.status !== 'running' || !trace.attempts.some(row => row.path === invocation.path && row.status === 'running'
    && (row.kind === 'agent' || row.kind === 'task')))
    researchFail('TRSH1005', '/invocation', 'Research model scope must belong to a running native attempt.');
  const candidates = (trace?.attempts ?? []).filter(row => row.status === 'completed' && row.kind === 'task' && row.invocationId === 'prepare')
    .map(row => (row.output as { preparation?: ResearchPreparation } | null)?.preparation)
    .filter((row): row is ResearchPreparation => !!row && invocation.path.startsWith(row.scope + '/'));
  candidates.sort((a, b) => b.scope.length - a.scope.length);
  const preparation = candidates[0];
  if (!preparation || preparation.frame.projectId !== invocation.runId)
    researchFail('TRSH1005', '/invocation', 'A model operation requires its retained native research preparation.');
  return preparation;
}
