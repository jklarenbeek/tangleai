/** Official LongMemEval QA semantics, including the deliberately permissive judge label. */
import { mean } from '@jarenjs/core/stats';
import { LME_TYPES, type LmeType, type LmeEvaluatorQuestion } from './longmemeval.ts';
import { pyStrip } from './locomo-parity.ts';

const ordinary = 'I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.';
const temporal = " In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct.";
const update = 'I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.';
const preference = "I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.";
const abstain = 'I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.';
export const LONGMEMEVAL_JUDGE = { model: 'gpt-4o-2024-08-06', temperature: 0, maxTokens: 10, httpAttempts: 1 } as const;

export function longMemEvalJudgePrompt(task: LmeType, question: string, answer: string | number, response: string, abstention = false): string {
  if (!LME_TYPES.includes(task)) throw new TypeError('unsupported LongMemEval question type');
  const prefix = abstention ? abstain : task === 'knowledge-update' ? update : task === 'single-session-preference' ? preference : ordinary + (task === 'temporal-reasoning' ? temporal : '') + ' ';
  const label = abstention ? 'Explanation' : task === 'single-session-preference' ? 'Rubric' : 'Correct Answer';
  const end = abstention ? 'Does the model correctly identify the question as unanswerable? Answer yes or no only.' : 'Is the model response correct? Answer yes or no only.';
  return `${prefix}\n\nQuestion: ${question}\n\n${label}: ${String(answer)}\n\nModel Response: ${response}\n\n${end}`;
}
export function longMemEvalJudgeLabel(response: string): { label: boolean; validStrictReply: boolean } {
  const normalized = pyStrip(response).toLowerCase();
  return { label: normalized.includes('yes'), validStrictReply: normalized === 'yes' || normalized === 'no' };
}
export interface LmeJudgedRow { id: string; type: LmeType; abstention: boolean; response: string | null }
/** Missing replies remain failed rows in the declared denominator, with separate coverage. */
export function scoreLongMemEval(rows: readonly LmeJudgedRow[]) {
  if (new Set(rows.map(r => r.id)).size !== rows.length) throw new TypeError('duplicate judged question');
  const score = (subset: readonly LmeJudgedRow[]) => subset.length ? mean(subset.map(r => Number(r.response !== null && longMemEvalJudgeLabel(r.response).label))) : null;
  const byType = Object.fromEntries(LME_TYPES.map(t => {
    const subset = rows.filter(r => r.type === t); return [t, { questions: subset.length, accuracy: score(subset) }];
  })) as Record<LmeType, { questions: number; accuracy: number | null }>;
  const types = LME_TYPES.map(t => byType[t].accuracy);
  return { questions: rows.length, measured: rows.filter(r => r.response !== null).length,
    missing: rows.filter(r => r.response === null).length,
    invalidJudgeReplies: rows.filter(r => r.response !== null && !longMemEvalJudgeLabel(r.response).validStrictReply).length,
    micro: score(rows), macro: types.some(v => v === null) ? null : mean(types as number[]), byType,
    abstention: { questions: rows.filter(r => r.abstention).length, accuracy: score(rows.filter(r => r.abstention)) } };
}
export function longMemEvalRetrieval(evaluator: LmeEvaluatorQuestion, retrievedOccurrenceIds: readonly string[]) {
  const sources = new Set(retrievedOccurrenceIds), sessions = new Set(retrievedOccurrenceIds.map(id => evaluator.occurrenceSessions[id]).filter(id => id !== undefined));
  const gold = new Set(evaluator.goldSessionIds);
  return { eligible: !evaluator.abstention,
    recallAny: evaluator.abstention ? null : Number([...gold].some(id => sessions.has(id))),
    recallAll: evaluator.abstention ? null : Number([...gold].every(id => sessions.has(id))),
    sessionFractionRecall: evaluator.abstention ? null : gold.size ? [...gold].filter(id => sessions.has(id)).length / gold.size : null,
    annotatedTurnRecall: evaluator.annotatedTurnIds.length ? evaluator.annotatedTurnIds.filter(id => sources.has(id)).length / evaluator.annotatedTurnIds.length : null,
    annotatedTurns: evaluator.annotatedTurnIds.length,
    unresolvedCitations: retrievedOccurrenceIds.filter(id => evaluator.occurrenceSessions[id] === undefined).length };
}
