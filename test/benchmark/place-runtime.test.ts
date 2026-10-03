import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaceFixture } from '../../benchmark/lib/place-fixture.ts';
import { preparePlaceBaselines } from '../../benchmark/lib/place-baselines.ts';
import { placeRuntimeAdapters, runPlaceBackend } from '../../benchmark/lib/place-runtime.ts';
import { runPlaceConformance, placeContext } from '../../benchmark/lib/place-conformance.ts';

test('real place backends reproduce every frozen outcome under identical budgets and zero-write replay', async t => {
  const loaded = await loadPlaceFixture(), prepared = await preparePlaceBaselines(loaded);
  const context = await placeContext(loaded), adapters = await placeRuntimeAdapters(loaded, prepared);
  const report = await runPlaceConformance(context, adapters, prepared);
  const memory = report.rows.filter(row => row.row === 'meaning-time-place' && row.backend === 'memory');
  for (const backend of ['memory', 'node-sqlite', 'bun-sqlite']) {
    const rows = report.rows.filter(row => row.row === 'meaning-time-place' && row.backend === backend);
    assert.equal(rows.length, loaded.fixture.questions.length);
    assert.ok(rows.every(row => row.status !== 'failed' && row.status !== 'implementation-missing'));
    if (rows.every(row => row.status === 'unavailable')) { assert.ok(rows.every(row => row.detail)); continue; }
    for (const [i, row] of rows.entries()) {
      assert.equal(row.status, memory[i].status); assert.deepEqual(row.actual, memory[i].actual, row.questionId);
      assert.deepEqual(row.runtimeCoverage, memory[i].runtimeCoverage, row.questionId);
    }
    assert.deepEqual(rows.find(row => row.kind === 'false-proximity')!.actual, { ninecell: true, singlePrefix: false, gate: 'AI0230' });
  }
  if (loaded.corpus.status === 'available') assert.ok(memory.every(row => row.passed === true), JSON.stringify(memory.filter(row => !row.passed)));
  else t.diagnostic(loaded.corpus.detail);
  assert.equal(report.liveRequests, 0);
  const second = await placeRuntimeAdapters(loaded, prepared);
  assert.deepEqual(await runPlaceConformance(context, second, prepared), report);
  const { expected: _expected, ...question } = loaded.fixture.questions[0];
  await assert.rejects(adapters['meaning-time-place/memory']!({ ...question, text: 'altered input' }), /input identity differs/);
});

test('runtime labels are enforced by the actual executing process', async () => {
  await assert.rejects(runPlaceBackend(process.versions.bun ? 'node-sqlite' : 'bun-sqlite'), /runtime identity differs/);
});
