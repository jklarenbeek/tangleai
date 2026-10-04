import type { EvidenceCard, Synthesis, ResearchHypothesis, LiteratureRecord } from './contracts.gen.ts';
import type { ResearchStageOperation, ResearchStageAccess } from './handlers.ts';
import type { ResearchRecordWrite } from './records.ts';
import { validateResearchShape } from './schema.ts';
import { researchValue, researchFail } from './workflow-contract.ts';
import { immutableResearchJson } from './identity.ts';

export const RESEARCH_REASONING_MEDIA_TYPE = 'application/vnd.tangleai.research-reasoning+json';
export async function readResearchReasoningInputs(operation: Pick<ResearchStageOperation, 'frame'>, access: ResearchStageAccess, maxCards: number) {
  const allCards: EvidenceCard[] = [], literature: LiteratureRecord[] = [], syntheses: Synthesis[] = [], hypotheses: ResearchHypothesis[] = [];
  for (const ref of operation.frame.artifacts) {
    const descriptor = await access.describeArtifact(ref);
    if (descriptor.mediaType !== 'application/json' && descriptor.mediaType !== RESEARCH_REASONING_MEDIA_TYPE) continue;
    const envelope = JSON.parse(new TextDecoder().decode(await access.readArtifact(ref))) as { kind?: string; pivot?: number; value?: ResearchRecordWrite[] };
    if (envelope.kind !== 'discovery-records' && envelope.kind !== 'reasoning-records') continue;
    if (!Array.isArray(envelope.value)) researchFail('TRSH1001', '/records', 'A committed research record envelope must contain a record list.');
    if (envelope.kind === 'reasoning-records' && envelope.pivot !== operation.frame.pivot) continue;
    for (const row of envelope.value) {
      researchValue(validateResearchShape(row.kind, row.value));
      if (row.kind === 'EvidenceCard') allCards.push(row.value);
      if (row.kind === 'LiteratureRecord') literature.push(row.value);
      if (row.kind === 'Synthesis') syntheses.push(row.value);
      if (row.kind === 'ResearchHypothesis') hypotheses.push(row.value);
    }
  }
  const unique = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map(row => [row.id, row])).values()];
  const bySource = new Map<string, EvidenceCard>();
  for (const card of unique(allCards).sort((a, b) => a.locator.elementOrder - b.locator.elementOrder || a.id.localeCompare(b.id)))
    if (!bySource.has(card.literatureId)) bySource.set(card.literatureId, card);
  const cards = [...bySource.values()].sort((a, b) => a.literatureId.localeCompare(b.literatureId)).slice(0, maxCards);
  if (!cards.length) researchFail('TRSH1003', '/cards', 'Reasoning requires committed evidence cards.');
  const current = unique(syntheses);
  if (current.length > 1) researchFail('TRSH1004', '/synthesis', 'The current pivot has conflicting synthesis artifacts.');
  return immutableResearchJson({ cards, availableCards: unique(allCards).length, literature: unique(literature),
    synthesis: current[0] ?? null, hypotheses: unique(hypotheses).filter(row => row.synthesisId === current[0]?.id) });
}
