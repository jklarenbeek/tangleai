import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createResearchSynthesis, createResearchHypotheses, validateResearchShape, researchRevisionOf } from '@tangleai/research';
import { checked, project } from './fixtures.ts';
import { reasoningFixture } from './reasoning-fixtures.ts';

it('synthesis and competing hypotheses use only existing cards and owner-computed immutable identities', async () => {
  const f = await reasoningFixture();
  assert.ok(validateResearchShape('Synthesis', f.synthesis).valid);
  for (const hypothesis of f.hypotheses) {
    assert.ok(validateResearchShape('ResearchHypothesis', hypothesis).valid);
    assert.ok(hypothesis.evidenceIds.length && hypothesis.evidenceIds.every(id => f.cards.some(card => card.id === id)));
    const { hypothesisHash, ...body } = hypothesis;
    assert.equal(hypothesisHash, await researchRevisionOf(body));
  }
  assert.deepEqual(checked(await createResearchSynthesis(project().id, project().question, f.synthesisProposal, f.cards)), f.synthesis);
  assert.deepEqual(checked(await createResearchHypotheses(f.synthesis, f.hypothesisProposal, f.cards, ['control'], 'single-agent')),
    { hypotheses: f.hypotheses, set: f.set });
  assert.ok(Object.isFrozen(f.set));
});
it('an unknown evidence card is a typed refusal even when the proposal is schema-valid', async () => {
  const f = await reasoningFixture(), proposal = structuredClone(f.hypothesisProposal);
  proposal.hypotheses[0].evidenceIds = ['unknown-card'];
  const result = await createResearchHypotheses(f.synthesis, proposal, f.cards, ['control'], 'single-agent');
  assert.ok(!result.valid); assert.equal(result.issues[0].code, 'TRSH1003');
  assert.equal(result.issues[0].path, '/hypotheses/0/evidenceIds/0');
  const synthesis = await createResearchSynthesis(project().id, project().question, { ...f.synthesisProposal, evidenceIds: ['unknown-card'] }, f.cards);
  assert.ok(!synthesis.valid); assert.equal(synthesis.issues[0].code, 'TRSH1003');
});
it('copied proposals and identical prediction/disconfirmation do not count as alternatives', async () => {
  const f = await reasoningFixture();
  for (const proposal of [
    { ...f.hypothesisProposal, hypotheses: [f.hypothesisProposal.hypotheses[0], f.hypothesisProposal.hypotheses[0]] },
    { ...f.hypothesisProposal, hypotheses: f.hypothesisProposal.hypotheses.map(h => ({ ...h, disconfirmingObservation: h.predictedObservation })) },
  ]) {
    const result = await createResearchHypotheses(f.synthesis, proposal, f.cards, ['control'], 'debate');
    assert.ok(!result.valid); assert.equal(result.issues[0].code, 'TRSH1009');
  }
});
