import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { placeAblation } from '../../benchmark/lib/place-ablation.ts';
import { validatePlaceShape } from '../../benchmark/lib/place-validation.ts';
import type { Report } from '../../benchmark/lib/place-report.types.ts';

const report = JSON.parse(await readFile('benchmark/results/place.json', 'utf8')) as Report;

test('paired place losses remain beside gains and refusal subsets never inflate denominators', () => {
  const ablation = placeAblation(report);
  assert.equal(ablation.pairs.length, 21);
  for (const pair of ablation.pairs) {
    assert.equal(pair.wins + pair.losses + pair.ties, pair.paired);
    assert.equal(pair.paired + pair.unpaired, pair.questions);
    assert.ok(pair.refusedLeft <= pair.paired && pair.refusedRight <= pair.paired);
    assert.equal(pair.comparison, ['movement-distance', 'nearby', 'false-proximity'].includes(pair.kind) ? 'structural' : 'paired-exactness');
  }
  const temporal = ablation.pairs.find(pair => pair.left === 'meaning-time' && pair.right === 'meaning-only' && pair.kind === 'location-at-event')!;
  if (report.corpus.status === 'available') assert.deepEqual([temporal.wins, temporal.losses, temporal.ties], [40, 5, 11]);
  assert.deepEqual(report.ablation, ablation);
});

test('an unavailable place row stays unpaired and a different captured projection cannot be paired', t => {
  const copy = structuredClone(report), row = copy.rows.find(row => row.row === 'meaning-time-place' && row.backend === 'memory' && row.kind === 'location-at-event' && row.status === 'measured');
  if (!row) { t.skip('the optional source corpus is unavailable'); return; }
  row.status = 'unavailable'; row.actual = null; row.passed = null; row.detail = 'controlled unavailable adapter'; row.runtimeCoverage = null;
  for (const pair of placeAblation(copy).pairs.filter(pair => pair.left === 'meaning-time-place' && pair.kind === row.kind)) {
    assert.equal(pair.unpaired, 1); assert.equal(pair.paired, 55);
  }
  row.status = 'measured'; row.projectionId = '0'.repeat(64);
  assert.throws(() => placeAblation(copy), /projection differs/);
});

test('the closed report schema enforces paired partitions and refuses overlapping-refusal addition', () => {
  assert.equal(validatePlaceShape(report).valid, true);
  for (const mutate of [
    (copy: Report) => { copy.ablation.pairs[0].wins++; },
    (copy: Report) => { copy.ablation.pairs[0].unpaired++; },
    (copy: Report) => { copy.ablation.pairs[0].refusedLeft = copy.ablation.pairs[0].paired + 1; },
  ]) { const copy = structuredClone(report); mutate(copy); assert.equal(validatePlaceShape(copy).valid, false); }
  assert.ok(report.ablation.pairs.some(pair => pair.paired + pair.refusedLeft + pair.refusedRight > pair.questions));
});
