import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { loadPlaceFixture } from '../../benchmark/lib/place-fixture.ts';
import { placeGateFixtures } from '../../benchmark/lib/place-oracle.ts';
import { runPlaceConformance, validatePlaceReport, renderPlaceReport, scorePlace, placeContext } from '../../benchmark/lib/place-conformance.ts';
import { preparePlaceBaselines } from '../../benchmark/lib/place-baselines.ts';

const loaded = await loadPlaceFixture();
const context = await placeContext(loaded);
const prepared = await preparePlaceBaselines(loaded);
const report = await runPlaceConformance(context, {}, prepared);

test('the independent oracle precedes scores, wrong controls fail and every spatial gate is exercised', () => {
  assert.ok(placeGateFixtures(loaded).every(g => g.passed));
  for (const control of loaded.fixture.wrongControls) assert.equal(scorePlace(loaded.fixture.questions.find(q => q.id === control.questionId)!.expected, control.actual), false);
  assert.ok(report.wrongControls.every(c => c.rejected));
  const oracle = report.rows.filter(r => r.row === 'oracle');
  if (loaded.corpus.status === 'available') assert.ok(oracle.every(r => r.passed === true));
  else assert.ok(oracle.some(r => r.status === 'unavailable'));
  assert.ok(report.rows.filter(r => r.row === 'meaning-time-place').every(r => r.status === 'implementation-missing' && r.passed === null));
});

test('place reports reconcile registered denominators and reject rehashed false successes', async () => {
  assert.equal(await validatePlaceReport(report, loaded), true);
  for (const mutate of [
    (r: typeof report) => { r.coverage.grounded++; },
    (r: typeof report) => { r.counts.passed++; },
    (r: typeof report) => { r.rows.pop(); },
    (r: typeof report) => { r.rows[0].actual = { entryId: 'invented' }; r.rows[0].passed = true; },
    (r: typeof report) => { r.rows[1].questionId = r.rows[0].questionId; },
    (r: typeof report) => { r.refusals.byCode.forged = 1; },
    (r: typeof report) => { r.rows[0].projectionId = '0'.repeat(64); },
    (r: typeof report) => { r.scale.targetP95Ms++; },
  ]) {
    const copy = structuredClone(report); mutate(copy); const { sha256: _, ...body } = copy; copy.sha256 = await canonicalSha256(body);
    assert.equal(await validatePlaceReport(copy, loaded), false);
  }
});

test('an oracle discrepancy refuses publication and adapters never receive expected answers', async t => {
  if (loaded.corpus.status === 'unavailable') { t.skip(loaded.corpus.detail); return; }
  let supplied = 0;
  await assert.rejects(runPlaceConformance(context, {
    'oracle/reference': async input => { assert.equal('expected' in input, false); supplied++; return { entryId: 'forged' }; },
    'meaning-only/memory': async () => ({ unavailable: 'isolated oracle refusal probe' }),
    'meaning-time/memory': async () => ({ unavailable: 'isolated oracle refusal probe' }),
  }, prepared), /place report refused/);
  assert.equal(supplied, loaded.fixture.questions.length);
});

test('failed and unavailable adapters remain counted and network attempts cannot become a zero-request report', async () => {
  const before = globalThis.fetch;
  const failed = await runPlaceConformance(context, {
    'meaning-time-place/memory': async () => { throw new Error('controlled adapter failure'); },
    'meaning-time-place/node-sqlite': async () => ({ unavailable: 'controlled missing runtime' }),
    'meaning-only/memory': async () => ({ unavailable: 'isolation of failure accounting' }),
    'meaning-time/memory': async () => ({ unavailable: 'isolation of failure accounting' }),
  }, prepared);
  assert.ok(failed.counts.failed > 0); assert.ok(failed.counts.unavailable > 0);
  assert.equal(failed.counts.planned, report.counts.planned);
  assert.equal(globalThis.fetch, before);
  await assert.rejects(runPlaceConformance(context, {
    'meaning-time-place/memory': async () => { await fetch('https://network-must-not-run.invalid'); return { entryId: 'unreachable' }; },
    'meaning-only/memory': async () => ({ unavailable: 'network guard probe' }),
    'meaning-time/memory': async () => ({ unavailable: 'network guard probe' }),
  }, prepared), /network guard observed/);
  assert.equal(globalThis.fetch, before);
});

test('keyless place execution is byte-identical and never touches the network', async () => {
  let calls = 0; const before = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error('network forbidden'); };
  try { assert.deepEqual(await runPlaceConformance(context, {}, prepared), report); }
  finally { globalThis.fetch = before; }
  assert.equal(calls, 0);
});

test('place committed report and document reproduce from current measured owner bytes', async t => {
  if (loaded.corpus.status === 'unavailable') { t.skip(loaded.corpus.detail); return; }
  const committed = JSON.parse(await readFile('benchmark/results/place.json', 'utf8')) as typeof report;
  assert.equal(await validatePlaceReport(committed, loaded), true);
  assert.deepEqual(committed.source.files, context.source.files);
  const reproduced = await runPlaceConformance({ ...context, source: committed.source }, {}, prepared);
  assert.equal(JSON.stringify(reproduced, null, 2) + '\n', await readFile('benchmark/results/place.json', 'utf8'));
  assert.equal(renderPlaceReport(reproduced), await readFile('docs/PLACE_BENCHMARK.md', 'utf8'));
});

test('an absent corpus keeps every registered row and cannot claim a verified oracle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'place-absent-'));
  try {
    const absent = await loadPlaceFixture({ corpusRoot: dir });
    const actual = await runPlaceConformance(await placeContext(absent));
    assert.equal(actual.corpus.status, 'unavailable');
    assert.equal(actual.counts.planned, report.counts.planned);
    assert.ok(actual.counts.unavailable > 0);
    assert.equal(await validatePlaceReport(actual, absent), true);
    await assert.rejects(runPlaceConformance(await placeContext(absent), {
      'oracle/reference': async () => { throw new Error('geography oracle failure'); },
    }), /place report refused/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
