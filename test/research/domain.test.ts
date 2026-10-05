import assert from 'node:assert/strict';
import { it } from 'node:test';
import { GMPL_LIMITS, type GmplInput, type GmplPatternResult } from '@tangleai/gmpl';
import { createResearchPatternHost, prepareResearchPattern, type ResearchReasoningContext } from '@tangleai/research';
import { prepareGmplExample } from '../../examples/gmpl.ts';
import { driveGmplWorkflow } from '../../benchmark/lib/gmpl-runner.ts';
import { reasoningFixture } from './reasoning-fixtures.ts';

async function fixture() {
  const f = await reasoningFixture(), host = await createResearchPatternHost('scripted-v1', { ...GMPL_LIMITS });
  const prepared = await prepareResearchPattern('hypothesis', host);
  const payload: ResearchReasoningContext = { stage: 'hypothesis', synthesis: f.synthesis, hypotheses: [],
    constraints: { baselineIds: ['control'], metrics: f.bounds.contract.metrics, inputPaths: f.bounds.plan.inputPaths, budget: f.bounds.budget } };
  const input: GmplInput = { caseId: 'research-domain-fixture', query: f.synthesis.question,
    evidence: f.cards.map(card => ({ id: card.id, digest: card.contentHash, text: card.excerpt })), payload: { ...payload } };
  const result: GmplPatternResult = { answer: 'Domain protocol fixture; proposal admission is tested separately.', disposition: 'completed',
    claims: [{ text: 'Fixture evidence is visible.', citations: input.evidence.map(({ id, digest }) => ({ id, digest })) }], findings: [] };
  return { prepared, input, result };
}
function reply(node: string, result: GmplPatternResult) {
  if (node.startsWith('position-')) return { result, stance: node };
  if (node.startsWith('rebuttal-')) return { result, addresses: ['position-1:claim-1'] };
  if (node === 'judge') return { result, action: 'accept' };
  return { result };
}
it('research and document-review preserve the same three-participant debate topology', async () => {
  const { prepared } = await fixture(), other = await prepareGmplExample('document-review', { pattern: 'structured-debate', participants: 3, maxRounds: 3 });
  const topology = (p: typeof prepared | typeof other) => [p.validated.workflow, ...p.snapshot.document.subgraphs.map(row => row.workflow)]
    .map(raw => { const workflow = raw as typeof p.validated.workflow;
      return { entry: workflow.entry, exit: workflow.exit, nodes: workflow.nodes.map(node => ({ id: node.id, kind: node.kind })),
        messages: workflow.messages.map(message => ({ from: message.from, to: message.to })) }; });
  assert.deepEqual(topology(prepared), topology(other)); assert.notEqual(prepared.materialized.domain.revision, other.materialized.domain.revision);
});
it('native participants execute Innovator, Pragmatist and Contrarian prompts before a separate synthesizer', async () => {
  const { prepared, input, result } = await fixture(), systems = new Map<string, string>();
  const driven = await driveGmplWorkflow(prepared, { input: { input }, bindings: prepared.bindings,
    response: (node, _invocation, phase, messages) => {
      if (phase === 'completion') systems.set(node, messages.filter(message => message.role === 'system').map(message => message.content).join('\n'));
      return reply(node, result);
    } });
  assert.equal(driven.status, 'completed', JSON.stringify(driven.trace.run.failure));
  for (const [i, name] of ['Innovator', 'Pragmatist', 'Contrarian'].entries()) {
    assert.match(systems.get('position-' + (i + 1))!, new RegExp(name));
    assert.match(systems.get('rebuttal-' + (i + 1))!, new RegExp(name));
  }
  assert.match(systems.get('synthesis')!, /separate hypothesis synthesizer/);
  assert.equal(driven.usage.roles, 8); assert.equal(driven.usage.physical, 16);
  assert.equal(driven.usage.normalization, 8); assert.equal(driven.usage.repair, 0);
});
it('research input is closed and refuses undeclared hidden context before any model request', async () => {
  const { prepared, input, result } = await fixture(); input.payload!.hiddenLabels = ['not-admitted'];
  const driven = await driveGmplWorkflow(prepared, { input: { input }, bindings: prepared.bindings, response: node => reply(node, result) });
  assert.equal(driven.status, 'failed'); assert.equal(driven.usage.physical, 0);
  assert.equal(driven.trace.run.failure!.error.cause?.code, 'TGMPL1001');
});
it('human guidance cannot smuggle a design proposal into a debate participant', async () => {
  const { prepared, input, result } = await fixture(), f = await reasoningFixture();
  (input.payload!.constraints as Record<string, unknown>).humanReview = {
    interventionId: 'design-authority-probe', text: 'Untrusted design payload.', proposal: f.designProposal };
  const driven = await driveGmplWorkflow(prepared, { input: { input }, bindings: prepared.bindings, response: node => reply(node, result) });
  assert.equal(driven.status, 'failed'); assert.equal(driven.usage.physical, 0);
  assert.equal(driven.trace.run.failure!.error.cause?.code, 'TGMPL1001');
});
it('participant context excludes design authority and its unused definitions before reference expansion', async () => {
  const { prepared, input, result } = await fixture(), f = await reasoningFixture();
  const payload = prepared.materialized.domain.payloadSchema as Record<string, unknown>;
  assert.doesNotMatch(JSON.stringify(payload), /"(?:ResearchDesignProposal|ResearchContract|ExperimentPlan|ResearchDesignMetadata)"/);
  (input.payload!.constraints as Record<string, unknown>).design = { contract: f.bounds.contract, plan: f.bounds.plan };
  const driven = await driveGmplWorkflow(prepared, { input: { input }, bindings: prepared.bindings, response: node => reply(node, result) });
  assert.equal(driven.status, 'failed'); assert.equal(driven.usage.physical, 0);
  assert.equal(driven.trace.run.failure!.error.cause?.code, 'TGMPL1001');
});
it('the synthesizer cannot cite a card that no participant could see and retains the native typed cause', async () => {
  const { prepared, input, result } = await fixture();
  const driven = await driveGmplWorkflow(prepared, { input: { input }, bindings: prepared.bindings,
    response: node => reply(node, node === 'synthesis' ? { ...result, claims: [{ text: 'Not visible', citations: [{ id: 'unseen-card', digest: 'f'.repeat(64) }] }] } : result) });
  assert.equal(driven.status, 'failed'); assert.equal(driven.trace.run.failure!.error.cause?.code, 'TGMPL1005');
  assert.equal(driven.trace.run.failure!.error.cause?.docPath, '/claims/0/citations/0');
  assert.equal(driven.usage.physical, 16);
});
