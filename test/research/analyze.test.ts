import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createResearchAnalysis, verifyResearchAnalysis } from '@tangleai/research';
import { researchPairedStatistic } from '../../benchmark/lib/research-statistics.ts';
import { analysisFixture } from './analysis-fixtures.ts';
import { checked } from './fixtures.ts';

test('analysis separates execution, movement, statistical evidence and practical significance', async () => {
  const { analysis } = await analysisFixture();
  assert.equal(analysis.execution.success, true); assert.equal(analysis.execution.completed, 10);
  assert.equal(analysis.metrics[0].mean, 20); assert.equal(analysis.metrics[1].mean, 3);
  assert.equal(analysis.metrics[1].sampleStddev, Math.sqrt(2.5)); assert.equal(analysis.metrics[1].median, 3);
  assert.equal(analysis.evidence.outcome, 'positive'); assert.equal(analysis.practical.met, true); assert.equal(analysis.support, 'supported');
});
test('one seed under a five-seed policy remains underpowered and missing statistics stay null', async () => {
  const { analysis } = await analysisFixture('success', 1);
  assert.equal(analysis.evidence.underpowered, true); assert.equal(analysis.evidence.n, 1);
  assert.deepEqual(analysis.evidence.missingSeeds, [2, 3, 4, 5]); assert.equal(analysis.support, 'inconclusive');
  assert.equal(analysis.metrics[0].sampleStddev, null);
  const empty = await analysisFixture('success', 0);
  assert.equal(empty.analysis.evidence.interval, null); assert.equal(empty.analysis.metrics[0].mean, null);
});
test('contradictory seeds retain an interval spanning zero and an inconclusive result', async () => {
  const { analysis } = await analysisFixture('contradictory');
  assert.ok(analysis.evidence.interval!.lower < 0 && analysis.evidence.interval!.upper > 0);
  assert.equal(analysis.support, 'inconclusive');
});
test('amended measurements are exploratory and hand-edited aggregates fail independent recomputation', async () => {
  const f = await analysisFixture(); f.input.exploratoryObservationIds = [f.input.observations[0].id];
  const analysis = structuredClone(checked(await createResearchAnalysis(f.input, researchPairedStatistic)));
  assert.equal(analysis.support, 'exploratory');
  analysis.metrics[1].mean = 0;
  const forged = await verifyResearchAnalysis(f.input, analysis, researchPairedStatistic);
  assert.equal(forged.valid, false); if (!forged.valid) assert.equal(forged.issues[0].code, 'TRSH1002');
});
test('zero variance is an honest negative unless an explicit frozen implementation check fails', async () => {
  const negative = (await analysisFixture('negative')).analysis;
  assert.equal(negative.support, 'not-supported'); assert.equal(negative.diagnostics.length, 0);
  const degenerate = (await analysisFixture('degenerate')).analysis;
  assert.equal(degenerate.support, 'inconclusive'); assert.equal(degenerate.diagnostics[0].kind, 'degenerate');
});
test('duplicate seed measurements and foreign registrations cannot change aggregates', async () => {
  const f = await analysisFixture(); f.input.observations.push(f.input.observations[0]);
  const duplicate = await createResearchAnalysis(f.input, researchPairedStatistic);
  assert.equal(duplicate.valid, false); if (!duplicate.valid) assert.equal(duplicate.issues[0].code, 'TRSH1006');
  f.input.observations.pop(); f.input.observations[0] = { ...f.input.observations[0], experimentRunId: 'foreign-run' };
  const foreign = await createResearchAnalysis(f.input, researchPairedStatistic);
  assert.equal(foreign.valid, false); if (!foreign.valid) assert.equal(foreign.issues[0].code, 'TRSH1005');
});

test('an injected interval cannot forge the independently recomputed paired estimate', async () => {
  const f = await analysisFixture();
  const result = await createResearchAnalysis(f.input, (pairs, options) => ({ ...researchPairedStatistic(pairs, options), estimate: 100 }));
  assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TRSH1002');
});
