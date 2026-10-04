import type { EvidenceCard, Synthesis, ResearchHypothesis, HypothesisSet, HypothesisSetProposal } from '../contracts.gen.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';
import { checkResearchEvidence } from './synthesis.ts';

/** Model ids and hashes are not inputs; the owner derives every record address. */
export async function createResearchHypotheses(synthesis: Synthesis, proposal: unknown, cards: readonly EvidenceCard[],
  baselineIds: readonly string[], mode: HypothesisSet['mode']): Promise<ResearchOutcome<{ hypotheses: ResearchHypothesis[]; set: HypothesisSet }>> {
  const checked = validateResearchShape<HypothesisSetProposal>('HypothesisSetProposal', proposal);
  if (!checked.valid) return checked;
  if (checked.value.hypotheses.length < 2) return researchRefuse('TRSH1009', '/hypotheses', 'A hypothesis set needs at least two explicit alternatives.');
  const hypotheses: ResearchHypothesis[] = [], queries: HypothesisSet['queries'] = [];
  for (const [index, proposed] of checked.value.hypotheses.entries()) {
    const { queries: suggested, ...hypothesis } = proposed;
    const evidence = checkResearchEvidence(hypothesis.evidenceIds, cards, `/hypotheses/${index}/evidenceIds`);
    if (!evidence.valid) return evidence;
    for (const [i, id] of hypothesis.baselineIds.entries()) if (!baselineIds.includes(id))
      return researchRefuse('TRSH1003', `/hypotheses/${index}/baselineIds/${i}`, 'Unknown declared baseline.');
    if (![hypothesis.nullHypothesis, hypothesis.disconfirmingObservation, hypothesis.predictedObservation].every(value => value.trim())
      || hypothesis.statement.trim() === hypothesis.nullHypothesis.trim()
      || hypothesis.predictedObservation.trim() === hypothesis.disconfirmingObservation.trim())
      return researchRefuse('TRSH1009', `/hypotheses/${index}`, 'Prediction, null and disconfirming observation must be explicit and distinct.');
    const content = { projectId: synthesis.projectId, synthesisId: synthesis.id, ...hypothesis };
    const body = { id: 'hypothesis-' + await researchRevisionOf(content), ...content };
    if (hypotheses.some(row => row.id === body.id || row.statement.trim() === hypothesis.statement.trim()))
      return researchRefuse('TRSH1009', `/hypotheses/${index}`, 'Repeated proposals are not distinct alternatives.');
    const row = validateResearchShape<ResearchHypothesis>('ResearchHypothesis', { ...body, hypothesisHash: await researchRevisionOf(body) });
    if (!row.valid) return row;
    hypotheses.push(row.value); queries.push(...suggested.map(query => ({ hypothesisId: row.value.id, query })));
  }
  const body = { projectId: synthesis.projectId, synthesisId: synthesis.id, mode, hypothesisIds: hypotheses.map(row => row.id),
    queries, advisory: checked.value.advisory };
  const set = validateResearchShape<HypothesisSet>('HypothesisSet', { id: 'hypotheses-' + await researchRevisionOf(body), ...body });
  return set.valid ? { valid: true, value: immutableResearchJson({ hypotheses, set: set.value }) } : set;
}
