import type { GmplInput } from '@tangleai/gmpl';
import type { ResearchStageAccess, ResearchStageOperation, ResearchStageResult } from './handlers.ts';
import type { ResearchCost } from './contracts.gen.ts';
import { researchRevisionOf } from './identity.ts';
import { researchArtifacts } from './domain.ts';
import { researchFail, researchValue } from './workflow-contract.ts';
import { validateResearchShape } from './schema.ts';

export interface ResearchAnalysisRuntimePolicy { analystIdentityId: string; reviewerIdentityId: string; statisticId: string }
export interface ResearchAnalysisRuntime {
  policy: ResearchAnalysisRuntimePolicy;
  prepare(operation: ResearchStageOperation, access: ResearchStageAccess): Promise<{ input: GmplInput }>;
  complete(operation: ResearchStageOperation, access: ResearchStageAccess, proposal: unknown, spend: ResearchCost): Promise<ResearchStageResult>;
}
export async function researchAnalysisRevisionOf(policy: ResearchAnalysisRuntimePolicy): Promise<string> {
  researchValue(validateResearchShape('ResearchId', policy.analystIdentityId));
  researchValue(validateResearchShape('ResearchId', policy.reviewerIdentityId));
  if (policy.analystIdentityId === policy.reviewerIdentityId || !policy.statisticId.trim())
    researchFail('TRSH1005', '/analysis/policy', 'Analysis and result review need distinct identities and a pinned statistic.');
  return researchRevisionOf({ owner: 'research-analysis-v1', catalog: researchArtifacts.revision, policy });
}
