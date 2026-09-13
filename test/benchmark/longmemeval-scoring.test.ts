import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/longmemeval-parity.json' with { type: 'json' };
import { LME_TYPES, longMemEvalViews, type LmeType } from '../../benchmark/lib/longmemeval.ts';
import { longMemEvalJudgePrompt, longMemEvalJudgeLabel, scoreLongMemEval, longMemEvalRetrieval } from '../../benchmark/lib/longmemeval-scoring.ts';
import { lmeFixture } from '../fixtures/longmemeval.ts';

test('LongMemEval prompts reproduce all pinned official type/abstention/integer branches', () => {
  assert.equal(fixture.generated.mode, 'pinned-offline-official-code');
  assert.equal(fixture.prompts.length, 24);
  for (const row of fixture.prompts) assert.equal(longMemEvalJudgePrompt(row.task as LmeType, row.question, row.answer, row.response, row.abstention), row.expected);
  const prompt = longMemEvalJudgePrompt('temporal-reasoning', 'Question?', 11, '12');
  assert.match(prompt, /do not penalize off-by-one errors/);
});
test('upstream substring labels and strict reply diagnostics remain distinct', () => {
  for (const row of fixture.labels) assert.equal(longMemEvalJudgeLabel(row.response).label, row.expected);
  assert.deepEqual(longMemEvalJudgeLabel('yesterday'), { label: true, validStrictReply: false });
  assert.deepEqual(longMemEvalJudgeLabel(''), { label: false, validStrictReply: false });
  assert.equal(longMemEvalJudgeLabel('\x1fYES\x85').validStrictReply, true);
});
test('QA aggregation agrees with the executed official aggregator', () => {
  const rows = fixture.aggregation.answers.map(a => {
    const ref = fixture.aggregation.references.find(r => r.question_id === a.question_id)!;
    return { id: a.question_id, type: ref.question_type as LmeType, abstention: ref.question_id.includes('_abs'), response: a.autoeval_label.label ? 'yes' : 'no' };
  });
  const result = scoreLongMemEval(rows), expected = fixture.aggregation.expected;
  assert.equal(Number(result.micro!.toFixed(4)), expected.micro);
  assert.equal(Number(result.macro!.toFixed(4)), expected.macro);
  assert.equal(Number(result.abstention.accuracy!.toFixed(4)), expected.abstention);
  for (const type of LME_TYPES) assert.equal(result.byType[type].accuracy, expected.byType[type]);
  assert.match(fixture.aggregation.officialOutput, /Overall Accuracy: 0.3333/);
  assert.equal(scoreLongMemEval([{ ...rows[0], response: null }]).missing, 1);
  assert.equal(scoreLongMemEval([{ ...rows[0], response: null }]).micro, 0);
  assert.equal(scoreLongMemEval([rows[0]]).macro, null);
  assert.throws(() => scoreLongMemEval([rows[0], rows[0]]), /duplicate/);
});
test('retrieval reports official any/all separately from fractional and annotated-turn diagnostics', () => {
  const { runtime, evaluator } = longMemEvalViews(lmeFixture({ question_id: 'answerable', answer_session_ids: ['answer_repeated', 'filler'] }), 'provided-history');
  const scored = longMemEvalRetrieval(evaluator, [runtime.occurrences[0].id, 'unknown']);
  assert.equal(scored.recallAny, 1); assert.equal(scored.recallAll, 0); assert.equal(scored.sessionFractionRecall, .5);
  assert.equal(scored.annotatedTurnRecall, 1); assert.equal(scored.unresolvedCitations, 1);
  assert.equal(longMemEvalRetrieval({ ...evaluator, abstention: true }, []).recallAll, null);
});
