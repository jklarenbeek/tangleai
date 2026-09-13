/** Tangle-authored transcript, deliberately distinct from the evaluator answer. */
import type { LmeRawQuestion } from '../../benchmark/lib/longmemeval.ts';
export function lmeFixture(overrides: Partial<LmeRawQuestion> = {}): LmeRawQuestion {
  return { question_id: 'probe_abs', question_type: 'temporal-reasoning', question: 'When did the rehearsal occur?',
    answer: 'PRIVILEGED_GOLD', question_date: '2024/03/01 (Fri) 12:00',
    haystack_session_ids: ['answer_repeated', 'answer_repeated', 'filler'],
    haystack_dates: ['2024/03/02 (Sat) 12:00', '2024/02/29 (Thu) 12:00', '2024/02/28 (Wed) 12:00'],
    haystack_sessions: [[{ role: 'user', content: 'A rehearsal was discussed.', has_answer: true }],
      [{ role: 'user', content: 'A rehearsal was discussed.', has_answer: false }],
      [{ role: 'assistant', content: 'The calendar is available.' }]],
    answer_session_ids: ['answer_repeated'], ...overrides };
}
