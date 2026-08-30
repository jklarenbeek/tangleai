/**
 * The answer instrument, pinned — and the baseline rows with it.
 *
 * Four layers. The environment reader and the prompt pieces are tested
 * on hand cases that need no dataset — a missing key is a stated skip,
 * the key never reaches a printed line, a citation the prompt did not
 * list is unresolved, the sample is seeded and stratified, a program's
 * answer slot is read as a phrase plus the turn ids it names, two live
 * runs merge by row and refuse to mix models. Then, with the submodule
 * present, the committed keyless report is asserted to be EXACTLY what
 * a fresh run produces and the doc to render from it beside the
 * committed live report; the gate is pinned; and the live path is
 * driven end to end through a SCRIPTED fetch — an embedding wire, a
 * chat wire that answers from the request, a program author and its
 * sub-calls — so every row, the citation check, the cost accounting,
 * the ceiling beside the F1, the judge lane, the merge and the up-front
 * spend guard are all exercised without a key. The committed live
 * report is validated and its sample checked against the keyless one,
 * never regenerated.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { JarenValidator } from '@jarenjs/validate';
import { createHashEmbedder } from '@jarenjs/ai/embed';
import { nodeDriver } from '@jarenjs/db/node';

import { DEFAULT_SETTINGS, chatClientFor, chatWireConfigured, embedderFor } from '../../apps/desktop/src/settings.ts';
import {
  AI_ENV,
  GUARD_DEFAULTS,
  chatSettingsOf,
  describeAiEnv,
  embedSettingsOf,
  readAiEnv,
} from '../../benchmark/lib/ai-env.ts';
import { INIT_COMMAND, loadLocomo } from '../../benchmark/lib/locomo.ts';
import { conversationCorpus, observationCorpus, observationReferences, summaryCorpus, transcriptUnits } from '../../benchmark/lib/locomo-corpus.ts';
import {
  ANSWER_SCHEMA,
  CONFIGURATIONS,
  DEFAULT_ADVERSARIAL,
  DEFAULT_K,
  DEFAULT_LIVE_ROWS,
  DEFAULT_PER_CATEGORY,
  DEFAULT_SEED,
  HORIZON_DEFAULTS,
  ROWS,
  answerMessages,
  checkCitations,
  commonGround,
  contextLine,
  dateText,
  horizonAnswer,
  horizonCorpusText,
  horizonQuestion,
  horizonSubset,
  judgeMessages,
  liveMismatch,
  mergeLiveReports,
  oraclePrediction,
  questionsOf,
  renderMarkdown,
  restrictTo,
  rowsOf,
  runLocomoQa,
  runLocomoQaLive,
  sampleQuestions,
  versusTangle,
  type LiveReport,
  type QaReport,
} from '../../benchmark/lib/locomo-qa.ts';
import { openWireCache, type ReplayCache } from '../../benchmark/lib/wire-cache.ts';
import RECALL_SCHEMA from '../../benchmark/schemas/locomo-recall.schema.json' with { type: 'json' };
import QA_SCHEMA from '../../benchmark/schemas/locomo-qa.schema.json' with { type: 'json' };
import LIVE_SCHEMA from '../../benchmark/schemas/locomo-qa-live.schema.json' with { type: 'json' };

const REPORT_PATH = 'benchmark/results/locomo-qa.json';
const LIVE_PATH = 'benchmark/results/locomo-qa-live.json';
const DOC_PATH = 'docs/LOCOMO_BENCHMARK.md';

const dataset = await loadLocomo();
const missing = !dataset.available;
if (missing) {
  // eslint-disable-next-line no-console
  console.log(`# locomo qa tests skipped — submodule absent. ${INIT_COMMAND}`);
}

const validateKeyless = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' })
  .addSchema(RECALL_SCHEMA as Record<string, unknown>)
  .compile(QA_SCHEMA as Record<string, unknown>);
const validateLive = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' })
  .addSchema([RECALL_SCHEMA as Record<string, unknown>, QA_SCHEMA as Record<string, unknown>])
  .compile(LIVE_SCHEMA as Record<string, unknown>);

const ALL_ROWS = ROWS.map((row) => row.key);

// ---------------------------------------------------------------------------
// the environment reader
// ---------------------------------------------------------------------------

describe('readAiEnv — the live tier is never a test dependency', () => {
  it('a missing key is a stated skip naming the variable, not a failure', () => {
    const env = readAiEnv({ TANGLE_AI_MODEL: 'm' });
    assert.equal(env.live, false);
    assert.match(env.reason!, /OPENROUTER_AI_KEY/);
    assert.equal(env.apiKey, null);
    assert.equal(env.keySource, null);
  });

  it('a missing model is the next skip; a local provider needs no key; custom needs a base URL', () => {
    assert.match(readAiEnv({ OPENROUTER_AI_KEY: 'k' }).reason!, /TANGLE_AI_MODEL/);
    const ollama = readAiEnv({ TANGLE_AI_PROVIDER: 'ollama', TANGLE_AI_BASE_URL: 'http://localhost:11434', TANGLE_AI_MODEL: 'qwen' });
    assert.equal(ollama.live, true);
    assert.equal(ollama.reason, null);
    assert.match(readAiEnv({ TANGLE_AI_PROVIDER: 'custom', OPENROUTER_AI_KEY: 'k', TANGLE_AI_MODEL: 'm' }).reason!, /TANGLE_AI_BASE_URL/);
    assert.match(readAiEnv({ TANGLE_AI_PROVIDER: 'openai', OPENROUTER_AI_KEY: 'k', TANGLE_AI_MODEL: 'm' }).reason!, /unknown provider 'openai'/);
  });

  it('resolves a full configuration, defaults the guards, and falls back on a malformed guard', () => {
    const env = readAiEnv({
      OPENROUTER_AI_KEY: 'secret-value', TANGLE_AI_MODEL: 'fast', TANGLE_AI_MODEL_STRONG: 'strong',
      TANGLE_AI_EMBEDDING_MODEL: 'embed', TANGLE_AI_MAX_CALLS: 'lots', TANGLE_AI_MAX_CONCURRENCY: '2',
    });
    assert.equal(env.live, true);
    assert.equal(env.provider, 'openrouter');
    assert.equal(env.keySource, AI_ENV.key);
    assert.equal(env.modelStrong, 'strong');
    assert.equal(env.embedModel, 'embed');
    assert.equal(env.maxCalls, GUARD_DEFAULTS.maxCalls, 'a typo in .env must not take the keyless tier down');
    assert.equal(env.maxConcurrency, 2);
    assert.equal(readAiEnv({ OPENROUTER_AI_KEY: 'k', TANGLE_AI_MODEL: 'only' }).modelStrong, 'only', 'the judge falls back to the answer model');
  });

  it('never prints the key — only the variable it came from', () => {
    const env = readAiEnv({ OPENROUTER_AI_KEY: 'secret-value', TANGLE_AI_MODEL: 'fast' });
    const line = describeAiEnv(env);
    assert.doesNotMatch(line, /secret-value/);
    assert.match(line, /key from OPENROUTER_AI_KEY/);
  });

  it('turns into the desktop\'s settings shape, and the desktop\'s factories accept it', () => {
    const env = readAiEnv({ OPENROUTER_AI_KEY: 'k', TANGLE_AI_MODEL: 'fast', TANGLE_AI_MODEL_STRONG: 'strong' });
    const chat = chatSettingsOf(env);
    assert.deepEqual(chat, { provider: 'openrouter', baseUrl: null, model: 'fast', apiKey: 'k' });
    assert.equal(chatSettingsOf(env, env.modelStrong).model, 'strong');
    assert.equal(chatWireConfigured(chat), true);
    assert.equal(chatClientFor(chat).endpoint.model, 'fast');
    assert.deepEqual(embedSettingsOf(env), { provider: 'builtin', baseUrl: null, model: null, apiKey: null }, 'no embedding model → the built-in');
    assert.equal(embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }).model, 'hash-trigram-64');
    const wired = readAiEnv({ OPENROUTER_AI_KEY: 'k', TANGLE_AI_MODEL: 'fast', TANGLE_AI_EMBEDDING_MODEL: 'e' });
    assert.equal(embedSettingsOf(wired).model, 'e');
    assert.throws(() => chatClientFor({ provider: null, baseUrl: null, model: null, apiKey: null }), /no chat wire/);
  });

});

// ---------------------------------------------------------------------------
// the prompt, its citations, the sample, the rows
// ---------------------------------------------------------------------------

const unit = (id: string, text: string, tags = ['Caroline', 'session:1'], at = '2023-05-08T13:56:00.000Z') => ({
  id, text, evidence: 'conv-26/D1:1', tags, at, kind: 'event' as const,
});

/** A two-session conversation with an observation and a summary corpus, for the row builders. */
function tinySample() {
  return {
    sample_id: 's',
    conversation: {
      speaker_a: 'A', speaker_b: 'B',
      session_1_date_time: '1:56 pm on 8 May, 2023',
      session_1: [{ speaker: 'A', dia_id: 'D1:1', text: 'hello there' }, { speaker: 'B', dia_id: 'D1:2', text: 'I moved to Paris in April' }],
      session_2_date_time: '3:00 pm on 9 June, 2023',
      session_2: [{ speaker: 'A', dia_id: 'D2:1', text: 'how is Paris?' }],
    },
    observation: {
      session_1_observation: { B: [['B moved to Paris in April.', 'D1:2'], ['B greeted A.', 'D1:1, D1:2'], ['', 'D1:1'], ['B cites nothing', 'D9:9']] },
      session_2_observation: { A: [['A asked about Paris.', ['D2:1', 'D1:2']]] },
      session_7_observation: { A: [['orphan', 'D7:1']] },
    },
    session_summary: { session_1_summary: 'A and B spoke; B moved to Paris.', session_2_summary: 'A asked about Paris.', session_9_summary: 'orphan' },
    qa: Array.from({ length: 12 }, (_, i) => ({
      question: `q${i}`, answer: `a${i}`, evidence: ['D1:2'], category: ((i % 4) + 1) as 1 | 2 | 3 | 4,
    })).concat([{ question: 'adv', evidence: ['D1:1'], category: 5 as const, adversarial_answer: 'trap' } as never]),
  };
}

describe('the prompt is grounded and its citations checkable', () => {
  it('lists a memory as [id] (date) speaker: text, the date in the release\'s own form', () => {
    assert.equal(dateText('2023-05-08T13:56:00.000Z'), '8 May 2023');
    assert.equal(contextLine(unit('m-1', 'I went to the group.')), '[m-1] (8 May 2023) Caroline: I went to the group.');
    assert.equal(contextLine(unit('m-2', 'merged', ['session:2'])), '[m-2] (8 May 2023) merged', 'no speaker tag, no speaker');
    const messages = answerMessages('When?', [unit('m-1', 'a'), unit('m-2', 'b')]);
    assert.equal(messages.length, 2);
    assert.match(messages[0].content, /MEMORIES:\n\[m-1\] .*\n\[m-2\] /);
    assert.match(messages[0].content, /exact words from the memories/);
    assert.match(messages[0].content, /cite only ids listed/);
    assert.equal(messages[1].content, 'Question: When?');
    assert.match(answerMessages('q', [])[0].content, /no memories were retrieved/);
  });

  it('a citation the prompt did not list is unresolved, and duplicates count once', () => {
    const listed = new Set(['m-1', 'm-2']);
    assert.deepEqual(checkCitations(['m-2', 'm-9', 'm-2'], listed), { resolved: ['m-2'], unresolved: ['m-9'] });
    assert.deepEqual(checkCitations([], listed), { resolved: [], unresolved: [] });
  });

  it('the answer schema is what the repair loop enforces', () => {
    const validate = new JarenValidator({ skipErrors: false, collectErrors: true }).compile(ANSWER_SCHEMA as never);
    assert.equal(validate({ answer: 'x', citations: [] }).valid, true);
    assert.equal(validate({ answer: 'x' }).valid, false);
    assert.equal(validate({ answer: 'x', citations: ['a'], extra: 1 }).valid, false);
  });

  it('the judge reads the trap, the evidence and the answer, and the released answer when there is one', () => {
    const messages = judgeMessages({ question: 'q', trap: 'yes', released: 'No', evidence: ['(8 May 2023) Melanie: I did it.'], answer: 'Melanie did, not Caroline' });
    assert.match(messages[0].content, /premise is false/);
    assert.match(messages[1].content, /Trap: yes\nReleased answer: No\nEvidence turns:\n\(8 May 2023\) Melanie: I did it\.\n\nAnswer under judgment: Melanie did, not Caroline/);
    assert.doesNotMatch(judgeMessages({ question: 'q', trap: 't', evidence: [], answer: 'a' })[1].content, /Released answer/);
  });

  it('the oracle prediction is the released answer as the scorer cuts it', () => {
    const base = { id: 'x#0', sampleId: 'x', index: 0, text: 'q', gold: [], resolvable: 0, universe: 1 };
    assert.equal(oraclePrediction({ ...base, category: 3, answer: 'the park; it was sunny' }), 'the park');
    assert.equal(oraclePrediction({ ...base, category: 4, answer: 2019 }), '2019');
    assert.equal(oraclePrediction({ ...base, category: 5, adversarialAnswer: 'yes' }), null);
    assert.equal(oraclePrediction({ ...base, category: 1 }), null);
  });

  it('draws a seeded, stratified sample in release order, capped by what a category holds; the horizon subset is a seeded draw of it', () => {
    const sample = tinySample();
    const questions = questionsOf(sample, conversationCorpus(sample));
    assert.equal(questions.length, 13);
    assert.equal(questions[0].id, 's#0');
    assert.deepEqual(questions[0].gold, ['s/D1:2']);
    const a = sampleQuestions(questions, { seed: 7, perCategory: 2, adversarial: 5 });
    const b = sampleQuestions(questions, { seed: 7, perCategory: 2, adversarial: 5 });
    assert.deepEqual(a.map((q) => q.id), b.map((q) => q.id));
    assert.equal(a.filter((q) => q.category === 5).length, 1, 'capped by what the category holds');
    for (const c of [1, 2, 3, 4]) assert.equal(a.filter((q) => q.category === c).length, 2);
    assert.deepEqual(a.map((q) => q.index), [...a.map((q) => q.index)].sort((x, y) => x - y), 'release order');
    assert.notDeepEqual(sampleQuestions(questions, { seed: 8, perCategory: 2, adversarial: 1 }).map((q) => q.id), a.map((q) => q.id));
    const subset = horizonSubset(a.filter((q) => q.category !== 5), 1, 7);
    assert.equal(subset.length, 4);
    for (const q of subset) assert.ok(a.some((s) => s.id === q.id), 'drawn from the sample');
    assert.deepEqual(subset.map((q) => q.id), horizonSubset(a.filter((q) => q.category !== 5), 1, 7).map((q) => q.id), 'seeded');
  });
});

describe('the rows', () => {
  it('names six rows in table order, the pipeline pair among them, and refuses an unknown key', () => {
    assert.deepEqual(ALL_ROWS, ['long-context', 'near-raw', 'rag-observation', 'rag-summary', 'long-horizon', 'near']);
    assert.deepEqual(CONFIGURATIONS.map((r) => r.key), ['near-raw', 'near']);
    assert.deepEqual([...DEFAULT_LIVE_ROWS], ['near-raw', 'near']);
    assert.deepEqual(rowsOf(['near', 'long-context']).map((r) => r.key), ['long-context', 'near'], 'table order, whatever the ask');
    assert.throws(() => rowsOf(['nope']), /unknown row 'nope'/);
    assert.equal(HORIZON_DEFAULTS.depth, 0, 'the program path, the one jarenjs measured working on the cheap tier');
    assert.ok(HORIZON_DEFAULTS.maxSubcalls + 3 <= HORIZON_DEFAULTS.turnsPerQuestion, 'an authoring call and two repairs fit under the turn budget beside the sub-calls');
  });

  it('builds the observation corpus with scoped, list-aware evidence and counts what did not resolve', () => {
    const sample = tinySample();
    const turns = conversationCorpus(sample);
    assert.deepEqual(observationReferences('D1:1, D1:2'), { ids: ['D1:1', 'D1:2'], list: true });
    assert.deepEqual(observationReferences(['D2:1']), { ids: ['D2:1'], list: true });
    assert.deepEqual(observationReferences(7), { ids: [], list: false });
    const obs = observationCorpus(sample, turns);
    assert.equal(obs.kind, 'observation');
    assert.deepEqual(obs.sessions.map((s) => s.number), [1, 2]);
    assert.deepEqual(obs.sessions[0].inputs.map((i) => i.evidence), ['s/D1:2', 's/D1:1; s/D1:2', 's/D9:9']);
    assert.deepEqual(obs.sessions[0].inputs[0].tags, ['B', 'session:1']);
    assert.equal(obs.sessions[0].inputs[0].at, turns.sessions[0].atText);
    assert.equal(obs.sessions[0].inputs[0].kind, 'fact');
    assert.deepEqual(obs.census, { blocks: 3, orphanBlocks: 1, empty: 1, entries: 4, references: 6, listReferences: 2, unresolved: 1, collapsed: 0, chars: obs.sessions.flatMap((s) => s.inputs).reduce((n, i) => n + i.text.length, 0) });
    assert.equal(obs.lastAt, turns.lastAt, 'the same clock as the turns');
  });

  it('builds the summary corpus with a whole session as evidence, and the transcript units with dia_ids for ids', () => {
    const sample = tinySample();
    const turns = conversationCorpus(sample);
    const sum = summaryCorpus(sample, turns);
    assert.deepEqual(sum.sessions.map((s) => s.inputs[0].evidence), ['s/D1:1; s/D1:2', 's/D2:1']);
    assert.deepEqual(sum.sessions[0].inputs[0].tags, ['session:1']);
    assert.equal(sum.sessions[0].inputs[0].kind, 'summary');
    assert.deepEqual(sum.census, { blocks: 3, orphanBlocks: 1, empty: 0, entries: 2, references: 3, listReferences: 1, unresolved: 0, collapsed: 0, chars: sum.sessions.reduce((n, s) => n + s.inputs[0].text.length, 0) });
    const units = transcriptUnits(turns);
    assert.deepEqual(units.map((u) => u.id), ['D1:1', 'D1:2', 'D2:1']);
    assert.equal(units[1].evidence, 's/D1:2');
    assert.equal(contextLine(units[1]), '[D1:2] (8 May 2023) B: I moved to Paris in April');
    assert.equal(horizonCorpusText(turns).split('\n').length, 3, 'one turn per line');
    assert.match(horizonQuestion('When?'), /^When\? The corpus is a conversation/);
  });

  it('reads a program\'s answer slot as a phrase plus the turn ids it names, in the rival\'s favour', () => {
    assert.deepEqual(horizonAnswer('7 May 2023 [D1:3]'), { answer: '7 May 2023', citations: ['D1:3'] });
    assert.deepEqual(horizonAnswer('["Paris [D1:2]", null, "Paris, [D2:1] and [D1:2]"]'), { answer: 'Paris, Paris, and', citations: ['D1:2', 'D2:1'] });
    assert.deepEqual(horizonAnswer(JSON.stringify([{ slot: 'corpus#line:2000/0', value: { city: 'Paris', ids: ['D1:2'] } }, { slot: 'x', error: 'boom' }])), { answer: 'Paris', citations: ['D1:2'] }, 'bookkeeping members are not answer text');
    assert.deepEqual(horizonAnswer('null'), { answer: '', citations: [] });
    assert.deepEqual(horizonAnswer('42'), { answer: '42', citations: [] });
  });
});

// ---------------------------------------------------------------------------
// merging runs
// ---------------------------------------------------------------------------

function liveStub(overrides: Partial<LiveReport> & { rows?: string[] } = {}): LiveReport {
  const rows = overrides.rows ?? ['near'];
  const row = (key: string, run = 0) => ({
    key, label: key, kind: 'pipeline' as const, corpus: 'turns' as const, run,
    thresholds: { novelty: 2, contradiction: 2, crystallize: 2 },
    ingest: { runs: 0, observations: 0, embedded: 0, admitted: 0, filtered: 0, judged: 0, contradictions: 0, resolutions: 0, merged: 0, live: 0, total: 0, superseded: 0 },
    retrieval: { unranked: 0 },
    questions: { planned: 1, answered: 1, unanswered: { wire: 0, budget: 0 }, invalid: 0, results: [{ id: 'conv-30#1', category: 4 as const, f1: 0.5, ceiling: 1, citedRecall: 1, cited: true, unresolved: 0, invalid: false, tokens: 10, ms: 5, replayed: 0 }] },
    f1: { overall: 0.5, byCategory: { 1: null, 2: null, 3: null, 4: 0.5 } },
    ceiling: { overall: 1, byCategory: { 1: null, 2: null, 3: null, 4: 1 } },
    citedRecall: { overall: 1, byCategory: { 1: null, 2: null, 3: null, 4: 1 } },
    citations: { cited: 1, uncited: 0, total: 1, unresolved: 0, answersWithUnresolved: 0 },
    cost: { turns: 1, tokens: 10, promptTokens: 8, completionTokens: 2, ms: 5, replayed: 0 },
    latency: { count: 1, medianMs: 5, p95Ms: 5 },
    adversarial: { planned: 0, judged: 0, correct: 0, accuracy: null, keyword: 0, unanswered: { wire: 0, budget: 0 }, judgeFailed: 0, cost: { turns: 0, tokens: 0, promptTokens: 0, completionTokens: 0, ms: 0, replayed: 0 } },
  });
  const { rows: _rows, ...rest } = overrides;
  return {
    benchmark: 'locomo',
    instrument: 'locomo-qa-live',
    generated: { at: '2026-08-27T12:00:00.000Z', provider: 'openrouter', model: 'fast', judgeModel: 'strong', embedder: { model: 'e', dims: 8 }, keySource: 'OPENROUTER_AI_KEY', thinking: 'off' },
    dataset: { path: 'p', sha256: 'a'.repeat(64), bytes: 1, schemaValid: true, conversations: 1, restricted: ['conv-30'] },
    config: { embedder: { model: 'e', dims: 8 }, k: 10, ingest: 'per-session', clock: 'c', maxPairs: 20 },
    sample: { seed: 1, perCategory: 1, adversarial: 0, scorable: 1, byCategory: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 }, ids: ['conv-30#1'] },
    runs: [{ at: '2026-08-27T12:00:00.000Z', rows, plan: { embedRequests: 0, chatCalls: 1, judgeCalls: 0, planned: 1, maxCalls: 10, skipped: null }, embedding: { requests: 0, texts: 0, cached: 0 }, spent: { turns: 1, tokens: 10, ms: 5 }, replayed: 0, errors: { count: 0, sample: [] } }],
    configurations: rows.map((key) => row(key)),
    ...rest,
  };
}

describe('merging live runs into one table', () => {
  it('appends the run, replaces rows by key, keeps table order, and validates', () => {
    const first = liveStub({ rows: ['near', 'near-raw'] });
    const second = liveStub({ rows: ['long-context', 'near'], generated: { ...first.generated, at: '2026-08-28T12:00:00.000Z' } });
    second.configurations[1].f1.overall = 0.9;
    const merged = mergeLiveReports(first, second);
    assert.equal(merged.runs.length, 2);
    assert.equal(merged.generated.at, '2026-08-28T12:00:00.000Z');
    assert.deepEqual(merged.configurations.map((c) => [c.key, c.run]), [['long-context', 1], ['near-raw', 0], ['near', 1]]);
    assert.equal(merged.configurations[2].f1.overall, 0.9, 'the fresh row replaced the old one');
    assert.equal(validateLive(merged).valid, true, JSON.stringify(validateLive(merged).errors?.slice(0, 5)));
    assert.equal(mergeLiveReports(null, second).runs.length, 1);
  });

  it('refuses to put two models, two samples or two releases in one table', () => {
    const a = liveStub();
    assert.equal(liveMismatch(a, liveStub()), null);
    assert.match(liveMismatch(a, liveStub({ generated: { ...a.generated, model: 'other' } }))!, /different answer model/);
    assert.match(liveMismatch(a, liveStub({ generated: { ...a.generated, thinking: 'default' } }))!, /thinking/);
    assert.match(liveMismatch(a, liveStub({ sample: { ...a.sample, seed: 2 } }))!, /different sample/);
    assert.match(liveMismatch(a, liveStub({ dataset: { ...a.dataset, sha256: 'b'.repeat(64) } }))!, /different release/);
    assert.equal(liveMismatch(a, liveStub({ generated: { ...a.generated, embedder: { model: 'e', dims: 0 } } })), null, 'a run that embedded nothing has no width to disagree with');
    assert.throws(() => mergeLiveReports(a, liveStub({ generated: { ...a.generated, model: 'other' } })), /cannot be merged/);
  });

  it('compares rows over common ground and Tangle against each rival', () => {
    const live = liveStub({ rows: ['near-raw', 'near'] });
    live.configurations[0].f1.overall = 0.75;
    live.configurations[0].questions.results[0].f1 = 0.75;
    assert.deepEqual([...commonGround(live.configurations)], ['conv-30#1']);
    assert.equal(restrictTo(live.configurations[0], new Set(['conv-30#1']))!.f1.overall, 0.75);
    assert.equal(restrictTo(live.configurations[0], new Set(['conv-30#2'])), null);
    const contests = versusTangle(live)!;
    assert.equal(contests.length, 1);
    assert.equal(contests[0].rival.key, 'near-raw');
    assert.equal(contests[0].common, 1);
    assert.ok(contests[0].delta < 0, 'Tangle loses here');
    assert.deepEqual(contests[0].behind, [4]);
    assert.equal(versusTangle(liveStub({ rows: ['near-raw'] })), null, 'no Tangle row, nothing decided');
  });
});

// ---------------------------------------------------------------------------
// a scripted wire: embeddings from the text, answers from the prompt,
// a program from the author's ask, sub-call values from the piece
// ---------------------------------------------------------------------------

interface ScriptOptions {
  /** What the chat wire answers, given the request body. */
  chat?: (body: any) => { content: string, usage?: unknown } | Response;
  /** Fail every chat call with this status. */
  fail?: number;
  /** Sees every chat request body as the wire would — what the thinking control looked like on the wire. */
  onRequest?: (body: any) => void;
}

/** The program the scripted author writes: chunk by line, ask every piece about THIS question (as a real author would — a prompt that named no question would make every question's sub-call over a piece the same request), collect the values, answer. */
export function scriptedProgram(question: string): { steps: Array<Record<string, unknown>> } {
  return {
    steps: [
      { op: 'chunk', from: 'corpus', as: 'pieces', strategy: 'line', size: 2000 },
      { op: 'map', from: 'pieces', as: 'found', prompt: `Quote the turn that answers "${question.slice(0, 120)}", with its [id]; null if none.` },
      { op: 'reduce', from: 'found', as: 'summary', query: { $for: { r: '$[*].value' }, $return: '$r.value' } },
      { op: 'answer', from: 'summary' },
    ],
  };
}

/** A fetch that answers `/embeddings` deterministically and `/chat/completions` from a script. */
function scriptedFetch(options: ScriptOptions = {}): { fetch: typeof globalThis.fetch, calls: { embeddings: number, chat: number, judge: number, author: number, subcall: number } } {
  const hash = createHashEmbedder({ dims: 8 });
  const calls = { embeddings: 0, chat: 0, judge: 0, author: 0, subcall: 0 };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (url.endsWith('/embeddings')) {
      calls.embeddings++;
      const texts: string[] = Array.isArray(body.input) ? body.input : [body.input];
      const vectors = await hash.embed(texts);
      return new Response(JSON.stringify({ data: vectors.map((v, index) => ({ index, embedding: Array.from(v) })), model: body.model }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/chat/completions')) {
      const name = body.response_format?.json_schema?.name;
      const system: string = body.messages?.[0]?.content ?? '';
      const isSubcall = system.startsWith('You are given ONE piece');
      if (name === 'locomo_judge') calls.judge++;
      else if (name === 'jaren_program') calls.author++;
      else if (isSubcall) calls.subcall++;
      else calls.chat++;
      options.onRequest?.(body);
      if (options.fail !== undefined) return new Response('nope', { status: options.fail });
      if (name === 'locomo_judge') {
        return completion(JSON.stringify({ correct: /not|did not|no such/i.test(body.messages.at(-1).content), reasoning: 'scripted' }));
      }
      if (name === 'jaren_program') {
        const asked = /Question: ([^\n]*)/.exec(String(body.messages.at(-1).content));
        return completion(JSON.stringify(scriptedProgram(asked?.[1] ?? 'the question')));
      }
      if (isSubcall) {
        // the first turn of the piece, quoted with its id, in the shape the program's reduce reads (`$r.value`) — a JSON value, as a sub-call must answer
        const piece: string = body.messages.at(-1).content;
        const line = /^\[(D\d+:\d+)\] \([^)]*\) (?:[^:\n]+: )?(.*)$/m.exec(piece.slice(piece.indexOf('--- piece')));
        return completion(JSON.stringify(line === null ? null : { value: `${line[2]} [${line[1]}]` }));
      }
      const scripted = options.chat?.(body);
      if (scripted instanceof Response) return scripted;
      return completion(scripted?.content ?? JSON.stringify({ answer: '', citations: [] }), scripted?.usage);
    }
    return new Response('not scripted', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function completion(content: string, usage: unknown = { prompt_tokens: 100, completion_tokens: 7, total_tokens: 107 }): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }], usage, model: 'stub' }),
    { status: 200, headers: { 'content-type': 'application/json' } });
}

/** The ids and texts the prompt listed, read back out of the request. */
function listedMemories(body: any): Array<{ id: string, text: string }> {
  const system: string = body.messages[0].content;
  return [...system.matchAll(/^\[([^\]]+)\] \([^)]*\) (?:[^:\n]+: )?(.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
}

/** The environment a scripted live run reads: a wire for both, tiny guards. */
function scriptedEnv(overrides: Record<string, string> = {}) {
  return readAiEnv({
    OPENROUTER_AI_KEY: 'k', TANGLE_AI_MODEL: 'fast', TANGLE_AI_MODEL_STRONG: 'strong',
    TANGLE_AI_EMBEDDING_MODEL: 'stub-embed', TANGLE_AI_MAX_CALLS: '1000', TANGLE_AI_MAX_CONCURRENCY: '3',
    ...overrides,
  });
}

function liveClients(
  env: ReturnType<typeof readAiEnv>,
  fetch: typeof globalThis.fetch,
  cache?: ReplayCache,
  reasoning?: { effort: 'none' },
) {
  return {
    chat: chatClientFor(chatSettingsOf(env), { fetch, retry: { attempts: 1 }, cache, reasoning }),
    judge: chatClientFor(chatSettingsOf(env, env.modelStrong), { fetch, retry: { attempts: 1 }, cache, reasoning }),
    embedder: embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, fetch, cache),
  };
}

// ---------------------------------------------------------------------------
// the instrument, over the pinned release
// ---------------------------------------------------------------------------

describe('the LoCoMo answer-path instrument', { skip: missing }, () => {
  const available = dataset.available ? dataset : null;
  const rowOf = <T extends { key: string }>(report: { configurations: readonly T[] }, key: string): T => report.configurations.find((c) => c.key === key)!;

  it('reproduces the committed keyless report byte for byte, and the doc from it beside the committed live report', async () => {
    const report = await runLocomoQa(available!);
    const fresh = `${JSON.stringify(report, null, 2)}\n`;
    const committed = await readFile(REPORT_PATH, 'utf8');
    assert.equal(fresh, committed,
      `${REPORT_PATH} is not what a run produces; regenerate it with npm run benchmark:locomo:qa -- --json ${REPORT_PATH} --live-json ${LIVE_PATH} --md ${DOC_PATH}`);
    assert.equal(validateKeyless(report).valid, true, 'the report validates against its committed schema');
    const live = existsSync(LIVE_PATH) ? JSON.parse(await readFile(LIVE_PATH, 'utf8')) as LiveReport : null;
    assert.equal(`${renderMarkdown(report, live, live === null ? `\`--live\` was not requested and ${LIVE_PATH} does not exist` : null)}\n`, await readFile(DOC_PATH, 'utf8'), `${DOC_PATH} is stale`);
  });

  it('pins the gate: the released answer scores 1 against itself once cut, and the verbatim asymmetry is published', async () => {
    const report = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as QaReport;
    assert.deepEqual(report.gate.failures, []);
    assert.equal(report.gate.passed, true);
    for (const c of ['1', '2', '3', '4'] as const) assert.equal(report.gate.oracle.byCategory[c], 1, `category ${c}`);
    assert.equal(report.gate.oracle.overall, 1);
    // measured on the way to parity: 11 category-3 answers cannot match themselves uncut
    assert.equal(report.gate.released.byCategory['1'], 1);
    assert.equal(report.gate.released.byCategory['2'], 1);
    assert.equal(report.gate.released.byCategory['4'], 1);
    assert.ok(report.gate.released.byCategory['3']! < 1, 'the official evaluator cuts only the truth at `;`');
    assert.equal(report.config.k, DEFAULT_K);
    assert.equal(report.sample.seed, DEFAULT_SEED);
    assert.equal(report.sample.perCategory, DEFAULT_PER_CATEGORY);
    assert.equal(report.sample.adversarial, DEFAULT_ADVERSARIAL);
    assert.equal(report.sample.scorable, 4 * DEFAULT_PER_CATEGORY);
    assert.equal(report.sample.ids.length, 4 * DEFAULT_PER_CATEGORY + DEFAULT_ADVERSARIAL);
    assert.equal(report.questions.scorable, 1540);
    assert.equal(report.corpus.turns, 5882);
  });

  it('measures the release\'s derived corpora rather than trusting the paper', async () => {
    const report = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as QaReport;
    const { observation, summary } = report.corpora;
    assert.equal(observation.blocks, 272, 'one observation block per transcribed session');
    assert.equal(observation.entries, 2541);
    assert.equal(observation.references, 2561);
    assert.equal(observation.listReferences, 15, 'five comma-joined strings and ten arrays');
    assert.equal(observation.unresolved, 0);
    assert.equal(observation.orphanBlocks + observation.empty + observation.collapsed, 0);
    assert.equal(summary.blocks, 272);
    assert.equal(summary.entries, 272);
    assert.equal(summary.references, 5882, 'every turn is some summary\'s evidence');
    assert.equal(summary.orphanBlocks + summary.empty + summary.collapsed, 0);
  });

  it('publishes every row\'s ceiling at k and floor where a model-free reading exists, and says where it does not', async () => {
    const report = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as QaReport;
    assert.deepEqual(report.configurations.map((c) => c.key), ALL_ROWS);
    const raw = rowOf(report, 'near-raw');
    const near = rowOf(report, 'near');
    assert.equal(raw.ingest!.runs, 272);
    assert.equal(raw.ingest!.filtered + raw.ingest!.contradictions + raw.ingest!.merged, 0);
    assert.ok(near.ingest!.filtered + near.ingest!.contradictions + near.ingest!.merged > 0);
    for (const key of ['near-raw', 'near', 'rag-observation', 'rag-summary']) {
      const c = rowOf(report, key);
      assert.ok(c.ceiling!.all.overall > 0 && c.ceiling!.all.overall < 1, key);
      assert.ok(c.verbatim!.all.overall > 0 && c.verbatim!.all.overall < c.ceiling!.all.overall, `${key}: quoting ten memories is a floor, not an answer`);
      assert.ok(c.ceiling!.sample.overall > 0);
    }
    const observation = rowOf(report, 'rag-observation');
    assert.equal(observation.corpus, 'observation');
    assert.equal(observation.ingest!.observations, 2541);
    assert.equal(observation.ingest!.filtered + observation.ingest!.merged, 0, 'policies inert');
    const summary = rowOf(report, 'rag-summary');
    assert.equal(summary.ingest!.observations, 272);
    assert.ok(summary.ceiling!.all.overall > observation.ceiling!.all.overall, 'a session-level ceiling is coarser, so higher');
    const whole = rowOf(report, 'long-context');
    assert.equal(whole.kind, 'long-context');
    assert.ok(whole.ceiling!.all.overall > 0.99 && whole.ceiling!.all.overall < 1, 'every resolvable gold turn is in the request; nine ids resolve to none');
    assert.equal(whole.verbatim, null, 'quoting a whole conversation is not a floor');
    assert.equal(whole.ingest, undefined);
    const horizon = rowOf(report, 'long-horizon');
    assert.equal(horizon.ceiling, null, 'the agent authors its own retrieval');
    assert.equal(horizon.verbatim, null);
    // the same k=10 ranking as the recall instrument, so the ceilings agree with the recall instrument's published rows
    const recall = JSON.parse(await readFile('benchmark/results/locomo-recall.json', 'utf8'));
    for (const c of CONFIGURATIONS) {
      const row = recall.rows.find((r: { key: string }) => r.key === c.key);
      assert.equal(rowOf(report, c.key).ceiling!.all.overall, row.recall['10'].overall, `${c.key}: the ceiling IS the recall instrument's recall@10`);
    }
  });

  it('is byte-identical across two restricted runs, and a category with no question is absent', async () => {
    const options = { samples: ['conv-30'], perCategory: 3, adversarial: 1 };
    const a = await runLocomoQa(available!, options);
    const b = await runLocomoQa(available!, options);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.deepEqual(a.dataset.restricted, ['conv-30']);
    assert.equal(a.questions.byCategory['3'], 0);
    assert.equal(rowOf(a, 'near-raw').ceiling!.all.byCategory['3'], null);
    assert.equal(a.sample.byCategory['3'], 0);
    assert.equal(validateKeyless(a).valid, true, JSON.stringify(validateKeyless(a).errors?.slice(0, 5)));
    await assert.rejects(() => runLocomoQa(available!, { samples: ['conv-99'] }), /no sample 'conv-99'/);
  });

  it('validates the committed live report and pins it to the keyless sample', async () => {
    if (!existsSync(LIVE_PATH)) return;
    const live = JSON.parse(await readFile(LIVE_PATH, 'utf8')) as LiveReport;
    const report = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as QaReport;
    const outcome = validateLive(live);
    assert.equal(outcome.valid, true, JSON.stringify(outcome.errors?.slice(0, 5)));
    assert.deepEqual(live.sample, report.sample, 'both tiers answered the same draw');
    assert.equal(live.dataset.sha256, report.dataset.sha256);
    assert.equal(live.generated.keySource, 'OPENROUTER_AI_KEY');
    assert.doesNotMatch(await readFile(LIVE_PATH, 'utf8'), /sk-or-/, 'a key never reaches a report');
    assert.ok(live.runs.length >= 1);
    for (const run of live.runs) {
      assert.equal(run.plan.skipped, null, 'a skipped run is never merged');
      assert.ok(run.spent.turns <= run.plan.maxCalls, 'the ceiling held');
      for (const key of run.rows) assert.ok(ALL_ROWS.includes(key), key);
    }
    assert.deepEqual(live.configurations.map((c) => c.key), ALL_ROWS.filter((key) => live.configurations.some((c) => c.key === key)), 'table order');
    for (const c of live.configurations) {
      assert.ok(c.run >= 0 && c.run < live.runs.length);
      assert.ok(live.runs[c.run].rows.includes(c.key), `${c.key} names the run that produced it`);
      assert.equal(c.questions.answered + c.questions.unanswered.wire + c.questions.unanswered.budget, c.questions.planned);
      assert.equal(c.questions.results.length, c.questions.answered, 'one result per answered question');
      assert.equal(c.f1.overall <= 1 && c.ceiling.overall <= 1, true);
      assert.equal(c.cost.turns, c.latency.count, 'one latency reading per call');
      assert.ok(c.cost.tokens > 0, 'the provider reported usage');
      if (c.kind === 'long-horizon') {
        assert.ok(c.horizon !== undefined);
        assert.equal(c.questions.planned, c.horizon!.ids.length);
        for (const r of c.questions.results) assert.ok(c.horizon!.ids.includes(r.id));
      } else {
        assert.equal(c.questions.planned, live.sample.scorable);
      }
    }
    assert.ok(versusTangle(live) !== null, 'Tangle\'s row is in the table');
  });

  it('runs every row through a scripted wire: ceiling beside F1, citations checked, cost from usage, the judge lane apart, the agent bounded', async () => {
    // one call in flight at a time, so the injected timer reads 5 ms per call exactly
    const env = scriptedEnv({ TANGLE_AI_MAX_CONCURRENCY: '1' });
    // the wire answers the FIRST listed memory's text and cites it — plus one id the prompt never listed
    const { fetch, calls } = scriptedFetch({
      chat: (body) => {
        const listed = listedMemories(body);
        const first = listed[0];
        return { content: JSON.stringify({ answer: first?.text ?? 'no memories', citations: first === undefined ? [] : [first.id, 'm-never-listed'] }) };
      },
    });
    let tick = 0;
    const live = await runLocomoQaLive(available!, {
      env, ...liveClients(env, fetch), thinking: 'off',
      rows: ALL_ROWS, horizon: { perCategory: 1, callTimeoutMs: 0 },
      samples: ['conv-30'], perCategory: 2, adversarial: 1,
      clock: () => new Date('2026-08-27T12:00:00.000Z'),
      timer: () => (tick += 5),
    });
    assert.equal(validateLive(live).valid, true, JSON.stringify(validateLive(live).errors?.slice(0, 5)));
    assert.equal(live.generated.at, '2026-08-27T12:00:00.000Z');
    assert.equal(live.generated.keySource, 'OPENROUTER_AI_KEY');
    assert.deepEqual(live.generated.embedder, { model: 'stub-embed', dims: 8 });
    assert.equal(live.runs.length, 1);
    const run = live.runs[0];
    assert.equal(run.plan.skipped, null);
    assert.deepEqual(run.rows, ALL_ROWS);
    const horizonRow = rowOf(live, 'long-horizon');
    assert.equal(run.plan.chatCalls, 5 * live.sample.scorable + horizonRow.questions.planned * HORIZON_DEFAULTS.turnsPerQuestion, 'the plan counts the agent at its per-question bound');
    assert.equal(run.plan.judgeCalls, 5 * 1 * 2, 'the agent plans no adversarial questions');
    assert.equal(run.embedding.requests, run.plan.embedRequests, 'the plan counted the embedding requests exactly');
    assert.equal(calls.embeddings, run.embedding.requests, 'every corpus embedded once, up front');
    assert.ok(run.embedding.texts >= 369 + 169 + 19 + live.sample.ids.length, 'turns, observations, summaries and questions');
    assert.equal(run.spent.turns, run.embedding.requests + calls.chat + calls.judge + calls.author + calls.subcall, 'every request charged to the one account');
    assert.ok(run.spent.turns <= run.plan.planned, 'the plan was an upper bound');
    assert.equal(run.errors.count, 0);
    assert.deepEqual(live.configurations.map((c) => c.key), ALL_ROWS);

    for (const c of live.configurations) {
      assert.equal(c.run, 0);
      if (c.kind === 'long-horizon') continue;
      assert.equal(c.questions.planned, live.sample.scorable);
      assert.equal(c.questions.answered, live.sample.scorable);
      assert.equal(c.questions.invalid, 0);
      assert.equal(c.questions.results.length, live.sample.scorable);
      assert.equal(c.citations.cited, live.sample.scorable);
      assert.equal(c.citations.unresolved, live.sample.scorable, 'one unlisted id per answer is counted');
      assert.equal(c.citations.answersWithUnresolved, live.sample.scorable);
      assert.equal(c.cost.turns, live.sample.scorable);
      assert.equal(c.cost.tokens, 107 * live.sample.scorable, 'the provider\'s usage, not an estimate');
      assert.equal(c.cost.promptTokens, 100 * live.sample.scorable);
      assert.equal(c.latency.count, live.sample.scorable);
      assert.equal(c.latency.medianMs, 5);
      assert.equal(c.cost.ms, 5 * live.sample.scorable, 'the row\'s ms is the sum of its calls');
      assert.equal(c.questions.results.reduce((n, r) => n + r.tokens, 0), c.cost.tokens, 'per-question tokens sum to the row');
      assert.ok(c.ceiling.overall >= 0 && c.ceiling.overall <= 1);
      assert.ok(c.citedRecall.overall <= c.ceiling.overall, 'citing one memory can never recall more than the prompt held');
      assert.equal(c.adversarial.planned, 1);
      assert.equal(c.adversarial.judged, 1);
      assert.equal(c.adversarial.cost.turns, 2, 'answer and judgment, charged to the lane, not the row');
      assert.equal(c.adversarial.keyword, 0);
    }
    const whole = rowOf(live, 'long-context');
    assert.equal(whole.ingest, undefined);
    assert.ok(whole.ceiling.overall > 0.99, 'the whole conversation holds every resolvable gold turn');
    assert.ok(whole.cost.promptTokens > 0);
    const observation = rowOf(live, 'rag-observation');
    assert.equal(observation.corpus, 'observation');
    assert.equal(observation.ingest!.observations, 169, 'conv-30\'s observations went through the pipeline');
    const summary = rowOf(live, 'rag-summary');
    assert.equal(summary.ingest!.observations, 19);

    // the agent: one authoring call and one sub-call per piece, a corpus line probed for the ceiling, the answer read from the slot
    const asked = horizonRow.questions.planned;
    assert.equal(asked, 3, 'one per category the sample holds — conv-30 has no open-domain question');
    assert.equal(horizonRow.questions.answered, asked);
    assert.equal(horizonRow.horizon!.ids.length, asked);
    assert.equal(horizonRow.horizon!.authored.ok, asked);
    assert.equal(horizonRow.horizon!.authored.failed, 0);
    assert.equal(horizonRow.horizon!.programs.ok, asked);
    assert.ok(horizonRow.horizon!.subcalls.made > 0 && horizonRow.horizon!.subcalls.made <= asked * HORIZON_DEFAULTS.maxSubcalls);
    assert.ok(horizonRow.horizon!.subcalls.unvisited > 0, 'conv-30 cuts into more pieces than the sub-call cap, and the cap says so');
    assert.equal(horizonRow.horizon!.subcalls.failed, 0);
    assert.deepEqual(horizonRow.horizon!.thinking, { author: 'default', subcall: 'off' });
    assert.equal(horizonRow.cost.turns, calls.author + calls.subcall);
    assert.equal(horizonRow.adversarial.planned, 0);
    assert.equal(horizonRow.citations.cited, asked, 'every answer named ids the corpus lists');
    assert.equal(horizonRow.citations.unresolved, 0);
    for (const r of horizonRow.questions.results) {
      assert.ok(r.calls! >= 2 && r.calls! <= HORIZON_DEFAULTS.turnsPerQuestion, `${r.id}: ${r.calls} calls`);
      assert.equal(r.authored, true);
      assert.equal(r.stopped, null);
      assert.ok(r.ceiling >= r.citedRecall, 'a sub-call cited only what it was shown');
    }
    assert.ok(horizonRow.ceiling.overall > 0, 'some gold turn reached a sub-call');

    const keyless = await runLocomoQa(available!, { samples: ['conv-30'], perCategory: 2, adversarial: 1 });
    const doc = renderMarkdown(keyless, live);
    assert.match(doc, /### On common ground/);
    assert.match(doc, /### The long-horizon row's ground/);
    assert.match(doc, /### Tangle against the field/);
    assert.match(doc, /### The adversarial lane/);
    assert.match(doc, /Tangle loses to|loses to none/);

    // a second run of two rows merges over the first: the rows are replaced, the run appended
    const again = await runLocomoQaLive(available!, {
      env, ...liveClients(env, fetch), thinking: 'off', rows: ['near'], samples: ['conv-30'], perCategory: 2, adversarial: 1,
      clock: () => new Date('2026-08-28T12:00:00.000Z'), timer: () => (tick += 5),
    });
    const merged = mergeLiveReports(live, again);
    assert.equal(merged.runs.length, 2);
    assert.deepEqual(merged.configurations.map((c) => c.key), ALL_ROWS);
    assert.equal(rowOf(merged, 'near').run, 1);
    assert.equal(rowOf(merged, 'near-raw').run, 0);
    assert.equal(validateLive(merged).valid, true, JSON.stringify(validateLive(merged).errors?.slice(0, 5)));
    assert.match(renderMarkdown(keyless, merged), /\| 1 \| 2026-08-28T12:00:00.000Z \| `near` \|/);
  });

  it('a replay inside the pipeline pair is read as the policies leaving the prompt untouched — stated only when every replay matches the dialog-RAG answer and Tangle\'s row came from one run', async () => {
    const keyless = await runLocomoQa(available!, { samples: ['conv-30'], perCategory: 2, adversarial: 1 });
    const pair = (): LiveReport => {
      const live = liveStub({ rows: ['near-raw', 'near'] });
      const [raw, near] = live.configurations;
      raw.questions.results.push({ id: 'conv-30#2', category: 4, f1: 1, ceiling: 1, citedRecall: 1, cited: true, unresolved: 0, invalid: false, tokens: 12, ms: 5, replayed: 0 });
      near.questions.results[0].replayed = 1;
      near.questions.results.push({ id: 'conv-30#2', category: 4, f1: 0, ceiling: 0.5, citedRecall: 0, cited: false, unresolved: 0, invalid: false, tokens: 11, ms: 5, replayed: 0 });
      for (const c of [raw, near]) { c.questions.planned = 2; c.questions.answered = 2; }
      near.cost.replayed = 1;
      return live;
    };
    const stated = renderMarkdown(keyless, pair());
    assert.match(stated, /1 of Tangle's 2 answers were replays of the dialog-RAG row's/);
    assert.match(stated, /differ only on the 1 questions where the policies changed the prompt: there Tangle scores 0\.000 against 1\.000, under ceilings of 0\.500 and 1\.000\./);
    // a replay whose score is not the dialog-RAG row's is not evidence of an identical prompt
    const differs = pair();
    differs.configurations[1].questions.results[0].f1 = 0.25;
    assert.doesNotMatch(renderMarkdown(keyless, differs), /replays of the dialog-RAG row's/);
    // a row merged from two runs may be replaying its own earlier answers
    const twice = pair();
    twice.runs.push({ ...twice.runs[0], at: '2026-08-28T12:00:00.000Z', rows: ['near'] });
    assert.doesNotMatch(renderMarkdown(keyless, twice), /replays of the dialog-RAG row's/);
  });

  it('behind the wire cache a second run buys nothing — every answer replayed, every text cached, the plan counting no embedding request — and --fresh buys again', async () => {
    const env = scriptedEnv({ TANGLE_AI_MAX_CONCURRENCY: '1' });
    const cache = await openWireCache({ path: ':memory:', driver: nodeDriver() });
    const options = { rows: ['near-raw', 'long-horizon'], horizon: { perCategory: 1, callTimeoutMs: 0 }, samples: ['conv-30'], perCategory: 2, adversarial: 1, cache };
    const remembered = (fetch: typeof globalThis.fetch, fresh = false) => {
      const replay = cache.adapter({ fresh });
      return {
        ...liveClients(env, fetch, replay, { effort: 'none' }),
        horizonClient: chatClientFor(chatSettingsOf(env), { fetch, retry: { attempts: 1 }, cache: replay }),
      };
    };
    const first = scriptedFetch();
    const bought = await runLocomoQaLive(available!, { env, ...remembered(first.fetch), ...options, clock: () => new Date('2026-08-27T12:00:00.000Z') });
    assert.equal(bought.runs[0].plan.skipped, null);
    assert.ok(first.calls.embeddings > 0 && first.calls.chat > 0 && first.calls.author > 0 && first.calls.subcall > 0);
    assert.equal(bought.runs[0].embedding.cached, 0);
    assert.equal(bought.runs[0].replayed, 0);
    for (const c of bought.configurations) assert.equal(c.cost.replayed, 0);
    const stats = await cache.stats();
    assert.equal(stats.embeddings, bought.runs[0].embedding.texts, 'every text the wire embedded is remembered');
    assert.equal(stats.completions, bought.runs[0].spent.turns - bought.runs[0].embedding.requests, 'every chat call is remembered');

    const second = scriptedFetch();
    const replayed = await runLocomoQaLive(available!, { env, ...remembered(second.fetch), ...options, clock: () => new Date('2026-08-28T12:00:00.000Z') });
    assert.deepEqual(second.calls, { embeddings: 0, chat: 0, judge: 0, author: 0, subcall: 0 }, 'the wire was never called');
    assert.equal(replayed.runs[0].plan.embedRequests, 0, 'the plan knew the cache held every text');
    assert.equal(replayed.runs[0].embedding.requests, 0);
    assert.equal(replayed.runs[0].embedding.cached, bought.runs[0].embedding.texts);
    assert.equal(replayed.runs[0].spent.turns, 0, 'nothing charged to the account');
    assert.equal(replayed.runs[0].replayed, bought.runs[0].spent.turns - bought.runs[0].embedding.requests, 'every chat call replayed');
    assert.equal(validateLive(replayed).valid, true, JSON.stringify(validateLive(replayed).errors?.slice(0, 5)));
    for (const c of replayed.configurations) {
      const was = bought.configurations.find((b) => b.key === c.key)!;
      assert.equal(c.cost.replayed, c.cost.turns, `${c.key}: every call a replay`);
      assert.equal(c.cost.turns, was.cost.turns);
      assert.equal(c.cost.tokens, was.cost.tokens, 'the usage travels with the replay');
      assert.ok(c.cost.ms > 0 && c.latency.medianMs! > 0, 'so does the wall time of the call that bought it — the cache\'s own reading of it, so it is close to the meter\'s, not equal');
      assert.equal(c.f1.overall, was.f1.overall, 'the same answers score the same');
      assert.equal(c.questions.answered, was.questions.answered);
      for (const r of c.questions.results) assert.ok(r.replayed > 0, `${r.id} replayed`);
      assert.equal(c.adversarial.cost.replayed, c.adversarial.cost.turns);
    }
    assert.match(renderMarkdown(await runLocomoQa(available!, { samples: ['conv-30'], perCategory: 2, adversarial: 1 }), replayed), /replayed\)/);

    const third = scriptedFetch();
    const again = await runLocomoQaLive(available!, { env, ...remembered(third.fetch, true), ...options, fresh: true });
    assert.ok(third.calls.chat > 0 && third.calls.embeddings > 0, '--fresh buys again');
    assert.equal(again.runs[0].replayed, 0);
    assert.equal(again.runs[0].embedding.cached, 0);
    await cache.close();
  });

  it('the run\'s thinking control reaches every sub-call and is recorded: off sends `effort: none`, default sends nothing, the authoring call keeps its own', async () => {
    const env = scriptedEnv();
    const kinds = (body: any): 'author' | 'subcall' | 'answer' => body.response_format?.json_schema?.name === 'jaren_program' ? 'author'
      : String(body.messages?.[0]?.content ?? '').startsWith('You are given ONE piece') ? 'subcall' : 'answer';
    for (const thinking of ['off', 'default'] as const) {
      const seen: Array<{ kind: string, reasoning: unknown }> = [];
      const { fetch } = scriptedFetch({ onRequest: (body) => seen.push({ kind: kinds(body), reasoning: body.reasoning }) });
      const live = await runLocomoQaLive(available!, {
        env, ...liveClients(env, fetch), thinking, rows: ['long-horizon'], horizon: { perCategory: 1, callTimeoutMs: 0 },
        samples: ['conv-30'], perCategory: 2, adversarial: 1,
      });
      assert.equal(live.generated.thinking, thinking);
      const row = rowOf(live, 'long-horizon');
      assert.deepEqual(row.horizon!.thinking, { author: 'default', subcall: thinking });
      const subcalls = seen.filter((r) => r.kind === 'subcall');
      const authors = seen.filter((r) => r.kind === 'author');
      assert.ok(subcalls.length > 0 && authors.length > 0);
      for (const r of subcalls) assert.deepEqual(r.reasoning, thinking === 'off' ? { effort: 'none' } : undefined, `${thinking}: a sub-call carried ${JSON.stringify(r.reasoning)}`);
      for (const r of authors) assert.equal(r.reasoning, undefined, 'the authoring call plans at the model\'s default either way');
      assert.equal(validateLive(live).valid, true, JSON.stringify(validateLive(live).errors?.slice(0, 5)));
    }
  });

  it('skips up front when the plan exceeds the ceiling, spending nothing', async () => {
    const env = scriptedEnv({ TANGLE_AI_MAX_CALLS: '5' });
    const { fetch, calls } = scriptedFetch();
    const live = await runLocomoQaLive(available!, { env, ...liveClients(env, fetch), samples: ['conv-30'], perCategory: 2, adversarial: 1 });
    assert.match(live.runs[0].plan.skipped!, /exceed TANGLE_AI_MAX_CALLS=5/);
    assert.match(live.runs[0].plan.skipped!, /for near-raw, near/);
    assert.deepEqual(calls, { embeddings: 0, chat: 0, judge: 0, author: 0, subcall: 0 });
    assert.equal(live.runs[0].spent.turns, 0);
    assert.deepEqual(live.configurations, []);
    assert.equal(validateLive(live).valid, true);
    assert.match(renderMarkdown(await runLocomoQa(available!, { samples: ['conv-30'], perCategory: 2, adversarial: 1 }), live), /\*\*Skipped up front\*\*/);
  });

  it('a wire failure is an unanswered question, counted and named, never a score — for the agent too', async () => {
    const env = scriptedEnv();
    const { fetch } = scriptedFetch({ fail: 500 });
    const live = await runLocomoQaLive(available!, {
      env, ...liveClients(env, fetch), rows: ['near-raw', 'long-horizon'], horizon: { perCategory: 1, callTimeoutMs: 0 },
      samples: ['conv-30'], perCategory: 1, adversarial: 1,
    });
    for (const c of live.configurations) {
      assert.equal(c.questions.answered, 0, c.key);
      assert.equal(c.questions.unanswered.wire, c.questions.planned, c.key);
    }
    assert.equal(rowOf(live, 'near-raw').adversarial.unanswered.wire, 1);
    assert.ok(live.runs[0].errors.count > 0);
    assert.ok(live.runs[0].errors.sample.length <= 10);
    assert.equal(versusTangle(live), null, 'no Tangle row answered, nothing decided');
    assert.equal(validateLive(live).valid, true);
  });

  it('a reply that fails the schema after repair is scored as raw text and cites nothing', async () => {
    const env = scriptedEnv();
    const { fetch } = scriptedFetch({ chat: () => ({ content: 'just prose, twice' }) });
    const live = await runLocomoQaLive(available!, { env, ...liveClients(env, fetch), samples: ['conv-30'], perCategory: 1, adversarial: 0 });
    for (const c of live.configurations) {
      assert.equal(c.questions.invalid, c.questions.planned);
      assert.equal(c.citations.uncited, c.questions.planned);
      assert.equal(c.cost.turns, 2 * c.questions.planned, 'one repair round per question');
      for (const r of c.questions.results) assert.equal(r.invalid, true);
    }
  });
});
