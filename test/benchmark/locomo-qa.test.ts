/**
 * Order 16's instrument, pinned.
 *
 * Four layers. The environment reader and the prompt pieces are tested
 * on hand cases that need no dataset — a missing key is a stated skip,
 * the key never reaches a printed line, a citation the prompt did not
 * list is unresolved, the sample is seeded and stratified. Then, with
 * the submodule present, the committed keyless report is asserted to
 * be EXACTLY what a fresh run produces and the doc to render from it
 * beside the committed live report; the gate is pinned; and the live
 * path is driven end to end through a SCRIPTED fetch — an embedding
 * wire and a chat wire that answer from the request — so the citation
 * check, the cost accounting, the ceiling beside the F1, the judge lane
 * and the up-front spend guard are all exercised without a key. The
 * committed live report is validated and its sample checked against
 * the keyless one, never regenerated.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { JarenValidator } from '@jarenjs/validate';
import { createHashEmbedder } from '@jarenjs/ai/embed';

import { DEFAULT_SETTINGS, chatClientFor, chatWireConfigured, embedderFor } from '../../apps/desktop/src/settings.ts';
import {
  AI_ENV,
  GUARD_DEFAULTS,
  chatSettingsOf,
  describeAiEnv,
  embedSettingsOf,
  mapLimit,
  readAiEnv,
} from '../../benchmark/lib/ai-env.ts';
import { INIT_COMMAND, loadLocomo } from '../../benchmark/lib/locomo.ts';
import { conversationCorpus } from '../../benchmark/lib/locomo-corpus.ts';
import {
  ANSWER_SCHEMA,
  CONFIGURATIONS,
  DEFAULT_ADVERSARIAL,
  DEFAULT_K,
  DEFAULT_PER_CATEGORY,
  DEFAULT_SEED,
  answerMessages,
  checkCitations,
  contextLine,
  dateText,
  judgeMessages,
  oraclePrediction,
  questionsOf,
  renderMarkdown,
  runLocomoQa,
  runLocomoQaLive,
  sampleQuestions,
  winnerOf,
  type LiveReport,
  type QaReport,
} from '../../benchmark/lib/locomo-qa.ts';
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

  it('mapLimit keeps order and honours the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, n));
      inFlight--;
      return n * 10;
    });
    assert.deepEqual(out, [50, 10, 30, 20, 40]);
    assert.equal(peak, 2);
  });
});

// ---------------------------------------------------------------------------
// the prompt, its citations, the sample
// ---------------------------------------------------------------------------

const unit = (id: string, text: string, tags = ['Caroline', 'session:1'], at = '2023-05-08T13:56:00.000Z') => ({
  id, text, evidence: 'conv-26/D1:1', tags, at, kind: 'event' as const,
});

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

  it('draws a seeded, stratified sample in release order, capped by what a category holds', () => {
    const sample = {
      sample_id: 's',
      conversation: {
        speaker_a: 'A', speaker_b: 'B',
        session_1_date_time: '1:56 pm on 8 May, 2023',
        session_1: [{ speaker: 'A', dia_id: 'D1:1', text: 'hello' }],
      },
      qa: Array.from({ length: 12 }, (_, i) => ({
        question: `q${i}`, answer: `a${i}`, evidence: ['D1:1'], category: ((i % 4) + 1) as 1 | 2 | 3 | 4,
      })).concat([{ question: 'adv', evidence: ['D1:1'], category: 5 as const, adversarial_answer: 'trap' } as never]),
    };
    const questions = questionsOf(sample, conversationCorpus(sample));
    assert.equal(questions.length, 13);
    assert.equal(questions[0].id, 's#0');
    assert.deepEqual(questions[0].gold, ['s/D1:1']);
    const a = sampleQuestions(questions, { seed: 7, perCategory: 2, adversarial: 5 });
    const b = sampleQuestions(questions, { seed: 7, perCategory: 2, adversarial: 5 });
    assert.deepEqual(a.map((q) => q.id), b.map((q) => q.id));
    assert.equal(a.filter((q) => q.category === 5).length, 1, 'capped by what the category holds');
    for (const c of [1, 2, 3, 4]) assert.equal(a.filter((q) => q.category === c).length, 2);
    assert.deepEqual(a.map((q) => q.index), [...a.map((q) => q.index)].sort((x, y) => x - y), 'release order');
    assert.notDeepEqual(sampleQuestions(questions, { seed: 8, perCategory: 2, adversarial: 1 }).map((q) => q.id), a.map((q) => q.id));
  });
});

// ---------------------------------------------------------------------------
// a scripted wire: embeddings from the text, answers from the prompt
// ---------------------------------------------------------------------------

interface ScriptOptions {
  /** What the chat wire answers, given the request body. */
  chat?: (body: any) => { content: string, usage?: unknown } | Response;
  /** Fail every chat call with this status. */
  fail?: number;
}

/** A fetch that answers `/embeddings` deterministically and `/chat/completions` from a script. */
function scriptedFetch(options: ScriptOptions = {}): { fetch: typeof globalThis.fetch, calls: { embeddings: number, chat: number, judge: number } } {
  const hash = createHashEmbedder({ dims: 8 });
  const calls = { embeddings: 0, chat: 0, judge: 0 };
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
      if (name === 'locomo_judge') calls.judge++; else calls.chat++;
      if (options.fail !== undefined) return new Response('nope', { status: options.fail });
      if (name === 'locomo_judge') {
        return completion(JSON.stringify({ correct: /not|did not|no such/i.test(body.messages.at(-1).content), reasoning: 'scripted' }));
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

function liveClients(env: ReturnType<typeof readAiEnv>, fetch: typeof globalThis.fetch) {
  return {
    chat: chatClientFor(chatSettingsOf(env), { fetch, retry: { attempts: 1 } }),
    judge: chatClientFor(chatSettingsOf(env, env.modelStrong), { fetch, retry: { attempts: 1 } }),
    embedder: embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, fetch),
  };
}

// ---------------------------------------------------------------------------
// the instrument, over the pinned release
// ---------------------------------------------------------------------------

describe('the LoCoMo answer-path instrument', { skip: missing }, () => {
  const available = dataset.available ? dataset : null;

  it('reproduces the committed keyless report byte for byte, and the doc from it beside the committed live report', async () => {
    const report = await runLocomoQa(available!);
    const fresh = `${JSON.stringify(report, null, 2)}\n`;
    const committed = await readFile(REPORT_PATH, 'utf8');
    assert.equal(fresh, committed,
      `${REPORT_PATH} is not what a run produces; regenerate it with npm run benchmark:locomo:qa -- --json ${REPORT_PATH} --live-json ${LIVE_PATH} --md ${DOC_PATH}`);
    assert.equal(validateKeyless(report).valid, true, 'the report validates against its committed schema');
    const live = existsSync(LIVE_PATH) ? JSON.parse(await readFile(LIVE_PATH, 'utf8')) as LiveReport : null;
    assert.equal(`${renderMarkdown(report, live, live === null ? '`--live` was not requested' : null)}\n`, await readFile(DOC_PATH, 'utf8'), `${DOC_PATH} is stale`);
  });

  it('pins the gate: the released answer scores 1 against itself once cut, and the verbatim asymmetry is published', async () => {
    const report = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as QaReport;
    assert.deepEqual(report.gate.failures, []);
    assert.equal(report.gate.passed, true);
    for (const c of ['1', '2', '3', '4'] as const) assert.equal(report.gate.oracle.byCategory[c], 1, `category ${c}`);
    assert.equal(report.gate.oracle.overall, 1);
    // order 15 measured: 11 category-3 answers cannot match themselves uncut
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

  it('publishes the ceiling at k and the verbatim floor per configuration, the floor below the ceiling', async () => {
    const report = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as QaReport;
    assert.deepEqual(report.configurations.map((c) => c.key), CONFIGURATIONS.map((c) => c.key));
    const raw = report.configurations[0];
    const near = report.configurations[1];
    assert.equal(raw.ingest.runs, 272);
    assert.equal(raw.ingest.filtered + raw.ingest.contradictions + raw.ingest.merged, 0);
    assert.ok(near.ingest.filtered + near.ingest.contradictions + near.ingest.merged > 0);
    for (const c of report.configurations) {
      assert.ok(c.ceiling.all.overall > 0 && c.ceiling.all.overall < 1);
      assert.ok(c.verbatim.all.overall > 0 && c.verbatim.all.overall < c.ceiling.all.overall, `${c.key}: quoting ten turns is a floor, not an answer`);
      assert.ok(c.ceiling.sample.overall > 0);
    }
    // the same k=10 ranking as the recall instrument, so the ceilings agree with order 02's published rows
    const recall = JSON.parse(await readFile('benchmark/results/locomo-recall.json', 'utf8'));
    for (const c of report.configurations) {
      const row = recall.rows.find((r: { key: string }) => r.key === c.key);
      assert.equal(c.ceiling.all.overall, row.recall['10'].overall, `${c.key}: the ceiling IS order 02's recall@10`);
    }
  });

  it('is byte-identical across two restricted runs, and a category with no question is absent', async () => {
    const options = { samples: ['conv-30'], perCategory: 3, adversarial: 1 };
    const a = await runLocomoQa(available!, options);
    const b = await runLocomoQa(available!, options);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.deepEqual(a.dataset.restricted, ['conv-30']);
    assert.equal(a.questions.byCategory['3'], 0);
    assert.equal(a.configurations[0].ceiling.all.byCategory['3'], null);
    assert.equal(a.sample.byCategory['3'], 0);
    assert.equal(validateKeyless(a).valid, true);
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
    assert.equal(live.plan.skipped, null);
    assert.ok(live.spent.turns <= live.plan.maxCalls, 'the ceiling held');
    for (const c of live.configurations) {
      assert.equal(c.questions.answered + c.questions.unanswered.wire + c.questions.unanswered.budget, c.questions.planned);
      assert.equal(c.f1.overall <= 1 && c.ceiling.overall <= 1, true);
      assert.equal(c.cost.turns, c.latency.count, 'one latency reading per call');
      assert.ok(c.cost.tokens > 0, 'the provider reported usage');
    }
    const decided = winnerOf(live);
    assert.ok(decided !== null, 'the table names a winner');
    assert.ok(decided!.winner.f1.overall >= decided!.runnerUp.f1.overall);
  });

  it('runs the live path through a scripted wire: ceiling beside F1, citations checked, cost from usage, the judge lane apart', async () => {
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
      env, ...liveClients(env, fetch),
      samples: ['conv-30'], perCategory: 2, adversarial: 1,
      clock: () => new Date('2026-08-27T12:00:00.000Z'),
      timer: () => (tick += 5),
    });
    assert.equal(validateLive(live).valid, true, JSON.stringify(validateLive(live).errors?.slice(0, 5)));
    assert.equal(live.generated.at, '2026-08-27T12:00:00.000Z');
    assert.equal(live.generated.keySource, 'OPENROUTER_AI_KEY');
    assert.deepEqual(live.generated.embedder, { model: 'stub-embed', dims: 8 });
    assert.equal(live.plan.skipped, null);
    assert.equal(live.plan.chatCalls, 2 * live.sample.scorable);
    assert.equal(live.plan.judgeCalls, 2 * 1 * 2);
    assert.equal(live.embedding.requests, live.plan.embedRequests, 'the plan counted the embedding requests exactly');
    assert.equal(calls.embeddings, live.embedding.requests, 'the pipeline\'s per-session embeds hit the table, not the wire');
    assert.ok(live.embedding.texts >= 100 + live.sample.ids.length);
    assert.equal(live.spent.turns, live.embedding.requests + calls.chat + calls.judge, 'every request charged to the one account');
    assert.equal(live.errors.count, 0);
    assert.equal(live.configurations.length, 2);
    for (const c of live.configurations) {
      assert.equal(c.questions.planned, live.sample.scorable);
      assert.equal(c.questions.answered, live.sample.scorable);
      assert.equal(c.questions.invalid, 0);
      assert.equal(c.citations.cited, live.sample.scorable);
      assert.equal(c.citations.unresolved, live.sample.scorable, 'one unlisted id per answer is counted');
      assert.equal(c.citations.answersWithUnresolved, live.sample.scorable);
      assert.equal(c.cost.turns, live.sample.scorable);
      assert.equal(c.cost.tokens, 107 * live.sample.scorable, 'the provider\'s usage, not an estimate');
      assert.equal(c.cost.promptTokens, 100 * live.sample.scorable);
      assert.equal(c.latency.count, live.sample.scorable);
      assert.equal(c.latency.medianMs, 5);
      assert.equal(c.cost.ms, 5 * live.sample.scorable, 'the row\'s ms is the sum of its calls');
      assert.ok(c.ceiling.overall >= 0 && c.ceiling.overall <= 1);
      assert.ok(c.citedRecall.overall <= c.ceiling.overall, 'citing one memory can never recall more than the prompt held');
      assert.equal(c.adversarial.planned, 1);
      assert.equal(c.adversarial.judged, 1);
      assert.equal(c.adversarial.cost.turns, 2, 'answer and judgment, charged to the lane, not the row');
      assert.equal(c.adversarial.keyword, 0);
    }
    const doc = renderMarkdown(await runLocomoQa(available!, { samples: ['conv-30'], perCategory: 2, adversarial: 1 }), live);
    assert.match(doc, /### Which configuration won, and what it cost/);
    assert.match(doc, /wins on overall F1/);
    assert.match(doc, /### The adversarial lane/);
  });

  it('skips up front when the plan exceeds the ceiling, spending nothing', async () => {
    const env = scriptedEnv({ TANGLE_AI_MAX_CALLS: '5' });
    const { fetch, calls } = scriptedFetch();
    const live = await runLocomoQaLive(available!, { env, ...liveClients(env, fetch), samples: ['conv-30'], perCategory: 2, adversarial: 1 });
    assert.match(live.plan.skipped!, /exceed TANGLE_AI_MAX_CALLS=5/);
    assert.deepEqual(calls, { embeddings: 0, chat: 0, judge: 0 });
    assert.equal(live.spent.turns, 0);
    assert.deepEqual(live.configurations, []);
    assert.equal(validateLive(live).valid, true);
    assert.match(renderMarkdown(await runLocomoQa(available!, { samples: ['conv-30'], perCategory: 2, adversarial: 1 }), live), /\*\*Skipped up front\*\*/);
  });

  it('a wire failure is an unanswered question, counted and named, never a score', async () => {
    const env = scriptedEnv();
    const { fetch } = scriptedFetch({ fail: 500 });
    const live = await runLocomoQaLive(available!, { env, ...liveClients(env, fetch), samples: ['conv-30'], perCategory: 1, adversarial: 1 });
    for (const c of live.configurations) {
      assert.equal(c.questions.answered, 0);
      assert.equal(c.questions.unanswered.wire, c.questions.planned);
      assert.equal(c.adversarial.unanswered.wire, 1);
    }
    assert.ok(live.errors.count > 0);
    assert.ok(live.errors.sample.length <= 10);
    assert.equal(winnerOf(live), null, 'nothing answered, nothing decided');
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
    }
  });
});
