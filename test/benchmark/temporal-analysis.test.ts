import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTemporalPairs, evaluateTemporalCosts, decideTemporalDefault, type TemporalPairScore } from '../../benchmark/lib/temporal-analysis.ts';
import { LME_TYPES } from '../../benchmark/lib/longmemeval.ts';
const identities = [{ id: 'a', group: 'same' }, { id: 'b', group: 'same' }, { id: 'c', group: 'other' }];
const pair = (control: number, treatment: number) => analyzeTemporalPairs(identities.map(r => ({ ...r, control, treatment })), identities);
const arm = { coldProviderUsd: 1, prepareProviderUsdPerScope: .5, queryProviderUsdPerQuery: .5, warmP95Ms: 1, observedQueries: 100, hostIdentity: 'same-host', workloadIdentity: 'same-workload' };
const costs = { control: arm, treatment: arm, totalProviderUsd: 2, approvedCeilings: { absoluteUsd: 2, zeroControl: null } };
test('independent paired wins, ties and losses have exact deterministic intervals with group pairing preserved', () => {
  for (const [control, treatment, delta] of [[0, 1, 1], [1, 1, 0], [1, 0, -1]]) {
    const result = pair(control, treatment); assert.equal(result.delta, delta); assert.equal(result.low, delta); assert.equal(result.high, delta);
    assert.equal(result.groups, 2); assert.equal(result.pairedQuestions, 3); assert.equal(result.resamples, 10000); assert.deepEqual(result, pair(control, treatment));
  }
  const mixed: TemporalPairScore[] = identities.map((r, i) => ({ ...r, control: 0, treatment: i < 2 ? 1 : 0 }));
  const measured = analyzeTemporalPairs(mixed, identities); assert.equal(measured.delta, 2 / 3); assert.equal(measured.low, 0); assert.equal(measured.high, 1);
  assert.deepEqual(measured, analyzeTemporalPairs([...mixed].reverse(), identities));
});
test('missing, duplicate, foreign-group and empty comparisons cannot create a positive default claim', () => {
  assert.equal(analyzeTemporalPairs([], identities).complete, false); assert.equal(analyzeTemporalPairs([], []).low, null);
  assert.equal(analyzeTemporalPairs(identities.map(r => ({ ...r, control: null, treatment: 1 })), identities).status, 'unmeasured');
  assert.throws(() => analyzeTemporalPairs([{ ...identities[0], control: 0, treatment: 1 }, { ...identities[0], control: 0, treatment: 1 }], identities), /duplicate/);
  assert.throws(() => analyzeTemporalPairs([{ id: 'a', group: 'forged', control: 0, treatment: 1 }], identities), /unregistered/);
});
test('undefined or missing costs cannot pass, and matching ceilings include the labelled amortization and host identity', () => {
  assert.equal(evaluateTemporalCosts(null).passed, false); assert.equal(evaluateTemporalCosts(costs).passed, true);
  assert.equal(evaluateTemporalCosts({ ...costs, control: { ...arm, coldProviderUsd: 0 } }).passed, false);
  assert.equal(evaluateTemporalCosts({ ...costs, treatment: { ...arm, warmP95Ms: 2.01 } }).passed, false);
  assert.equal(evaluateTemporalCosts({ ...costs, treatment: { ...arm, queryProviderUsdPerQuery: 2 } }).passed, false);
  assert.equal(evaluateTemporalCosts({ ...costs, treatment: { ...arm, hostIdentity: 'other' } }).passed, false);
  assert.equal(evaluateTemporalCosts({ ...costs, control: { ...arm, coldProviderUsd: 0 }, approvedCeilings: { absoluteUsd: 2, zeroControl: { coldProviderUsd: 1, amortizedProviderUsdPerQuery: 1, warmP95Ms: 1 } } }).passed, true);
});
test('a temporal gain cannot hide other-type regression, absent LoCoMo coverage, scripted provenance or strict failures', () => {
  const analyses = Object.fromEntries([...LME_TYPES.map(t => [`longmemeval:${t}`, t === 'temporal-reasoning' ? pair(0, 1) : pair(1, 1)]), ...[1, 2, 3, 4].map(c => [`locomo:${c}`, pair(1, 1)])]);
  const input = { analyses, costs, strictPlanned: 138, strictPassed: 138, violations: 0, origin: 'live' as const, profile: 'provided-history' as const, confirmation: true };
  assert.equal(decideTemporalDefault(input).default, 'eligible');
  assert.equal(decideTemporalDefault({ ...input, origin: 'scripted' }).default, 'off');
  assert.equal(decideTemporalDefault({ ...input, strictPassed: 137 }).default, 'off');
  assert.equal(decideTemporalDefault({ ...input, analyses: { ...analyses, 'longmemeval:knowledge-update': pair(1, 0) } }).default, 'off');
  const { 'locomo:4': _, ...missing } = analyses; assert.equal(decideTemporalDefault({ ...input, analyses: missing }).default, 'off');
  assert.equal(decideTemporalDefault({ ...input, profile: 'strict-as-of' }).default, 'off');
});
