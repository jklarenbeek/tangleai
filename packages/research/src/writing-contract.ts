/** Bounded writing configuration; MAS owns model execution, repair and spend. */
import type { GmplInput } from '@tangleai/gmpl';
import type { ResearchRoleIdentity, ResearchCost } from './contracts.gen.ts';
import type { ResearchStageOperation, ResearchStageAccess, ResearchStageResult } from './handlers.ts';
import { researchArtifacts } from './domain.ts';
import { researchRevisionOf } from './identity.ts';
import { researchFail, researchValue } from './workflow-contract.ts';
import { validateResearchShape } from './schema.ts';

export interface ResearchWritingPolicy { mode: 'template' | 'agent'; modelIdentity: string; maxCards: number; maxClaims: number; maxViewChars: number }
// A read-only agent makes one completion and at most two normalization calls.
// Peer review: one author + six critics + two revisions. Red team: one
// author + three attack/defense/judge rounds. Native last-round guards apply.
export const RESEARCH_WRITING_CALLS = Object.freeze({ write: 3, verify: (9 + 10) * 3 });
export interface ResearchWritingRuntime {
  policy: ResearchWritingPolicy;
  prepare(operation: ResearchStageOperation, access: ResearchStageAccess): Promise<
    { variables: { ledger_id: string }; view: string } | { ready: boolean; input: GmplInput }>;
  complete(operation: ResearchStageOperation, access: ResearchStageAccess, proposal: unknown, spend: ResearchCost): Promise<ResearchStageResult>;
}
export function researchWritingRole(name: string, policy: ResearchWritingPolicy): ResearchRoleIdentity {
  const pack = researchArtifacts.prompts.find(row => row.id === 'research-' + name);
  if (!pack) researchFail('TRSH1003', '/prompts', 'The writing role has no compiled prompt artifact.');
  return { roleId: pack.role.id, promptRevision: pack.revision, modelIdentity: policy.modelIdentity };
}
export async function researchWritingRevisionOf(policy: ResearchWritingPolicy): Promise<string> {
  researchValue(validateResearchShape('Sha256', policy.modelIdentity));
  if (!['template', 'agent'].includes(policy.mode) || !Number.isSafeInteger(policy.maxCards) || policy.maxCards < 1 || policy.maxCards > 64
    || !Number.isSafeInteger(policy.maxClaims) || policy.maxClaims < 1 || policy.maxClaims > 256
    || !Number.isSafeInteger(policy.maxViewChars) || policy.maxViewChars < 1 || policy.maxViewChars > 200000)
    researchFail('TRSH1006', '/writing', 'Writing requires a declared mode and finite card, claim and complete-view limits.');
  return researchRevisionOf({ owner: 'research-writing-v1', catalog: researchArtifacts.revision, policy, calls: RESEARCH_WRITING_CALLS });
}
