/** Independent advisory review consumes native GMPL results without changing claim support. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { validateGmplEvidence, mergeGmplFindings, type GmplEvidenceUnit, type GmplFinding } from '@tangleai/gmpl';
import type { Draft, ResearchClaimLedger, ResearchRoleIdentity, Review, ResearchIssue } from '../contracts.gen.ts';
import { immutableResearchJson, researchArtifactIdOf, researchRevisionOf } from '../identity.ts';
import { researchIssue, researchRefuse, type ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';

export interface ResearchReviewProposal { pattern: 'peer-review' | 'red-team'; result: unknown; independence: ResearchRoleIdentity | null }
export interface ResearchReviewAssessment { accepted: boolean; reviews: Review[]; findings: GmplFinding[]; issues: ResearchIssue[];
  artifacts: Array<{ bytes: Uint8Array; mediaType: string }> }
export async function createResearchReviews(draft: Draft, ledger: ResearchClaimLedger, evidence: readonly GmplEvidenceUnit[],
  proposals: readonly ResearchReviewProposal[]): Promise<ResearchOutcome<ResearchReviewAssessment>> {
  try {
    ({ draft, ledger, evidence, proposals } = immutableResearchJson({ draft, ledger, evidence, proposals }));
    for (const [name, value] of [['Draft', draft], ['ResearchClaimLedger', ledger]] as const) {
      const checked = validateResearchShape(name, value); if (!checked.valid) return checked;
    }
    const { id: draftId, ...draftBody } = draft, { id: ledgerId, ...ledgerBody } = ledger;
    if (draftId !== 'draft-' + await researchRevisionOf(draftBody) || ledgerId !== 'ledger-' + await researchRevisionOf(ledgerBody))
      return researchRefuse('TRSH1002', '/reviews', 'Independent review requires the unchanged draft and claim ledger.');
    for (const record of [draft, ledger]) {
      const digest = await researchRevisionOf(record);
      if (!evidence.some(unit => unit.id === record.id && unit.digest === digest))
        return researchRefuse('TRSH1005', '/reviews/evidence', 'Review visibility must bind both the immutable draft and complete claim ledger.');
    }
    if (draft.ledgerId !== ledger.id || draft.projectId !== ledger.projectId || proposals.length !== 2
      || new Set(proposals.map(proposal => proposal.pattern)).size !== 2
      || proposals.some(proposal => !['peer-review', 'red-team'].includes(proposal.pattern)))
      return researchRefuse('TRSH1005', '/reviews', 'Both declared native review patterns must address the same draft and claim ledger.');
    const reviews: Review[] = [], artifacts: ResearchReviewAssessment['artifacts'] = [], issues: ResearchIssue[] = [];
    for (const [index, proposal] of proposals.entries()) {
      const reviewed = validateGmplEvidence(proposal.result, evidence);
      if (!reviewed.valid) return researchRefuse('TRSH1005', '/reviews/' + index, 'Native review evidence is outside its admitted view.', reviewed.issues[0]);
      const identity = proposal.independence;
      if (identity) { const checked = validateResearchShape('ResearchRoleIdentity', identity); if (!checked.valid) return checked; }
      const independent = identity !== null && identity.roleId !== draft.writer.roleId;
      const critical = reviewed.value.findings.some(finding => finding.critical && finding.disposition !== 'rejected-with-reason');
      const verdict: Review['verdict'] = critical ? 'reject' : !independent || reviewed.value.disposition !== 'completed' ? 'revise' : 'accept';
      if (!independent) issues.push(researchIssue('TRSH1005', '/reviews/' + index + '/independence', 'A review without a distinct role identity is advisory and cannot pass the quality review.'));
      if (critical || reviewed.value.disposition !== 'completed') issues.push(researchIssue('TRSH1005', '/reviews/' + index, 'Native review retains a critical finding or an incomplete disposition.'));
      const bytes = new TextEncoder().encode(canonicalizeJson({ kind: 'research-draft-review', draftId: draft.id,
        pattern: proposal.pattern, independence: identity, result: reviewed.value }));
      const body: Omit<Review, 'id'> = { projectId: draft.projectId, reviewerIdentityId: await researchRevisionOf(identity ?? { advisory: proposal.pattern }),
        artifactIds: [await researchArtifactIdOf(bytes)], claimIds: ledger.claims.map(claim => claim.id), verdict,
        findings: reviewed.value.findings.map(finding => finding.id), retainedFindings: reviewed.value.findings, rubricVersion: 'research-claims-v1',
        pattern: proposal.pattern, draftId: draft.id, ...(identity ? { independence: identity } : {}) };
      const record = validateResearchShape<Review>('Review', { id: 'review-' + await researchRevisionOf(body), ...body });
      if (!record.valid) return record;
      reviews.push(record.value); artifacts.push({ bytes, mediaType: 'application/vnd.tangleai.research-draft-review+json' });
    }
    const merged = mergeGmplFindings(reviews.map(review => review.retainedFindings!));
    if (!merged.valid) issues.push(researchIssue('TRSH1005', '/reviews/findings', 'Conflicting review versions remain in their original records and require an explicit disposition.', merged.issues[0]));
    return { valid: true, value: { accepted: issues.length === 0 && reviews.every(review => review.verdict === 'accept'),
      reviews, findings: merged.valid ? merged.value : [], issues, artifacts } };
  } catch (cause) { return researchRefuse('TRSH1001', '/reviews', 'Review requires finite immutable native results.', cause); }
}
