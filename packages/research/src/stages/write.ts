/** Both writer modes arrange the same admitted sentences; the native agent supplies only this proposal. */
import { equalsJson } from '@jarenjs/core/object';
import type { Draft, ResearchClaimLedger, ResearchDraftProposal, ResearchRoleIdentity } from '../contracts.gen.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { researchRevisionOf, immutableResearchJson } from '../identity.ts';
import { validateResearchShape } from '../schema.ts';
import { RESEARCH_DRAFT_SECTIONS, researchStrictSection } from './claims.ts';

export function researchDraftProposal(ledger: { claims: ReadonlyArray<Pick<ResearchClaimLedger['claims'][number], 'id' | 'section' | 'text'>> }): ResearchDraftProposal {
  return { sections: RESEARCH_DRAFT_SECTIONS.map(id => {
    const claims = ledger.claims.filter(claim => claim.section === id);
    return { id, kind: researchStrictSection(id) ? 'strict' : 'open', text: claims.map(claim => claim.text).join('\n\n'), claimIds: claims.map(claim => claim.id) };
  }) };
}
export function validateResearchDraftLayout(proposal: ResearchDraftProposal, ledger: ResearchClaimLedger): ResearchOutcome<ResearchDraftProposal> {
  const shape = validateResearchShape<ResearchDraftProposal>('ResearchDraftProposal', proposal); if (!shape.valid) return shape;
  if (!equalsJson(proposal.sections.map(section => section.id), RESEARCH_DRAFT_SECTIONS))
    return researchRefuse('TRSH1005', '/sections', 'Every writer uses the declared section ids and order.');
  for (const [index, section] of proposal.sections.entries()) {
    const claims = ledger.claims.filter(claim => claim.section === section.id);
    if (section.kind !== (researchStrictSection(section.id) ? 'strict' : 'open')
      || !equalsJson([...section.claimIds].sort(), claims.map(claim => claim.id).sort())
      || section.text !== section.claimIds.map(id => claims.find(claim => claim.id === id)?.text).join('\n\n'))
      return researchRefuse('TRSH1005', '/sections/' + index, 'A writer may arrange exact admitted claim sentences but cannot add, omit or modify facts.');
  }
  return shape;
}
export async function writeResearchDraft(ledger: ResearchClaimLedger, writer: ResearchRoleIdentity,
  options: { mode: 'template' | 'agent'; proposal?: ResearchDraftProposal }): Promise<ResearchOutcome<Draft>> {
  try {
    ({ ledger, writer, options } = immutableResearchJson({ ledger, writer, options }));
    const checked = validateResearchShape<ResearchClaimLedger>('ResearchClaimLedger', ledger); if (!checked.valid) return checked;
    const role = validateResearchShape<ResearchRoleIdentity>('ResearchRoleIdentity', writer); if (!role.valid) return role;
    const { id, ...content } = ledger;
    if (id !== 'ledger-' + await researchRevisionOf(content)) return researchRefuse('TRSH1002', '/ledgerId', 'The writer requires an unchanged admitted ledger.');
    if (options.mode === 'agent' && !options.proposal) return researchRefuse('TRSH1003', '/proposal', 'Agent mode requires its retained native structured proposal.');
    const proposal = options.mode === 'template' ? researchDraftProposal(ledger) : options.proposal!;
    const layout = validateResearchDraftLayout(proposal, ledger); if (!layout.valid) return layout;
    const body = { projectId: ledger.projectId, ledgerId: ledger.id, mode: options.mode, writer, sections: layout.value.sections };
    return validateResearchShape<Draft>('Draft', { id: 'draft-' + await researchRevisionOf(body), ...body });
  } catch (cause) { return researchRefuse('TRSH1001', '/draft', 'Drafts require finite immutable records.', cause); }
}
