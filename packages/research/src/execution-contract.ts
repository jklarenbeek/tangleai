import type { ResearchCost, ResearchInputArtifact, ExecutionManifestResources } from './contracts.gen.ts';
import type { ResearchStageOperation, ResearchStageAccess, ResearchStageResult } from './handlers.ts';
import type { MasTaskInput, MasHostBindings } from '@tangleai/mas';
import { researchRevisionOf, immutableResearchJson } from './identity.ts';
import { researchFail } from './workflow-contract.ts';
import { RESEARCH_EXECUTOR_CONTRACT } from './execution/executor.ts';
import { RESEARCH_EXECUTION_LIMITS, isResearchWorkspacePath } from './execution/manifest.ts';

export interface ResearchExecutionPolicy {
  mode: 'fixture' | 'authored';
  imageDigest: string;
  dependencyLockHash: string;
  resources: ExecutionManifestResources;
  maxSeeds: number;
  maxConditions: number;
  datasetPaths: Array<{ datasetId: string; path: string }>;
  /** Each slot is single-assignment; their sum bounds all authored bytes, including retries. */
  codeFiles: Array<{ path: string; maxBytes: number }>;
}
export interface ResearchExecutionCursor { seed: number; condition: number; conditionDone: boolean; done: boolean }
export interface ResearchExecutionRuntime {
  policy: ResearchExecutionPolicy;
  taskHandlers: MasHostBindings['taskHandlers'];
  toolBindings: MasHostBindings['toolBindings'];
  prepare(operation: ResearchStageOperation, access: ResearchStageAccess): Promise<{ execution: ResearchInputArtifact; cursor: ResearchExecutionCursor }>;
  complete(operation: ResearchStageOperation, spend: ResearchCost, scope: string, partial: boolean): Promise<ResearchStageResult>;
}
export async function researchExecutionRevisionOf(input: ResearchExecutionPolicy): Promise<string> {
  const policy = immutableResearchJson(input);
  if (!['fixture', 'authored'].includes(policy.mode) || !/^sha256:[0-9a-f]{64}$/.test(policy.imageDigest)
    || !/^[0-9a-f]{64}$/.test(policy.dependencyLockHash)) researchFail('TRSH1001', '/execution', 'Execution policy requires pinned image and dependency identities.');
  for (const key of ['maxSeeds', 'maxConditions'] as const)
    if (!Number.isSafeInteger(policy[key]) || policy[key] < 1 || policy[key] > 8) researchFail('TRSH1006', '/execution/' + key, 'Native execution loops have a finite eight-item ceiling.');
  for (const key of ['cpu', 'memoryBytes', 'pids', 'wallMs', 'outputBytes'] as const)
    if (!Number.isFinite(policy.resources[key]) || policy.resources[key] <= 0 || policy.resources[key] > RESEARCH_EXECUTION_LIMITS.resources[key]
      || key !== 'cpu' && !Number.isSafeInteger(policy.resources[key])) researchFail('TRSH1010', '/execution/resources', 'Execution resources exceed their published cap.');
  if (!policy.datasetPaths.length || policy.datasetPaths.length > 16 || new Set(policy.datasetPaths.map(row => row.datasetId)).size !== policy.datasetPaths.length
    || new Set(policy.datasetPaths.map(row => row.path)).size !== policy.datasetPaths.length
    || policy.datasetPaths.some(row => !row.datasetId || !isResearchWorkspacePath(row.path)))
    researchFail('TRSH1009', '/execution/datasetPaths', 'Execution needs a finite one-to-one map from frozen datasets to input paths.');
  if (policy.codeFiles.length > 8 || new Set(policy.codeFiles.map(row => row.path.toLowerCase())).size !== policy.codeFiles.length
    || policy.codeFiles.some(row => !isResearchWorkspacePath(row.path) || !row.path.startsWith('code/') || !row.path.endsWith('.mjs')
      || !Number.isSafeInteger(row.maxBytes) || row.maxBytes < 1)
    || policy.codeFiles.reduce((sum, row) => sum + row.maxBytes, 0) > 65536
    || (policy.mode === 'authored') !== (policy.codeFiles.length > 0))
    researchFail('TRSH1010', '/execution/codeFiles', 'Authoring requires bounded, immutable code slots in the read-only code directory.');
  return researchRevisionOf({ owner: 'research-execution-v1', contract: RESEARCH_EXECUTOR_CONTRACT, policy });
}
export type ResearchExecutionTask = (input: MasTaskInput) => Promise<Record<string, unknown>>;
