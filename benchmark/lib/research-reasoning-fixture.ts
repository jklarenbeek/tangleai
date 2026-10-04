/** Authored model responses depend only on public registration and discovered cards. */
import { openTangleDb, createResearchStore } from '@tangleai/store';
import { createResearchSynthesis, createResearchHypotheses, researchValue, planProjectCreate,
  executeScholarlyDiscovery, screenLiterature, acquireResearchSources, type SynthesisProposal, type HypothesisSetProposal,
  type ResearchDesignProposal, type ResearchTranscript } from '@tangleai/research';
import { researchExampleData } from '../../examples/research.ts';
import { createResearchDiscoveryFixture } from './research-discovery.ts';
import { requireResearchShape } from './research-validation.ts';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { ResearchReasoningScript } from './research.types.ts';

export async function researchReasoningScripts(loaded: LoadedResearchFixture): Promise<Map<string, unknown>> {
  const files = new Map<string, unknown>();
  for (const topic of loaded.topics) {
    const db = await openTangleDb(), discovery = await createResearchDiscoveryFixture(loaded, topic, db);
    try {
      const store = createResearchStore(db), project = (await researchExampleData(topic.contract.projectId)).project;
      researchValue(await store.createProject(researchValue(planProjectCreate(project))));
      researchValue(await store.putRecord(project.id, { kind: 'QueryPlan', value: discovery.options.plan }));
      const signal = new AbortController().signal;
      const found = await executeScholarlyDiscovery(discovery.options.plan, discovery.options.provider, signal, discovery.options.searxngBaseUrl);
      const screening = await screenLiterature(project.id, discovery.options.criteria, found.literature);
      const acquired = await acquireResearchSources(found.literature, screening, discovery.options.documents,
        { signal, promptRevision: discovery.options.extractionPromptRevision, limits: discovery.options.acquisition });
      const selected = [...acquired.cards].sort((a, b) => a.locator.elementOrder - b.locator.elementOrder || a.id.localeCompare(b.id));
      const first = new Map<string, typeof selected[number]>(); for (const card of selected) if (!first.has(card.literatureId)) first.set(card.literatureId, card);
      const cards = [...first.values()].sort((a, b) => a.literatureId.localeCompare(b.literatureId)).slice(0, 8);
      const synthesis: SynthesisProposal = { summary: 'Compare the declared methods on the same visible inputs and report every registered replicate.',
        evidenceIds: cards.slice(0, 2).map(row => row.id), conflicts: ['No experiment result is available; the method comparison remains unresolved.'],
        gaps: ['The fixture does not establish a general method advantage.'] };
      const hypotheses: HypothesisSetProposal = { hypotheses: [
        { statement: topic.contract.hypothesisSpace[0], nullHypothesis: 'The candidate has no favorable paired difference from the baseline.',
          predictedObservation: 'A favorable paired difference on the declared metric.', disconfirmingObservation: 'A nonpositive paired difference or an interval touching zero.',
          evidenceIds: [cards[0].id], baselineIds: ['baseline'], confounds: ['different input features'], queries: [topic.id + ' paired method comparison'] },
        { statement: 'The registered candidate and baseline may be indistinguishable on this dataset.',
          nullHypothesis: 'The two registered methods have a nonzero paired difference.', predictedObservation: 'Equal retained outputs across the declared comparisons.',
          disconfirmingObservation: 'At least one registered paired output differs.', evidenceIds: [cards[1].id], baselineIds: ['baseline'],
          confounds: ['different input features'], queries: [topic.id + ' controlled equivalence comparison'] },
      ], advisory: { rating: 0.4, reason: 'Scripted model opinion; query coverage and identifier overlap are reported separately.' } };
      const admitted = researchValue(await createResearchSynthesis(project.id, topic.title, synthesis, cards));
      const generated = researchValue(await createResearchHypotheses(admitted, hypotheses, cards, ['baseline'], 'single-agent'));
      const { id: _id, projectId: _project, contractHash: _hash, ...contract } = topic.contract;
      const { id: _planId, projectId: _planProject, planHash: _planHash, contractHash: _planContract, hypothesisHash: _hypothesisHash, ...plan } = topic.plan;
      const design: ResearchDesignProposal = { hypothesisId: generated.hypotheses[0].id, contract,
        plan: { ...plan, design: { variables: { independent: ['method'], dependent: [contract.metrics[0].id], controlled: ['input features', 'seed'] },
          controls: [{ confound: 'different input features', strategy: 'Both conditions use the exact registered dataset bytes and split.' }],
          statisticalTest: { name: 'paired bootstrap', rationale: 'Preserve the preregistered seed pairing, resample count and confidence rule.' },
          replicateRationale: 'Use every registered seed; deterministic one-pair cases establish fixture behavior only.',
          resources: { calls: 0, tokens: 0, ms: 10000, physical: 0 },
          hazards: [{ hazard: 'untrusted candidate program', mitigation: 'Refuse execution without the isolated experiment host.' }],
          expectedFailures: ['Inconclusive or saturated metric; retain the negative result without changing the threshold.'] } } };
      const infeasible = structuredClone(design); delete (infeasible.contract.requiredBaselines[0] as Partial<typeof infeasible.contract.requiredBaselines[0]>).source;
      const confounded = structuredClone(design); confounded.plan.design.controls[0].confound = 'unrelated control';
      const hiddenRead = structuredClone(design); hiddenRead.plan.inputPaths.push(topic.hiddenPath);
      const transcripts: ResearchTranscript[] = [];
      for (const hypothesis of hypotheses.hypotheses) for (const query of hypothesis.queries) for (const page of [0, 1]) {
        const entry: ResearchTranscript = JSON.parse(new TextDecoder().decode(loaded.files.get('literature/transcripts/paged/' + topic.id + '/crossref-' + page + '.json')!));
        const url = new URL(entry.url); url.searchParams.set('query', query); transcripts.push({ ...entry, url: url.href });
      }
      const participants = Object.fromEntries(['innovator', 'pragmatist', 'contrarian', 'screener'].map((name, i) => [name,
        { hypotheses: [hypotheses.hypotheses[i % 2]], advisory: hypotheses.advisory }]));
      const script = requireResearchShape<ResearchReasoningScript>('ResearchReasoningScript', { topicId: topic.id, licence: topic.licence, model: 'scripted-v1', synthesis, hypotheses, design, participants,
        cases: [{ id: 'infeasible-plan', proposal: infeasible, expected: { code: 'TRSH1009', path: '/contract/requiredBaselines/0/source' } },
          { id: 'confounded-plan', proposal: confounded, expected: { code: 'TRSH1009', path: '/plan/design/controls' } },
          { id: 'hidden-read', proposal: hiddenRead, expected: { code: 'TRSH1005', path: '/plan/inputPaths/1' } },
          { id: 'malformed', proposal: {}, expected: { code: 'TRSH1009', path: '/hypothesisId' } }], noveltyTranscripts: transcripts });
      files.set('scripts/' + topic.id + '.json', script);
    } finally { await discovery.close(); await db.close(); }
  }
  return files;
}
