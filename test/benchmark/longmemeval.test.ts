import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lmeFixture } from '../fixtures/longmemeval.ts';
import { lmeStamp, validateLongMemEval, validateLmeRuntime, longMemEvalViews, censusLongMemEval, loadLongMemEval } from '../../benchmark/lib/longmemeval.ts';
import { longMemEvalReport, renderLongMemEval, validateLongMemEvalReport } from '../../benchmark/lib/longmemeval-report.ts';
import { loadLocomo } from '../../benchmark/lib/locomo.ts';
import { acquireVerifiedSource, readVerifiedSource, sha256 } from '../../benchmark/lib/longmemeval-source.ts';

test('LongMemEval calendar grammar checks leap days, weekday and minute precision', () => {
  assert.equal(lmeStamp('2024/02/29 (Thu) 12:00')?.epochMs, 1709208000000);
  for (const invalid of ['2023/02/29 (Wed) 12:00', '2024/02/29 (Fri) 12:00', '2024/02/29 (Thu) 24:00', '2024/02/29 (Thu) 12:60', '2024/13/01 (Mon) 12:00', '2024-02-29']) assert.equal(lmeStamp(invalid), null, invalid);
});
test('raw validation accepts integer references and refuses schema/array/calendar failures', () => {
  assert.equal(validateLongMemEval([lmeFixture({ answer: 15 })]).status, 'available');
  for (const value of [[lmeFixture({ answer: 1.5 })], [lmeFixture({ haystack_dates: [] })], [lmeFixture(), lmeFixture()],
    [lmeFixture({ question_date: '2024/02/30 (Fri) 12:00' })], [{ ...lmeFixture(), extra: true }]]) assert.equal(validateLongMemEval(value).status, 'failed');
});
test('actual runtime seam payloads contain no labels and keep every repeated occurrence', async () => {
  const { runtime, evaluator } = longMemEvalViews(lmeFixture(), 'provided-history');
  const captures: string[] = [];
  const seam = async (input: unknown) => { assert.equal(validateLmeRuntime(input), true); captures.push(JSON.stringify(input)); };
  await seam(runtime); await seam(runtime); await seam(runtime);
  for (const serialized of captures) for (const forbidden of ['PRIVILEGED_GOLD', 'probe_abs', 'answer_repeated', 'question_type', 'has_answer', 'answer_session_ids', 'sourceQuestionId']) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(new Set(runtime.occurrences.map(o => o.id)).size, 3);
  assert.notEqual(runtime.occurrences[0].sessionId, runtime.occurrences[1].sessionId);
  assert.equal(runtime.occurrences[0].sourceHash, runtime.occurrences[1].sourceHash);
  assert.deepEqual(runtime, longMemEvalViews(lmeFixture(), 'provided-history').runtime);
  assert.equal(evaluator.goldSessionIds[0], 'answer_repeated');
  assert.equal(validateLmeRuntime(evaluator), false);
  assert.equal(validateLmeRuntime({ ...runtime, answer: 'PRIVILEGED_GOLD' }), false);
  assert.equal(validateLmeRuntime({ ...runtime, occurrences: [{ ...runtime.occurrences[0], has_answer: false }] }), false);
  const foreign = longMemEvalViews(lmeFixture({ question_id: 'foreign' }), 'provided-history').runtime;
  assert.equal(validateLmeRuntime({ ...runtime, occurrences: foreign.occurrences }), false);
});
test('strict profile removes future sources before runtime and preserves evaluator denominator', () => {
  const full = longMemEvalViews(lmeFixture(), 'provided-history'), strict = longMemEvalViews(lmeFixture(), 'strict-as-of');
  assert.equal(full.runtime.occurrences.length, 3); assert.equal(strict.runtime.occurrences.length, 2);
  assert.deepEqual(strict.evaluator, full.evaluator); assert.notEqual(full.runtime.viewId, strict.runtime.viewId);
  assert.equal(validateLmeRuntime(strict.runtime), true);
  assert.equal(validateLmeRuntime({ ...full.runtime, profile: 'strict-as-of' }), false);
  assert.deepEqual(strict.runtime.occurrences.map(o => o.sessionOrdinal), [1, 2]);
  const c = censusLongMemEval([lmeFixture()]);
  assert.equal(c.futureGoldSessions, 1); assert.equal(c.futureGoldQuestions, 1);
  assert.equal(c.duplicateIdQuestions, 1); assert.equal(c.restampedIds, 1);
  assert.equal(c.unsortedHistories, 1); assert.equal(c.hasAnswerFalse, 1);
});
test('report validation refuses changed denominators and registration identities', () => {
  const report = longMemEvalReport([lmeFixture()], []);
  assert.equal(validateLongMemEvalReport(report), true);
  assert.equal(validateLongMemEvalReport({ ...report, denominators: { ...report.denominators, qa: 0 } }), false);
  assert.equal(validateLongMemEvalReport({ ...report, registration: { ...report.registration, sha256: 'forged' } }), false);
});
test('verified acquisition installs only complete bytes and never replaces a valid file on failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lme-acquire-')), destination = join(root, 'data.json');
  const text = '[1]', expected = { bytes: 3, sha256: sha256(text) };
  try {
    await writeFile(destination, text);
    const good = await acquireVerifiedSource({ destination, expected, url: 'https://fixture.invalid', fetch: async () => new Response(text) });
    assert.equal(good.status, 'available');
    for (const fetch of [async () => new Response('[2]'), async () => new Response('['), async () => new Response('[123]'),
      async () => new Response('', { status: 503 }), async () => { throw new Error('interrupted'); },
      async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('[')); c.error(new Error('stream interrupted')); } }))]) {
      assert.equal((await acquireVerifiedSource({ destination, expected, url: 'https://fixture.invalid', fetch })).status, 'failed');
      assert.equal(await readFile(destination, 'utf8'), text);
      assert.deepEqual(await readdir(root), ['data.json']);
    }
    assert.equal((await readVerifiedSource(destination, { ...expected, sha256: 'bad' })).status, 'failed');
    assert.equal((await readVerifiedSource(join(root, 'absent'), expected)).status, 'unavailable');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('pinned optional full corpus reproduces the census and generated document', async t => {
  const data = await loadLongMemEval(process.cwd());
  if (data.status === 'unavailable') { t.skip('optional separately downloaded LongMemEval corpus unavailable'); return; }
  assert.equal(data.status, 'available'); if (data.status !== 'available') return;
  const c = censusLongMemEval(data.value);
  assert.deepEqual([c.questions, c.sessions, c.turns, c.abstentions, c.stringAnswers, c.integerAnswers], [500, 23867, 246750, 30, 468, 32]);
  assert.deepEqual(Object.values(c.types), [70, 56, 30, 133, 133, 78]);
  assert.deepEqual([c.unsortedHistories, c.futureSessions, c.futureQuestions, c.futureGoldSessions, c.futureGoldQuestions,
    c.duplicateIdQuestions, c.restampedIds, c.missingGoldIds], [211, 1475, 76, 75, 44, 13, 3942, 0]);
  assert.deepEqual([c.hasAnswerFields, c.hasAnswerTrue, c.hasAnswerFalse, c.answerPrefixSessions], [10960, 896, 10064, 948]);
  const locomo = await loadLocomo();
  if (locomo.available && locomo.valid) {
    const report = longMemEvalReport(data.value, locomo.samples.map(s => s.sample_id));
    assert.equal(report.registration.sha256, '1c0e8030e0b99e898f86c6da99ff62384c313612a6aeca9d49ac09b66adf9849');
    assert.deepEqual(report.registration.folds.map(f => f.questions), [101, 399]);
    assert.equal(await readFile('docs/LONGMEMEVAL_BENCHMARK.md', 'utf8'), renderLongMemEval(report));
  }
});
test('strict view identity depends only on permitted history and forged view identities refuse', () => {
  const original = lmeFixture(), changed = structuredClone(original);
  changed.haystack_sessions[0][0].content = 'Changed future source text must not affect this strict view.';
  const strict = longMemEvalViews(original, 'strict-as-of').runtime;
  assert.deepEqual(longMemEvalViews(changed, 'strict-as-of').runtime, strict);
  assert.notEqual(longMemEvalViews(changed, 'provided-history').runtime.viewId, longMemEvalViews(original, 'provided-history').runtime.viewId);
  assert.equal(validateLmeRuntime({ ...strict, viewId: 'f'.repeat(64) }), false);
});
