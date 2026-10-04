import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectBranch, type ResearchBranchSelectionRule } from '@tangleai/research';
import { analysisFixture } from './analysis-fixtures.ts';
import { checked } from './fixtures.ts';

test('best-of-N retains the frozen selector, every candidate and all failed-candidate costs', async () => {
  const first = await analysisFixture('success', 5, 'first-branch'), second = await analysisFixture('success', 5, 'second-branch');
  const selection = checked(await selectBranch([first, second].map(f => ({ analysis: f.analysis, branches: [f.input.branch] })), first.contract));
  assert.deepEqual(selection.rule, { kind: 'best-of-n', n: 3, selector: 'preregistered-metric' });
  assert.equal(selection.candidates.length, 2); assert.equal(selection.totalCost.physical, 20);
  assert.equal(selection.selectedBranchId, 'first-branch');
});
test('an absent rule, too many branches and review-score selection are refused', async () => {
  const f = await analysisFixture(), candidates = [{ analysis: f.analysis, branches: [f.input.branch] }];
  const absent = { ...f.contract }; delete absent.branchSelectionRule;
  const invalid: ResearchBranchSelectionRule = {
    kind: 'best-of-n', n: 1,
    // @ts-expect-error Review scores cannot be a scientific selector.
    selector: 'review-score',
  };
  for (const result of [await selectBranch(candidates, absent), await selectBranch(candidates, { ...f.contract, branchSelectionRule: invalid }),
    await selectBranch([...candidates, ...candidates], { ...f.contract, branchSelectionRule: { kind: 'single' } })]) {
    assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TRSH1006');
  }
});
