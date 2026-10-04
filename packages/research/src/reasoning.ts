/** Research proposal owners surround native MAS model nodes with deterministic admission. */
import { equalsJson } from '@jarenjs/core/object';
import type { GmplPatternResult } from '@tangleai/gmpl';
import type { ResearchProject, ResearchReasoningConstraints, ResearchReasoningContext } from './contracts.gen.ts';
import type { ResearchTaskTools, ResearchStageName, ResearchStageOperation, ResearchStageAccess } from './index.ts';
import type { ResearchReasoningPolicy, ResearchReasoningRuntime, ResearchModelStage } from './reasoning-contract.ts';
import type { ResearchProviderHost } from './adapters/runtime.ts';
import { jsonArtifact } from './adapters/runtime.ts';
import { immutableResearchJson, researchRevisionOf } from './identity.ts';
import { researchFail, researchProjectHash, researchValue } from './workflow-contract.ts';
import { researchArtifacts } from './domain.ts';
import { researchReasoningRevisionOf } from './reasoning-contract.ts';
import { readResearchReasoningInputs, RESEARCH_REASONING_MEDIA_TYPE } from './reasoning-records.ts';
import { createResearchSynthesis } from './stages/synthesis.ts';
import { createResearchHypotheses } from './stages/hypothesis.ts';
import { createResearchDesign, checkResearchDesignPaths } from './stages/design.ts';
import { executeResearchNovelty, createResearchNoveltyPlan } from './stages/novelty.ts';
import { validateResearchShape } from './schema.ts';

export async function createResearchReasoningTools(base: ResearchTaskTools, options: { project: ResearchProject;
  policy: ResearchReasoningPolicy; provider: ResearchProviderHost; searxngBaseUrl?: string;
  /** Explicit capabilities supplied by a host which executes the generated frozen plan. */
  generatedStages?: readonly ResearchStageName[];
}): Promise<ResearchTaskTools> {
  const { provider, ...data } = options, pinned = immutableResearchJson(data), policy = pinned.policy;
  const projectHash = await researchProjectHash(pinned.project), revision = await researchReasoningRevisionOf(policy);
  if (base.binding.promptRevision !== researchArtifacts.revision
    || !base.binding.toolVersions.some(row => row.name === 'research-reasoning' && row.version === revision)
    || base.contract.projectId !== pinned.project.id)
    researchFail('TRSH1002', '/reasoning', 'Model stages must be pinned to their prompt catalog, policy and project.');
  const bounds = immutableResearchJson({ contract: base.contract, plan: base.plan, budget: pinned.project.budget });
  researchValue(checkResearchDesignPaths(bounds.plan.inputPaths, bounds.plan.inputPaths));
  const host = { ...provider, licence: immutableResearchJson(provider.licence) };
  async function visible(op: ResearchStageOperation, access: ResearchStageAccess) {
    if (op.frame.projectHash !== projectHash) researchFail('TRSH1004', '/projectHash', 'Reasoning project differs from the pinned native root.');
    return readResearchReasoningInputs(op, access, policy.maxCards);
  }
  const reasoning: ResearchReasoningRuntime = { policy,
    async retainLiteratureInputs(op, access) {
      const inputs = await visible(op, access), required = new Set([...inputs.cards.map(card => card.artifactId),
        ...bounds.contract.datasets.map(dataset => 'art-' + dataset.sha256)]);
      const refs = [];
      for (const ref of op.frame.artifacts) {
        if (required.has(ref.artifactId)) { refs.push(ref); continue; }
        if ((await access.describeArtifact(ref)).mediaType !== 'application/json') continue;
        const record = JSON.parse(new TextDecoder().decode(await access.readArtifact(ref))) as { kind?: string };
        if (record.kind === 'discovery-records') refs.push(ref);
      }
      // Original provider artifacts remain in immutable receipts and the reviewed gate.
      // Future stages carry the admitted record envelope and source/dataset bytes they read.
      return refs;
    },
    async prepare(op, access) {
      const inputs = await visible(op, access), stage = op.stage as ResearchModelStage;
      if (stage !== 'synthesis' && !inputs.synthesis) researchFail('TRSH1003', '/synthesis', 'Hypothesis and design stages require their committed synthesis.');
      if (stage === 'design' && inputs.hypotheses.length < 2) researchFail('TRSH1003', '/hypotheses', 'Design requires its committed hypothesis alternatives.');
      const constraints: ResearchReasoningConstraints = { baselineIds: bounds.contract.requiredBaselines.map(row => row.condition),
        metrics: bounds.contract.metrics, budget: bounds.budget, inputPaths: bounds.plan.inputPaths,
        ...(stage === 'design' ? { design: { contract: bounds.contract, plan: bounds.plan } } : {}) };
      const evidence = inputs.cards.map(card => ({ id: card.id, digest: card.contentHash, text: card.excerpt }));
      const context: ResearchReasoningContext = { stage, synthesis: stage === 'synthesis' ? null : inputs.synthesis,
        hypotheses: stage === 'design' ? inputs.hypotheses : [], constraints };
      return { variables: { question: pinned.project.question, cards: evidence,
        synthesis: stage === 'design' ? inputs.hypotheses : context.synthesis, constraints },
        input: { caseId: op.attemptId, query: pinned.project.question, evidence, payload: context as unknown as Record<string, unknown> } };
    },
    async complete(op, access, output, spend, admitPlan) {
      const inputs = await visible(op, access);
      let proposal = output;
      if (policy.mode === 'debate' && op.stage !== 'design') {
        const result = output as GmplPatternResult;
        if (result.disposition !== 'completed') researchFail('TRSH1009', '/disposition', 'Reasoning did not produce a completed evidence-bound proposal.');
        try { proposal = JSON.parse(result.answer); }
        catch { researchFail('TRSH1001', '/answer', 'The final native reasoning answer must contain the research proposal JSON.'); }
      }
      const records: import('./records.ts').ResearchRecordWrite[] = [], artifacts = [];
      let preregistration: import('./handlers.ts').ResearchStageResult['preregistration'];
      if (op.stage === 'synthesis') records.push({ kind: 'Synthesis', value: researchValue(await createResearchSynthesis(
        op.frame.projectId, pinned.project.question, proposal, inputs.cards)) });
      else if (op.stage === 'hypothesis') {
        if (!inputs.synthesis) researchFail('TRSH1003', '/synthesis', 'A hypothesis proposal requires a committed synthesis.');
        const generated = researchValue(await createResearchHypotheses(inputs.synthesis, proposal, inputs.cards,
          bounds.contract.requiredBaselines.map(row => row.condition), policy.mode));
        records.push(...generated.hypotheses.map(value => ({ kind: 'ResearchHypothesis' as const, value })), { kind: 'HypothesisSet', value: generated.set });
        const novelty = await executeResearchNovelty(generated.set, policy.novelty, inputs.literature,
          { provider: host, admitPlan, ...(pinned.searxngBaseUrl ? { searxngBaseUrl: pinned.searxngBaseUrl } : {}) }, access.signal);
        records.push({ kind: 'NoveltyReport', value: novelty.report });
        artifacts.push(jsonArtifact(novelty.plan), ...novelty.artifacts);
      } else if (op.stage === 'design') {
        preregistration = researchValue(await createResearchDesign(op.frame.projectId, proposal, inputs.hypotheses, bounds));
        artifacts.push(jsonArtifact(preregistration));
      } else researchFail('TRSH1004', '/stage', 'This is not a model reasoning stage.');
      artifacts.push({ ...jsonArtifact({ kind: 'reasoning-records', pivot: op.frame.pivot + (op.stage === 'synthesis' ? 1 : 0), value: records }),
        mediaType: RESEARCH_REASONING_MEDIA_TYPE }, jsonArtifact({ kind: 'reasoning-proposal', stage: op.stage, proposal,
        visibleCards: inputs.cards.map(card => card.id), availableCards: inputs.availableCards }));
      return { artifacts, records, spend, ...(preregistration ? { preregistration } : {}) };
    },
  };
  const execute = base.execute, verify = base.verify;
  return { ...base, reasoning,
    async execute(op, access) {
      if (['execute', 'analyze', 'decide', 'write', 'verify'].includes(op.stage) && !pinned.generatedStages?.includes(op.stage))
        researchFail('TRSH1007', '/stage/' + op.stage, 'The host has not bound this downstream stage to the generated frozen plan.');
      return execute(op, access);
    },
    async verify(op, result, access) {
      if (['synthesis', 'hypothesis', 'design'].includes(op.stage)) {
        const inputs = await visible(op, access);
        const envelopes = result.artifacts.filter(row => row.mediaType === 'application/json')
          .map(row => JSON.parse(new TextDecoder().decode(row.bytes))).filter(row => row.kind === 'reasoning-proposal');
        if (envelopes.length !== 1 || envelopes[0].stage !== op.stage
          || !equalsJson(envelopes[0].visibleCards, inputs.cards.map(card => card.id)) || envelopes[0].availableCards !== inputs.availableCards)
          researchFail('TRSH1005', '/proposal', 'Verification requires the exact proposal and visible evidence census.');
        const proposal = envelopes[0].proposal;
        if (op.stage === 'design') {
          const expected = researchValue(await createResearchDesign(op.frame.projectId, proposal, inputs.hypotheses, bounds));
          if (!equalsJson(expected, result.preregistration) || result.records.length)
            researchFail('TRSH1009', '/preregistration', 'Frozen design differs from independent proposal verification.');
        } else if (op.stage === 'synthesis') {
          const value = researchValue(await createResearchSynthesis(op.frame.projectId, pinned.project.question, proposal, inputs.cards));
          if (!equalsJson(result.records, [{ kind: 'Synthesis', value }])) researchFail('TRSH1005', '/records', 'Synthesis records differ from their proposal.');
        } else {
          if (!inputs.synthesis) researchFail('TRSH1003', '/synthesis', 'Hypothesis verification requires its admitted synthesis.');
          const generated = researchValue(await createResearchHypotheses(inputs.synthesis, proposal, inputs.cards,
            bounds.contract.requiredBaselines.map(row => row.condition), policy.mode));
          const expected = [...generated.hypotheses.map(value => ({ kind: 'ResearchHypothesis', value })), { kind: 'HypothesisSet', value: generated.set }];
          if (!equalsJson(result.records.slice(0, -1), expected)) researchFail('TRSH1005', '/records', 'Hypothesis records differ from their proposal.');
          const record = result.records.at(-1);
          if (record?.kind !== 'NoveltyReport') researchFail('TRSH1003', '/novelty', 'Hypotheses require their non-gating query coverage report.');
          researchValue(validateResearchShape('NoveltyReport', record.value));
          const { id, ...report } = record.value, plan = await createResearchNoveltyPlan(generated.set, policy.novelty);
          if (id !== 'novelty-' + await researchRevisionOf(report) || report.queryPlanId !== plan.id
            || report.hypothesisSetId !== generated.set.id || report.projectId !== op.frame.projectId
            || report.receipt.queryPlanId !== plan.id || report.receipt.projectId !== op.frame.projectId
            || !equalsJson(report.advisory, generated.set.advisory) || report.gating !== false
            || !equalsJson(report.receipt.outcomes.map(row => row.queryId), plan.queries.map(row => row.id))
            || !equalsJson(report.coverage, { total: plan.queries.length, attempted: report.receipt.outcomes.filter(row => row.attempts > 0).length,
              complete: report.receipt.outcomes.filter(row => row.state === 'complete').length })
            || report.overlapLiteratureIds.some(id => !inputs.literature.some(row => row.id === id)))
            researchFail('TRSH1005', '/novelty', 'Novelty report does not bind its hypothesis queries, coverage and advisory.');
        }
        const records = result.artifacts.filter(row => row.mediaType === RESEARCH_REASONING_MEDIA_TYPE);
        if (records.length !== 1 || !equalsJson(JSON.parse(new TextDecoder().decode(records[0].bytes)),
          { kind: 'reasoning-records', pivot: op.frame.pivot + (op.stage === 'synthesis' ? 1 : 0), value: result.records }))
          researchFail('TRSH1005', '/records', 'The admitted reasoning artifact must contain the exact verified records.');
        return { valid: true, value: null };
      }
      return verify(op, result, access);
    },
  };
}
