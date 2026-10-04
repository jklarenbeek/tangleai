import { createResearchSynthesis, createResearchHypotheses, createResearchDesign, researchArtifactIdOf,
  validateResearchShape, type EvidenceCard, type LiteratureRecord, type HypothesisSetProposal, type ResearchDesignProposal } from '@tangleai/research';
import { checked, frozen, project, hash } from './fixtures.ts';
import literature from '../../benchmark/fixtures/research/literature/records.json' with { type: 'json' };

export async function reasoningFixture() {
  const bounds = { ...await frozen(), budget: project().budget };
  const source = new TextEncoder().encode('Synthetic evidence: compare the same features and control random seeds.');
  const artifactId = await researchArtifactIdOf(source);
  const cards: EvidenceCard[] = [{ id: 'card-fixture', literatureId: literature[0].id, artifactId,
    excerpt: new TextDecoder().decode(source), contentHash: artifactId.slice(4), versionId: hash('c'),
    locator: { headingPath: [], elementOrder: 0 }, fields: ['paragraph'], extractionPromptRevision: hash() }];
  const synthesisProposal = { summary: 'Compare initialization on the same features.', evidenceIds: cards.map(card => card.id),
    conflicts: ['Random initialization may vary across seeds.'], gaps: ['No measured comparison is available.'] };
  const synthesis = checked(await createResearchSynthesis(project().id, project().question, synthesisProposal, cards));
  const hypothesisProposal: HypothesisSetProposal = {
    hypotheses: [0, 1].map(index => ({ statement: index ? 'candidate changes seed variance over control' : bounds.contract.hypothesisSpace[0],
      nullHypothesis: 'candidate and control have equal outcomes', predictedObservation: index ? 'lower between-seed variance' : 'lower paired inertia',
      disconfirmingObservation: 'no favorable paired difference', evidenceIds: [cards[0].id], baselineIds: ['control'],
      confounds: ['different features'], queries: [index ? 'seed variance controlled comparison' : 'initialization paired inertia'] })),
    advisory: { rating: 0.6, reason: 'A model opinion; literature overlap still needs measurement.' },
  };
  const generated = checked(await createResearchHypotheses(synthesis, hypothesisProposal, cards, ['control'], 'single-agent'));
  const { id: _contractId, projectId: _projectId, contractHash: _hash, ...contract } = bounds.contract;
  const { id: _planId, projectId: _planProject, contractHash: _contractHash, hypothesisHash: _hypothesisHash, planHash: _planHash, ...plan } = bounds.plan;
  const designProposal: ResearchDesignProposal = { hypothesisId: generated.hypotheses[0].id, contract,
    plan: { ...plan, design: { variables: { independent: ['initialization'], dependent: ['inertia'], controlled: ['features', 'k'] },
      controls: [{ confound: 'different features', strategy: 'Use the same content-hashed feature matrix for both conditions.' }],
      statisticalTest: { name: 'paired bootstrap', rationale: 'Pair conditions by their preregistered seed.' },
      replicateRationale: 'Two declared seeds are a fixture conformance check, not a general power claim.',
      resources: { calls: 2, tokens: 20, ms: 500, physical: 2 }, hazards: [{ hazard: 'untrusted code', mitigation: 'Execution requires the isolated host.' }],
      expectedFailures: ['No positive interval; retain an inconclusive result.'] } } };
  const design = checked(await createResearchDesign(project().id, designProposal, generated.hypotheses, bounds));
  return { bounds, source, literature: checked(validateResearchShape<LiteratureRecord>('LiteratureRecord', literature[0])), cards,
    synthesisProposal, synthesis, hypothesisProposal, ...generated, designProposal, design };
}
