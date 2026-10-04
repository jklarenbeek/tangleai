/** Authored finite mechanism controls; no observed scientific result changes this registration. */
import { researchDraftProposal, type ResearchClaimLedger, type ResearchLicence } from '@tangleai/research';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import type { ResearchFixtureTopic, ResearchWritingRegistration } from './research.types.ts';

export function researchWritingRegistration(licence: ResearchLicence): ResearchWritingRegistration {
  return { id: 'research-writing-v1', licence,
    control: { id: 'positive-writing-control', topicId: 'kmeans-seeding', baseline: [10, 10, 10, 10, 10], candidate: [12, 13, 14, 15, 16],
      programIds: { baseline: 'writing-coordinate-control', candidate: 'writing-coordinate-candidate' }, evaluator: { id: 'writing-coordinate', version: '1' },
      metric: { id: 'coordinate', unit: 'raw-coordinate', direction: 'maximize' }, minImprovement: 1,
      source: 'benchmark/lib/research-writing.ts', topicPath: 'writing/control-topic.json', scriptPath: 'writing/control-script.json',
      reservation: { calls: 57, tokens: 32768, ms: 30000, physical: 57 },
      limits: { calls: 512, tokens: 524288, ms: 600000, toolRounds: 4, fanOut: 8, concurrency: 4, iterations: 8, contextChars: 200000, traceBytes: 8000000 },
      policy: { mode: 'agent', maxCards: 64, maxClaims: 128, maxViewChars: 50000 } },
    refusals: [
      { id: 'hallucinated-citation', source: 'bundles/invalid/hallucinated-citation.json', expectedCode: 'TRSH1003', expectedState: 'unresolved' },
      { id: 'inflated-claim', source: 'bundles/invalid/inflated-claim.json', expectedCode: 'TRSH1005', expectedState: 'unresolved' },
      { id: 'wrong-number', source: 'bundles/invalid/wrong-number.json', expectedCode: 'TRSH1002', expectedState: 'unresolved' },
      { id: 'missing-citation', source: 'bundles/invalid/missing-citation.json', expectedCode: 'TRSH1003', expectedState: 'unresolved' },
    ] };
}
/** A separately registered mechanism case; the three original scientific contracts stay unchanged. */
export async function researchWritingControlTopic(original: ResearchFixtureTopic, registration: ResearchWritingRegistration): Promise<ResearchFixtureTopic> {
  const topic = structuredClone(original), control = registration.control;
  if (topic.id !== control.topicId) throw Error('Writing control requires its registered source topic.');
  const { contractHash: _contractHash, ...contract } = topic.contract;
  contract.hypothesisSpace = ['The registered candidate coordinate exceeds the baseline in the scripted writing mechanism control.'];
  contract.metrics = [control.metric]; contract.successRule = { ...contract.successRule, metric: control.metric.id, minImprovement: control.minImprovement };
  contract.selectionRule = { ...contract.selectionRule, metric: control.metric.id };
  contract.branchSelectionRule = { kind: 'single' };
  contract.analysisPolicy = { seedBatchSize: contract.replicatePolicy.seeds.length, recoverProgramFailure: false, confoundAction: 'Stop', seedVariationChecks: [] };
  contract.requiredBaselines = [{ ...contract.requiredBaselines[0], programId: control.programIds.baseline, source: control.source }];
  topic.contract = { ...contract, contractHash: await canonicalSha256(contract) };
  const { planHash: _planHash, ...plan } = topic.plan;
  plan.contractHash = topic.contract.contractHash; plan.evaluator = control.evaluator;
  plan.hypothesisHash = await canonicalSha256(contract.hypothesisSpace);
  plan.conditions = plan.conditions.map(row => ({ ...row, programId: control.programIds[row.id as 'baseline' | 'candidate'], params: {} }));
  topic.plan = { ...plan, planHash: await canonicalSha256(plan) };
  return topic;
}
/** Response content is derived only from the actual request; gold never enters the client. */
export function researchWritingResponse(node: { role: string }, request: unknown): unknown {
  const messages = (request as { messages: Array<{ role: string; content: string }> }).messages;
  if (node.role === 'research-writer') {
    const context = messages.find(row => row.content.includes('[research:ledger/'))!.content;
    const view = JSON.parse(context.slice(context.indexOf('\n', context.indexOf('[research:ledger/')) + 1)) as { ledger: ResearchClaimLedger };
    return researchDraftProposal(view.ledger);
  }
  const prompt = messages.find(row => row.role === 'user')!.content;
  const evidence = JSON.parse(prompt.split('Admitted draft evidence:\n')[1].split(/\n(?:Prior assessment:|Review context:)/)[0]) as Array<{ id: string; digest: string }>;
  const context = JSON.parse(prompt.split('Review context:\n')[1]), citations = evidence.map(({ id, digest }) => ({ id, digest }));
  const result = { answer: 'Retain the unchanged draft and its deterministic evidence checks.', disposition: 'completed',
    claims: [{ text: 'The admitted draft and claim ledger are unchanged.', citations }], findings: [] };
  return node.role.endsWith('peer-review-review') ? { result, assessment: 'accept', issues: [], strengths: [] }
    : node.role.endsWith('red-team-attack') ? { result, strategy: context.strategy }
      : node.role.endsWith('red-team-defense') ? { result, mitigations: [] }
        : node.role.endsWith('red-team-resilience') ? { result, resilience: 1, action: 'accept' } : { result };
}
