/** Deterministic record admission after a native model produces a proposal. */
import type { EvidenceCard, Synthesis, SynthesisProposal } from '../contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';

export function checkResearchEvidence(ids: readonly string[], cards: readonly EvidenceCard[], path = '/evidenceIds'): ResearchOutcome<null> {
  for (const [index, id] of ids.entries()) if (!cards.some(card => card.id === id))
    return researchRefuse('TRSH1003', `${path}/${index}`, 'The proposal cites no evidence card in this stage input.');
  return { valid: true, value: null };
}
export async function createResearchSynthesis(projectId: string, question: string, proposal: unknown,
  cards: readonly EvidenceCard[]): Promise<ResearchOutcome<Synthesis>> {
  const checked = validateResearchShape<SynthesisProposal>('SynthesisProposal', proposal);
  if (!checked.valid) return checked;
  const links = checkResearchEvidence(checked.value.evidenceIds, cards); if (!links.valid) return links;
  const content = immutableResearchJson({ projectId, question, ...checked.value });
  return validateResearchShape<Synthesis>('Synthesis', { id: 'synthesis-' + await researchRevisionOf(content), ...content });
}
