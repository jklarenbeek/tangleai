/** Corpus-specific validation and an allowlisted boundary between runtime and evaluator. */
import { join } from 'node:path';
import { daysFromCivil, weekdayFromDays, getEpochOfDateTimeRFC3339 } from '@jarenjs/core/dates';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { createReportValidator } from './validate.ts';
import { LONGMEMEVAL_SOURCE, LONGMEMEVAL_FILES, readVerifiedSource, sha256, type SourceResult } from './longmemeval-source.ts';

export const LME_TYPES = ['single-session-user', 'single-session-assistant', 'single-session-preference', 'multi-session', 'temporal-reasoning', 'knowledge-update'] as const;
export type LmeType = typeof LME_TYPES[number];
export type KnowledgeProfile = 'provided-history' | 'strict-as-of';
export interface LmeRawQuestion {
  question_id: string; question_type: LmeType; question: string; answer: string | number; question_date: string;
  haystack_session_ids: string[]; haystack_dates: string[];
  haystack_sessions: { role: 'user' | 'assistant'; content: string; has_answer?: boolean }[][];
  answer_session_ids: string[];
}
const strings = { type: 'array', items: { type: 'string' } };
const rawValidator = createReportValidator({ type: 'array', items: { type: 'object', additionalProperties: false,
  required: ['question_id', 'question_type', 'question', 'answer', 'question_date', 'haystack_session_ids', 'haystack_dates', 'haystack_sessions', 'answer_session_ids'],
  properties: { question_id: { type: 'string', minLength: 1 }, question_type: { enum: LME_TYPES }, question: { type: 'string' },
    answer: { type: ['string', 'integer'] }, question_date: { type: 'string' }, haystack_session_ids: strings, haystack_dates: strings, answer_session_ids: strings,
    haystack_sessions: { type: 'array', items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['role', 'content'],
      properties: { role: { enum: ['user', 'assistant'] }, content: { type: 'string' }, has_answer: { type: 'boolean' } } } } } } } });

export interface LmeStamp { raw: string; at: string; epochMs: number; precision: 'minute'; normalization: 'synthetic-UTC'; offsetMinutes: 0 }
/** The grammar is dataset policy; real calendar validation and conversion are Jaren's. */
export function lmeStamp(raw: string): LmeStamp | null {
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) \((Sun|Mon|Tue|Wed|Thu|Fri|Sat)\) (\d{2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, y, m, d, weekday, h, minute] = match;
  const at = `${y}-${m}-${d}T${h}:${minute}:00.000Z`;
  const epochMs = getEpochOfDateTimeRFC3339(at);
  if (epochMs === undefined || !Number.isFinite(epochMs) || ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekdayFromDays(daysFromCivil(+y, +m, +d))] !== weekday) return null;
  return { raw, at, epochMs, precision: 'minute', normalization: 'synthetic-UTC', offsetMinutes: 0 };
}
export function validateLongMemEval(value: unknown): SourceResult<LmeRawQuestion[]> {
  const validation = rawValidator(value);
  if (!validation.valid) return { status: 'failed', reason: `invalid LongMemEval schema: ${JSON.stringify(validation.errors?.slice(0, 3))}` };
  const rows = value as LmeRawQuestion[];
  const ids = new Set<string>();
  for (const q of rows) {
    if (ids.has(q.question_id)) return { status: 'failed', reason: 'duplicate question ID' };
    ids.add(q.question_id);
    if (q.haystack_dates.length !== q.haystack_sessions.length || q.haystack_session_ids.length !== q.haystack_sessions.length) return { status: 'failed', reason: 'unaligned history arrays' };
    if (!lmeStamp(q.question_date) || q.haystack_dates.some(d => !lmeStamp(d))) return { status: 'failed', reason: 'invalid calendar date or weekday' };
  }
  return { status: 'available', value: rows };
}
export async function loadLongMemEval(root: string): Promise<SourceResult<LmeRawQuestion[]>> {
  const bytes = await readVerifiedSource(join(root, LONGMEMEVAL_SOURCE.directory, 'longmemeval_s_cleaned.json'), LONGMEMEVAL_FILES['longmemeval_s_cleaned.json']);
  if (bytes.status !== 'available') return bytes;
  try { return validateLongMemEval(JSON.parse(bytes.value.toString('utf8'))); }
  catch (cause) { return { status: 'failed', reason: `invalid JSON: ${String(cause)}` }; }
}
export function opaqueLmeId(value: unknown): string { return sha256(canonicalizeJson(value)); }
export function lmeScope(q: LmeRawQuestion): string { return opaqueLmeId(['lme', LONGMEMEVAL_SOURCE.dataRevision, q.question_id]); }
export interface LmeRuntimeOccurrence {
  id: string; scope: string; sessionId: string; sessionOrdinal: number; turnOrdinal: number;
  role: 'user' | 'assistant'; text: string; sourceHash: string; observed: LmeStamp; knownAt: string;
}
export interface LmeRuntimeQuestion {
  scope: string; viewId: string; profile: KnowledgeProfile; question: string; anchor: LmeStamp; occurrences: LmeRuntimeOccurrence[];
}
/** Ingestion identity binds only the permitted source view, independently of query text and future history. */
export function lmeViewIdentity(q: Omit<LmeRuntimeQuestion, 'viewId'>): string {
  return opaqueLmeId([q.scope, q.profile, q.anchor, q.occurrences]);
}
const opaque = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const stampSchema = { type: 'object', additionalProperties: false,
  required: ['raw', 'at', 'epochMs', 'precision', 'normalization', 'offsetMinutes'], properties: {
    raw: { type: 'string' }, at: { type: 'string' }, epochMs: { type: 'integer' }, precision: { const: 'minute' },
    normalization: { const: 'synthetic-UTC' }, offsetMinutes: { const: 0 },
  } };
const runtimeValidator = createReportValidator({ type: 'object', additionalProperties: false,
  required: ['scope', 'viewId', 'profile', 'question', 'anchor', 'occurrences'], properties: {
    scope: opaque, viewId: opaque, profile: { enum: ['provided-history', 'strict-as-of'] }, question: { type: 'string' }, anchor: stampSchema,
    occurrences: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'scope', 'sessionId', 'sessionOrdinal', 'turnOrdinal', 'role', 'text', 'sourceHash', 'observed', 'knownAt'], properties: {
        id: opaque, scope: opaque, sessionId: opaque, sessionOrdinal: { type: 'integer', minimum: 0 }, turnOrdinal: { type: 'integer', minimum: 0 },
        role: { enum: ['user', 'assistant'] }, text: { type: 'string' }, sourceHash: opaque, observed: stampSchema, knownAt: { type: 'string' },
      } } },
  } });
/** Refuse privileged or cross-scope handoffs rather than stripping their fields at a later seam. */
export function validateLmeRuntime(value: unknown): value is LmeRuntimeQuestion {
  if (!runtimeValidator(value).valid) return false;
  const q = value as LmeRuntimeQuestion;
  if (q.viewId !== lmeViewIdentity(q)) return false;
  if (canonicalizeJson(lmeStamp(q.anchor.raw)) !== canonicalizeJson(q.anchor)) return false;
  const ids = new Set<string>();
  return q.occurrences.every(o => {
    if (ids.has(o.id)) return false;
    ids.add(o.id);
    return o.scope === q.scope && o.sourceHash === sha256(o.text) &&
      o.sessionId === opaqueLmeId([o.scope, o.sessionOrdinal]) &&
      o.id === opaqueLmeId([o.scope, o.sessionOrdinal, o.turnOrdinal, o.sourceHash]) &&
      canonicalizeJson(lmeStamp(o.observed.raw)) === canonicalizeJson(o.observed) && o.knownAt === o.observed.at &&
      (q.profile === 'provided-history' || o.observed.epochMs <= q.anchor.epochMs);
  });
}
export interface LmeEvaluatorQuestion {
  scope: string; sourceQuestionId: string; type: LmeType; abstention: boolean; answer: string | number;
  goldSessionIds: string[]; sessions: { opaqueId: string; sourceId: string; ordinal: number; future: boolean }[];
  annotatedTurnIds: string[]; occurrenceSessions: Record<string, string>;
}
export function longMemEvalViews(q: LmeRawQuestion, profile: KnowledgeProfile): { runtime: LmeRuntimeQuestion; evaluator: LmeEvaluatorQuestion } {
  const scope = lmeScope(q), anchor = lmeStamp(q.question_date)!;
  const runtime: LmeRuntimeQuestion = { scope, viewId: '', profile, question: q.question, anchor, occurrences: [] };
  const evaluator: LmeEvaluatorQuestion = { scope, sourceQuestionId: q.question_id, type: q.question_type,
    abstention: q.question_id.includes('_abs'), answer: q.answer, goldSessionIds: [...q.answer_session_ids], sessions: [], annotatedTurnIds: [], occurrenceSessions: {} };
  q.haystack_sessions.forEach((session, sessionOrdinal) => {
    const observed = lmeStamp(q.haystack_dates[sessionOrdinal])!, sourceId = q.haystack_session_ids[sessionOrdinal];
    const sessionId = opaqueLmeId([scope, sessionOrdinal]), future = observed.epochMs > anchor.epochMs;
    evaluator.sessions.push({ opaqueId: sessionId, sourceId, ordinal: sessionOrdinal, future });
    session.forEach((turn, turnOrdinal) => {
      const sourceHash = sha256(turn.content), id = opaqueLmeId([scope, sessionOrdinal, turnOrdinal, sourceHash]);
      evaluator.occurrenceSessions[id] = sourceId;
      if (turn.has_answer === true) evaluator.annotatedTurnIds.push(id);
      if (profile === 'strict-as-of' && future) return;
      runtime.occurrences.push({ id, scope, sessionId, sessionOrdinal, turnOrdinal, role: turn.role, text: turn.content, sourceHash, observed: { ...observed }, knownAt: observed.at });
    });
  });
  runtime.viewId = lmeViewIdentity(runtime);
  return { runtime, evaluator };
}

export function censusLongMemEval(rows: readonly LmeRawQuestion[]) {
  const c = { questions: rows.length, uniqueQuestions: new Set(rows.map(q => q.question_id)).size, sessions: 0, turns: 0, emptyTurns: 0,
    types: Object.fromEntries(LME_TYPES.map(t => [t, 0])) as Record<LmeType, number>, abstentions: 0, stringAnswers: 0, integerAnswers: 0,
    unsortedHistories: 0, futureSessions: 0, futureQuestions: 0, futureGoldSessions: 0, futureGoldQuestions: 0,
    duplicateIdQuestions: 0, restampedIds: 0, uniqueSessionIds: 0, missingGoldIds: 0,
    hasAnswerFields: 0, hasAnswerTrue: 0, hasAnswerFalse: 0, answerPrefixSessions: 0,
    minSessions: rows.length ? Infinity : 0, maxSessions: 0 };
  const datesById = new Map<string, Set<string>>();
  for (const q of rows) {
    c.types[q.question_type]++; c.abstentions += Number(q.question_id.includes('_abs'));
    c.stringAnswers += Number(typeof q.answer === 'string'); c.integerAnswers += Number(typeof q.answer === 'number');
    const dates = q.haystack_dates.map(d => lmeStamp(d)!.epochMs), anchor = lmeStamp(q.question_date)!.epochMs;
    c.unsortedHistories += Number(dates.some((d, i) => i > 0 && d < dates[i - 1]));
    const gold = new Set(q.answer_session_ids), ids = new Set(q.haystack_session_ids);
    const future = dates.flatMap((d, i) => d > anchor ? [i] : []), futureGold = future.filter(i => gold.has(q.haystack_session_ids[i]));
    c.futureSessions += future.length; c.futureQuestions += Number(future.length > 0);
    c.futureGoldSessions += futureGold.length; c.futureGoldQuestions += Number(futureGold.length > 0);
    c.duplicateIdQuestions += Number(ids.size !== q.haystack_session_ids.length);
    c.missingGoldIds += [...gold].filter(id => !ids.has(id)).length;
    c.sessions += dates.length; c.minSessions = Math.min(c.minSessions, dates.length); c.maxSessions = Math.max(c.maxSessions, dates.length);
    q.haystack_sessions.forEach((session, i) => {
      const id = q.haystack_session_ids[i], stamps = datesById.get(id) ?? new Set<string>();
      stamps.add(q.haystack_dates[i]); datesById.set(id, stamps);
      c.answerPrefixSessions += Number(id.startsWith('answer_')); c.turns += session.length;
      for (const t of session) {
        c.emptyTurns += Number(t.content.length === 0);
        c.hasAnswerFields += Number('has_answer' in t); c.hasAnswerTrue += Number(t.has_answer === true); c.hasAnswerFalse += Number(t.has_answer === false);
      }
    });
  }
  c.uniqueSessionIds = datesById.size; c.restampedIds = [...datesById.values()].filter(d => d.size > 1).length;
  return c;
}
