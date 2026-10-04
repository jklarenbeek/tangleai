import { canonicalizeJson } from '@jarenjs/json/canonical';
import { createResearchBinding, initialResearchFrame, prepareResearchWorkflow, researchWritingRevisionOf, createResearchWritingTools,
  researchDraftProposal, type ResearchWritingPolicy, type ResearchTaskTools, type ResearchClaimLedger } from '@tangleai/research';
import type { MasHostBindings } from '@tangleai/mas';
import type { ResearchStore } from '../../packages/research/src/store.ts';
import { researchExampleIdentity, researchExampleLimits } from '../../examples/research.ts';
import { analysisWorkflowFixture, analysisWorkflowTools, analysisReviewClient } from './analysis-workflow-fixtures.ts';
import { reasoningFixture } from './reasoning-fixtures.ts';

export async function writingWorkflowFixture(mode: ResearchWritingPolicy['mode'] = 'agent') {
  const f = await analysisWorkflowFixture(), literature = await reasoningFixture(), identity = await researchExampleIdentity();
  const writingPolicy: ResearchWritingPolicy = { mode, modelIdentity: identity.identityId, maxCards: 64, maxClaims: 128, maxViewChars: 50000 };
  const project = { ...f.project, budget: { calls: 500, tokens: 100000, ms: 600000, physical: 600 } };
  const limits = { ...researchExampleLimits, calls: 500, tokens: 100000, contextChars: 200000, traceBytes: 8000000 };
  const binding = await createResearchBinding(f.contract, { identity, promptRevision: f.binding.promptRevision, evaluator: f.binding.evaluator,
    toolVersions: [...f.binding.toolVersions, { name: 'research-writing', version: await researchWritingRevisionOf(writingPolicy) }],
    reservation: { calls: 57, tokens: 10000, ms: 10000, physical: 57 } });
  const prepared = await prepareResearchWorkflow(f.contract, { binding, profile: 'research-scripted', limits,
    execution: f.policy, analysis: f.analysisPolicy, writing: writingPolicy });
  return { ...f, literature, writingPolicy, project, limits, binding, prepared, frame: await initialResearchFrame(project, f.plan, binding) };
}
export async function writingWorkflowTools(f: Awaited<ReturnType<typeof writingWorkflowFixture>>, base: ResearchTaskTools, store: ResearchStore) {
  const execute = base.execute, verify = base.verify;
  const withCards: ResearchTaskTools = { ...base, async execute(operation, access) {
    const result = await execute(operation, access);
    if (operation.stage === 'discovery') {
      const records = [{ kind: 'LiteratureRecord' as const, value: f.literature.literature }, ...f.literature.cards.map(value => ({ kind: 'EvidenceCard' as const, value }))];
      result.records.push(...records); result.artifacts.push({ bytes: f.literature.source, mediaType: 'text/plain' },
        { bytes: new TextEncoder().encode(canonicalizeJson({ kind: 'discovery-records', value: records })), mediaType: 'application/json' });
    }
    return result;
  }, verify(operation, result, access) {
    return verify(operation, operation.stage === 'discovery' ? { ...result, artifacts: result.artifacts.slice(0, 1), records: [] } : result, access);
  } };
  return createResearchWritingTools(await analysisWorkflowTools(f, withCards, store), { policy: f.writingPolicy });
}
export function writingReviewClient(options: { critical?: boolean; invalidWriter?: boolean; observe?: (role: string, request: unknown) => void } = {}): NonNullable<MasHostBindings['clientFor']> {
  const analysis = analysisReviewClient();
  return node => {
    if (node.role.startsWith('research-result-')) return analysis(node);
    return { endpoint: { provider: 'scripted' }, async complete(request) {
      options.observe?.(node.role, request);
      const messages = (request as { messages: Array<{ role: string; content: string }> }).messages;
      let output: unknown;
      if (node.role === 'research-writer') {
        const context = messages.find(row => row.content.includes('[research:ledger/'))!.content;
        const view = JSON.parse(context.slice(context.indexOf('\n', context.indexOf('[research:ledger/')) + 1)) as { ledger: ResearchClaimLedger };
        const proposal = researchDraftProposal(view.ledger);
        if (options.invalidWriter) proposal.sections[0].text = 'The candidate has 99% improvement.';
        output = proposal;
      } else {
        const prompt = messages.find(row => row.role === 'user')!.content;
        const evidence = JSON.parse(prompt.split('Admitted draft evidence:\n')[1].split(/\n(?:Prior assessment:|Review context:)/)[0]) as Array<{ id: string; digest: string }>;
        const context = JSON.parse(prompt.split('Review context:\n')[1]);
        const citations = evidence.map(({ id, digest }) => ({ id, digest }));
        const findings = [...context.findings ?? context.draft?.findings ?? context.proposal?.findings ?? []];
        if (options.critical && node.id.startsWith('reviewer-') && !findings.some(row => row.id === 'draft-concern-' + node.id)) findings.push({
          id: 'draft-concern-' + node.id, origin: node.id, critical: true, disposition: 'unresolved', reason: 'Retained independent draft concern.', citations });
        const result = { answer: 'Review the unchanged admitted draft.', disposition: 'completed', claims: [{ text: 'The draft and ledger are admitted.', citations }], findings };
        output = node.role.endsWith('peer-review-review') ? { result, assessment: options.critical ? 'reject' : 'accept', issues: [], strengths: [] }
          : node.role.endsWith('red-team-attack') ? { result, strategy: context.strategy }
            : node.role.endsWith('red-team-defense') ? { result, mitigations: [] }
              : node.role.endsWith('red-team-resilience') ? { result, resilience: 1, action: 'accept' } : { result };
      }
      return { message: { role: 'assistant', content: JSON.stringify(output) }, finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } };
    } };
  };
}
