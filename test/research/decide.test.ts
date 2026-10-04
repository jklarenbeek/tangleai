import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planResearchDecision, validateResearchDecision, selectBranch, type ResearchResultReview } from '@tangleai/research';
import { analysisFixture, type AnalysisCase } from './analysis-fixtures.ts';
import { checked } from './fixtures.ts';

const budget = { remaining: { calls: 10, tokens: 1000, ms: 100000, physical: 100 },
  nextAttempt: { calls: 1, tokens: 10, ms: 1000, physical: 10 }, nextPivot: { calls: 3, tokens: 30, ms: 3000, physical: 30 } };
const review: ResearchResultReview = { reviewerIdentityId: 'independent-reviewer', findings: [], artifactIds: ['review-artifact'] };
async function fixture(kind: AnalysisCase = 'success') {
  const f = await analysisFixture(kind);
  const selection = checked(await selectBranch([{ analysis: f.analysis, branches: [f.input.branch] }], f.contract));
  const ledger = { attempt: 1, pivot: 1, selection };
  return { ...f, ledger, decision: structuredClone(checked(await planResearchDecision(f.analysis, f.contract, ledger, budget, review))) };
}
test('registered success, program bug, degenerate initializer, confound and negative take bounded declared edges', async () => {
  for (const [kind, edge, action] of [['success', 'Proceed', 'write'], ['bug', 'Refine', 'repair'], ['degenerate', 'Refine', 'repair'],
    ['confound', 'Pivot', 'pivot'], ['negative', 'Stop', 'none']] as const) {
    const f = await fixture(kind); assert.equal(f.decision.kind, edge, kind); assert.equal(f.decision.details!.action, action);
    assert.ok(Object.values(f.decision.details!.budgetEffect).every(value => value <= 0));
  }
});
test('a positive budget effect and proceeding with an unresolved critical finding are refused', async () => {
  const f = await fixture(); f.decision.details!.budgetEffect.calls = 1;
  let refused = validateResearchDecision(f.decision, f.analysis, f.contract, f.ledger, budget);
  assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TRSH1006');
  f.decision.details!.budgetEffect.calls = 0;
  f.decision.details!.reviewerFindings.push({ id: 'critical', origin: 'reviewer', disposition: 'unresolved', critical: true,
    reason: 'The comparison requires an independent check.', citations: [{ id: 'analysis', digest: 'a'.repeat(64) }] });
  refused = validateResearchDecision(f.decision, f.analysis, f.contract, f.ledger, budget);
  assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TRSH1006');
  const stopped = checked(await planResearchDecision(f.analysis, f.contract, f.ledger, budget, { ...review, findings: f.decision.details!.reviewerFindings }));
  assert.equal(stopped.kind, 'Stop'); assert.deepEqual(stopped.details!.reviewerFindings, f.decision.details!.reviewerFindings);
});
test('caps and exhausted grants produce explicit Stop decisions without widening the budget', async () => {
  const f = await fixture('bug');
  assert.equal(checked(await planResearchDecision(f.analysis, f.contract, { ...f.ledger, attempt: f.contract.attemptCap }, budget, review)).kind, 'Stop');
  assert.equal(checked(await planResearchDecision(f.analysis, f.contract, f.ledger, { ...budget, remaining: { calls: 0, tokens: 0, ms: 0, physical: 0 } }, review)).kind, 'Stop');
});

test('a supported result stops when its next writing path cannot fit the remaining grant', async () => {
  const f = await fixture();
  const stopped = checked(await planResearchDecision(f.analysis, f.contract, f.ledger,
    { ...budget, remaining: { calls: 0, tokens: 0, ms: 0, physical: 0 } }, review));
  assert.equal(stopped.kind, 'Stop'); assert.match(stopped.reason, /grant/);
});
