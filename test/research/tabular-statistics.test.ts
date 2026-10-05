import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { mean, variance, stddev } from '@jarenjs/core/stats';
import { createFixtureExecutor, createTabularStatisticsEvaluator, parseTabularSamples, tabularStatistics,
  researchObservationSignature, researchRevisionOf, type TabularSample } from '@tangleai/research';
import { tabularStatisticsFixtureFiles, loadTabularStatisticsFixture } from '../../benchmark/lib/research-tabular-fixture.ts';
import { tabularFixture } from './tabular-fixtures.ts';
import { checked } from './fixtures.ts';

test('seeded CSVs and every pinned domain member regenerate byte-identically and load twice without mutation', async () => {
  const files = await tabularStatisticsFixtureFiles(), repeat = await tabularStatisticsFixtureFiles();
  assert.deepEqual(files, repeat); assert.equal(files.size, 10);
  for (const [path, bytes] of files) assert.deepEqual(await readFile('benchmark/fixtures/research/' + path), Buffer.from(bytes), path);
  assert.deepEqual(await loadTabularStatisticsFixture(), await loadTabularStatisticsFixture());
});
test('independent paired statistics retain positive, exact-null, negative and threshold-failure topics', async () => {
  const loaded = await loadTabularStatisticsFixture(), results = [];
  for (const topic of loaded.topics) {
    const rows = checked(parseTabularSamples(loaded.datasets[topic.contract.datasets[0].id]));
    const summary = checked(tabularStatistics(rows, 17753));
    const a = rows.filter(row => row.group === 'A').map(row => row.value), b = rows.filter(row => row.group === 'B').map(row => row.value);
    assert.equal(summary.meanA, mean(a)); assert.equal(summary.meanB, mean(b));
    assert.equal(summary.sampleVarianceA, variance(a)); assert.equal(summary.sampleStddevB, stddev(b));
    assert.equal(summary.interval.quantile, 'nearest-rank'); assert.equal(summary.interval.resamples, 2000);
    assert.deepEqual(checked(tabularStatistics([...rows].reverse(), 17753)), summary);
    results.push(summary.interval.lower > topic.hypothesis.delta);
  }
  assert.deepEqual(results, [true, false, false, false]);
});
test('registry observations bind evaluator version, unit, direction and the independently reproduced raw samples', async () => {
  const f = await tabularFixture(), result = checked(await f.executor.run(f.manifest, f.workspace, f.context));
  const input = { ...f, result }, observations = checked(await f.registry.evaluate(input));
  assert.equal(observations.length, 1); const row = observations[0];
  assert.equal(row.evaluatorId, 'tabular-statistics/v1'); assert.equal(row.evaluatorVersion, '1');
  assert.equal(row.unit, 'points'); assert.equal(row.direction, 'maximize');
  assert.equal(row.registrySignature, await researchObservationSignature(row));
  assert.deepEqual(checked(await f.registry.registerObservations(input, observations)), observations);
  for (const kind of ['wrong-unit', 'undeclared-metric', 'hardcoded-number', 'wrong-direction', 'missing-direction'] as const) {
    const proposed = structuredClone(observations), changed = proposed[0];
    if (kind === 'wrong-unit') changed.unit = 'percent';
    if (kind === 'undeclared-metric') changed.metric = 'accuracy';
    if (kind === 'hardcoded-number') changed.value += 1;
    if (kind === 'wrong-direction') changed.direction = 'minimize';
    if (kind === 'missing-direction') delete changed.direction;
    changed.registrySignature = await researchObservationSignature(changed);
    changed.id = 'metric-' + await researchRevisionOf({ experimentRunId: changed.experimentRunId, registrySignature: changed.registrySignature });
    const refused = await f.registry.registerObservations(input, proposed);
    assert.equal(refused.valid, false, kind); if (!refused.valid) assert.equal(refused.issues[0].code, 'TRSH1006', kind);
  }
});
test('fabricated raw values and scalar metric files never enter the registry', async () => {
  const f = await tabularFixture();
  for (const kind of ['wrong-unit', 'hardcoded-number', 'duplicate', 'wrong-hash', 'scalar-file'] as const) {
    const executor = createFixtureExecutor({ [f.manifest.programId!]: async input => {
      if (kind === 'scalar-file') return { kind: 'files', files: [{ path: 'metrics.json', content: '{"meanDifference":99}' }] };
      const output = structuredClone(await f.programs[f.manifest.programId!](input));
      assert.equal(output.kind, 'tabular'); if (output.kind !== 'tabular') throw Error('Wrong raw fixture');
      if (kind === 'wrong-unit') output.rows[0].unit = 'percent';
      if (kind === 'hardcoded-number') output.rows[0].value += 1;
      if (kind === 'duplicate') output.rows[0] = structuredClone(output.rows[1]);
      if (kind === 'wrong-hash') output.datasetSha256 = '0'.repeat(64);
      return output;
    } }, { now: () => 0 });
    const result = checked(await executor.run(f.manifest, f.workspace, f.context));
    const refused = await f.registry.evaluate({ ...f, result });
    assert.equal(refused.valid, false, kind);
    if (!refused.valid) assert.equal(refused.issues[0].code, kind === 'scalar-file' ? 'TRSH1005' : kind === 'wrong-unit' ? 'TRSH1006' : 'TRSH1002', kind);
  }
});
test('CSV admission refuses malformed, unpaired, duplicate and nonfinite samples', async () => {
  const f = await tabularFixture(), csv = f.fixture.datasets[f.contract.datasets[0].id];
  for (const bad of [csv.replace('pairId', 'pair'), csv.replace(',points', ',percent'), csv.replace(',points', ',points,extra'),
    csv.trimEnd().split('\n').slice(0, -1).join('\n'), csv.replace(/,A,\d+,/, ',A,NaN,'), csv + csv.split('\n')[1] + '\n'])
    assert.equal(parseTabularSamples(bad).valid, false, bad.slice(0, 100));
  assert.equal(tabularStatistics(null as unknown as TabularSample[], 1).valid, false);
  assert.equal(tabularStatistics([], 1).valid, false);
  assert.equal(tabularStatistics(checked(parseTabularSamples(csv)), -1).valid, false);
});
test('the read-only evaluator captures source CSV bytes before the caller can replace them', async () => {
  const f = await tabularFixture(), datasets = { ...f.fixture.datasets }, evaluator = createTabularStatisticsEvaluator({ datasets });
  datasets[f.contract.datasets[0].id] = 'poison';
  const result = checked(await f.executor.run(f.manifest, f.workspace, f.context));
  const observed = await evaluator.evaluate({ rawOutput: result.run.output!, contract: f.contract, plan: f.plan, manifest: f.manifest, hiddenLabels: null });
  assert.equal(observed.valid, true, JSON.stringify(observed));
});
