/**
 * The grounding instrument's contract: the fixture census and hashes
 * hold, the oracle reaches its exact ceilings, every named bad answer
 * lands on its one terminal outcome, the schema refuses a report whose
 * counts stop reconciling or whose decision claims what a keyless run
 * cannot, identities move when their inputs move, the committed report
 * is exactly what the command produces, and the suite's structured
 * output drives the same answer contract without network.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createStructuredOutput } from '@jarenjs/ai';

import { chatClientFor } from '../../apps/desktop/src/settings.ts';
import { completion, scriptedFetch } from '../fixtures/scripted-wire.ts';
import { describeErrors } from '../../benchmark/lib/validate.ts';
import {
  CITATION_OUTCOMES,
  GROUNDED_ANSWER_SCHEMA,
  assignClaims,
  classifyCitation,
  createGroundingValidator,
  fixtureCorpus,
  loadGroundingFixture,
  matchesPredicates,
  registrationIdOf,
  renderAnswer,
  renderGroundingMarkdown,
  reportIdOf,
  runGroundingKeyless,
  scoreAnswer,
  type AnswerValue,
  type GroundingReport,
  type Scenario,
} from '../../benchmark/lib/grounding.ts';

const loaded = await loadGroundingFixture();
const { fixture } = loaded;
const report = await runGroundingKeyless(loaded);
const validate = createGroundingValidator();
const committed = JSON.parse(await readFile('benchmark/results/grounding.json', 'utf8')) as GroundingReport;

function scenario(key: string): Scenario {
  const found = report.scenarios.find((s) => s.key === key);
  assert.ok(found, `no scenario '${key}'`);
  return found;
}

describe('the fixture census', () => {
  it('holds exactly 8 sources, 16 questions, 24 claims and at least 2 abstentions, hash-verified', () => {
    assert.equal(fixture.census.sources, 8);
    assert.equal(fixture.census.questions, 16);
    assert.equal(fixture.census.claims, 24);
    assert.ok(fixture.census.abstentions >= 2);
    assert.equal(fixture.sources.length, 8);
    assert.equal(fixture.questions.length, 16);
    assert.equal(fixture.claims.length, 24);
    assert.equal(fixture.questions.filter((q) => q.kind === 'unanswerable').length, fixture.census.abstentions);
  });

  it('carries a superseded version, a post-cutoff version, a distractor sharing vocabulary and a multi-source question', () => {
    const versions = fixture.sources.flatMap((s) => s.versions);
    assert.ok(versions.some((v) => v.status === 'superseded'));
    assert.ok(versions.some((v) => v.status === 'active' && v.admittedAt > fixture.cutoff));
    // the glossary shares the guide's vocabulary while contradicting its facts
    const glossary = fixture.elements.find((e) => e.key === 'e-pg-legacy')!;
    assert.match(glossary.quote, /port/i);
    // at least one question's claims are supported from two different sources
    const versionSource = new Map(fixture.sources.flatMap((s) => s.versions.map((v) => [v.key, s.key])));
    const elementSource = new Map(fixture.elements.map((e) => [e.key, versionSource.get(e.version)!]));
    const multi = fixture.questions.filter((q) => {
      const sources = new Set(fixture.claims.filter((c) => c.question === q.key).flatMap((c) => c.support).map((e) => elementSource.get(e)!));
      return sources.size >= 2;
    });
    assert.ok(multi.length >= 1, 'no question needs two sources');
  });

  it('resolves every claim support element and every trace chunk', () => {
    const elements = new Set(fixture.elements.map((e) => e.key));
    for (const claim of fixture.claims) for (const e of claim.support) assert.ok(elements.has(e), `${claim.key} supports unknown ${e}`);
    const chunks = new Set(fixture.chunks.map((c) => c.key));
    for (const trace of fixture.trace) {
      for (const id of [...trace.retrieved, ...trace.supplied]) assert.ok(chunks.has(id), `trace names unknown ${id}`);
    }
  });

  it('keeps the six RFC 9110 questions outside the fixture denominators', () => {
    assert.equal(fixture.rfc9110.questions.length, 6);
    const keys = new Set(fixture.questions.map((q) => q.key));
    for (const q of fixture.rfc9110.questions) assert.ok(!keys.has(q.key));
  });

  it('refuses a moved corpus byte', async () => {
    // the loader verified every digest already; a wrong manifest digest must throw
    const bad = structuredClone(fixture);
    bad.sources[0].versions[0].sha256 = 'a'.repeat(64);
    const { writeFile, mkdtemp, mkdir, cp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = await mkdtemp(join(tmpdir(), 'grounding-'));
    await mkdir(join(root, 'benchmark/fixtures/grounding'), { recursive: true });
    await cp('benchmark/fixtures/grounding/sources', join(root, 'benchmark/fixtures/grounding/sources'), { recursive: true });
    await writeFile(join(root, 'benchmark/fixtures/grounding/manifest.json'), JSON.stringify(bad));
    await assert.rejects(loadGroundingFixture(root), /does not match the manifest digest/);
  });
});

describe('the oracle gate', () => {
  it('reaches every exact ceiling', () => {
    const gate = report.gate.oracle;
    assert.equal(gate.passed, true);
    assert.deepEqual(gate.failures, []);
    assert.equal(gate.questions, 16);
    assert.equal(gate.tp, 24);
    assert.equal(gate.fp, 0);
    assert.equal(gate.fn, 0);
    assert.equal(gate.microF1, 1);
    assert.equal(gate.meanF1, 1);
    assert.equal(gate.answerF1, 1);
    assert.equal(gate.citationResolution, 1);
    assert.equal(gate.citationSupport, 1);
    assert.equal(gate.abstentionAccuracy, 1);
  });

  it('fails, named, when an oracle answer breaks', async () => {
    const bad = structuredClone(fixture);
    const oracle = bad.scripted.find((s) => s.key === 'oracle:q-relay-port')!;
    (oracle.answer as { claims: Array<{ citations: string[] }> }).claims[0].citations = [];
    const broken = await runGroundingKeyless({ ...loaded, fixture: bad });
    assert.equal(broken.gate.oracle.passed, false);
    assert.ok(broken.gate.oracle.failures.some((f) => /TP=23/.test(f)));
  });
});

describe('citation terminal outcomes', () => {
  it('reaches each named terminal exactly where the fixture scripts it', () => {
    assert.equal(scenario('bad:unknown-id').citations[0].outcome, 'unknown-evidence');
    assert.equal(scenario('bad:not-supplied').citations[0].outcome, 'not-supplied');
    assert.equal(scenario('bad:inactive-version').citations[0].outcome, 'inactive-version');
    assert.equal(scenario('bad:future-evidence').citations.at(-1)!.outcome, 'future-evidence');
    assert.equal(scenario('bad:wrong-passage').citations[0].outcome, 'resolved-not-supporting');
    assert.equal(scenario('oracle:q-relay-port').citations[0].outcome, 'supporting');
  });

  it('walks the states in the registered order and never skips one', () => {
    const corpus = fixtureCorpus(fixture);
    const trace = { retrieved: ['chk-h1-cedar'], supplied: ['chk-h1-cedar'] };
    // an id that is unknown is unknown even when "supplied"
    assert.equal(classifyCitation('chk-nope', corpus, { retrieved: [], supplied: ['chk-nope'] }, fixture.cutoff, null), 'unknown-evidence');
    // supply is checked before version status: the same superseded chunk not supplied is not-supplied
    assert.equal(classifyCitation('chk-h1-cedar', corpus, { retrieved: ['chk-h1-cedar'], supplied: [] }, fixture.cutoff, null), 'not-supplied');
    assert.equal(classifyCitation('chk-h1-cedar', corpus, trace, fixture.cutoff, null), 'inactive-version');
    // cutoff is checked before support, and support requires a matched claim
    const future = { retrieved: ['chk-fc-attach'], supplied: ['chk-fc-attach'] };
    assert.equal(classifyCitation('chk-fc-attach', corpus, future, fixture.cutoff, new Set(['e-fc-attach'])), 'future-evidence');
    const ok = { retrieved: ['chk-rg-port'], supplied: ['chk-rg-port'] };
    assert.equal(classifyCitation('chk-rg-port', corpus, ok, fixture.cutoff, new Set(['e-rg-port'])), 'supporting');
    assert.equal(classifyCitation('chk-rg-port', corpus, ok, fixture.cutoff, null), 'resolved-not-supporting');
    assert.equal(CITATION_OUTCOMES.length, 6);
  });

  it('never turns a retrieved candidate into a citation', () => {
    const uncited = scenario('bad:right-no-citation');
    assert.ok(uncited.trace.counts.retrieved > 0);
    assert.equal(uncited.citationCounts.raw, 0);
    assert.equal(uncited.citationCounts.unique, 0);
  });

  it('keeps duplicate visible ids in raw counts without multiplying set metrics', () => {
    const dup = scenario('bad:duplicate-citations');
    assert.equal(dup.citationCounts.raw, 2);
    assert.equal(dup.citationCounts.unique, 1);
    assert.equal(dup.citationCounts.supportingUnique, 1);
  });
});

describe('claim matching and scoring', () => {
  it('scores a matched claim without support as one FP and one FN', () => {
    const s = scenario('bad:right-no-citation');
    assert.equal(s.claims.tp, 0);
    assert.equal(s.claims.fp, 1);
    assert.equal(s.claims.fn, 1);
    const match = s.claims.matches.find((m) => m.claim === 'c-relay-port')!;
    assert.equal(match.matched, true);
    assert.equal(match.supported, false);
  });

  it('counts an unsupported extra claim as a false positive beside the true positives', () => {
    const s = scenario('bad:unsupported-extra');
    assert.equal(s.claims.tp, 2);
    assert.equal(s.claims.fp, 1);
    assert.equal(s.claims.fn, 0);
  });

  it('counts wrong abstention and a fabricated answer on an unanswerable question separately', () => {
    assert.equal(scenario('bad:abstain-wrong').abstention.correct, false);
    const fabricated = scenario('bad:fabricated-on-unanswerable');
    assert.equal(fabricated.abstention.correct, false);
    assert.equal(fabricated.claims.f1, null);
    assert.equal(report.summary.wrongAbstentions, 2);
  });

  it('assigns one-to-one, earliest satisfying, in manifest order', () => {
    const expected = fixture.claims.filter((c) => c.question === 'q-mooring-profile');
    const answer: AnswerValue = {
      disposition: 'answer',
      claims: [
        { id: 'a1', text: 'New moorings use the granite profile by default.', citations: [] },
        { id: 'a2', text: 'The tool falls back to the shale profile when granite is missing.', citations: [] },
      ],
    };
    const assignment = assignClaims(expected, answer);
    assert.equal(assignment.matched.get('c-mooring-profile'), 'a1');
    assert.equal(assignment.matched.get('c-mooring-fallback'), 'a2');
    // the forbidden token keeps the fallback sentence away from the default-profile claim
    assert.equal(matchesPredicates('The tool falls back to the shale profile when granite is missing.', expected[0].predicates), false);
  });

  it('renders the visible answer only from the ledger', () => {
    assert.equal(renderAnswer({ disposition: 'answer', claims: [{ id: 'a', text: 'One.', citations: [] }, { id: 'b', text: 'Two.', citations: [] }] }), 'One.; Two.');
    assert.equal(renderAnswer({ disposition: 'abstain', reason: 'nothing supports an answer', claims: [] }), 'nothing supports an answer');
  });
});

describe('the report schema', () => {
  function refused(mutate: (doc: GroundingReport) => void): boolean {
    const doc = structuredClone(report);
    mutate(doc);
    return !validate(doc).valid;
  }

  it('accepts the generated report and the committed one', () => {
    const outcome = validate(report);
    assert.ok(outcome.valid, describeErrors(outcome).join('; '));
    assert.ok(validate(committed).valid);
  });

  it('refuses a broken fixture census', () => {
    assert.ok(refused((doc) => { (doc.fixture.census as { questions: number }).questions = 15; }));
  });

  it('refuses non-reconciling terminal counts', () => {
    assert.ok(refused((doc) => { doc.scenarios[0].citationCounts.byOutcome.supporting += 1; }));
    assert.ok(refused((doc) => { doc.summary.outcomes.unknownEvidence += 1; }));
  });

  it('refuses a citation without exactly one registered terminal outcome', () => {
    assert.ok(refused((doc) => {
      const cited = doc.scenarios.find((s) => s.citations.length > 0)!;
      (cited.citations[0] as { outcome: string }).outcome = 'retrieved';
    }));
  });

  it('refuses claim counts that no longer partition the registers', () => {
    assert.ok(refused((doc) => { doc.scenarios.find((s) => s.key === 'oracle:q-relay-port')!.claims.tp += 1; }));
  });

  it('refuses a dangling or run-claiming config identity row', () => {
    assert.ok(refused((doc) => { (doc.configIdentities as { rows: Array<{ rowId: string }> }).rows[0].rowId = 'nobody'; }));
    assert.ok(refused((doc) => { (doc.configIdentities as { rows: Array<{ identityStatus: string }> }).rows[0].identityStatus = 'run'; }));
  });

  it('refuses a keyless report that claims the product decision', () => {
    assert.ok(refused((doc) => { (doc.decision as { state: string }).state = 'adopt-claim-citations'; }));
  });

  it('refuses duplicate scenario keys', () => {
    assert.ok(refused((doc) => { doc.scenarios[1].key = doc.scenarios[0].key; }));
  });
});

describe('identities', () => {
  it('move when their inputs move, and not otherwise', async () => {
    const body = {
      fixtureId: report.registration.fixtureId,
      cutoff: report.registration.cutoff,
      questionIds: report.registration.questionIds,
      claimKeys: report.registration.claimKeys,
      scorer: report.registration.scorer,
      answerSchemaRevision: report.registration.answerSchemaRevision,
    };
    assert.equal(await registrationIdOf(body), report.registration.registrationId);
    assert.notEqual(await registrationIdOf({ ...body, cutoff: '2026-01-01T00:00:00Z' }), report.registration.registrationId);
    assert.equal(await reportIdOf(report), report.reportId);
    const moved = structuredClone(report);
    moved.scenarios[0].claims.tp += 1;
    assert.notEqual(await reportIdOf(moved), report.reportId);
  });
});

describe('the committed artifacts', () => {
  it('are exactly what the command produces today', async () => {
    assert.deepEqual(committed, report);
    const { existsSync } = await import('node:fs');
    const livePath = 'benchmark/results/grounding-live.json';
    const liveDoc = existsSync(livePath) ? JSON.parse(await readFile(livePath, 'utf8')) : null;
    if (liveDoc !== null) assert.ok(validate(liveDoc).valid, 'the committed live attempt validates');
    const webPath = 'benchmark/results/grounding-web-live.json';
    const webDoc = existsSync(webPath) ? JSON.parse(await readFile(webPath, 'utf8')) : null;
    if (webDoc !== null) assert.ok(validate(webDoc).valid, 'the committed web diagnostic validates');
    const markdown = await readFile('docs/GROUNDING_BENCHMARK.md', 'utf8');
    assert.equal(markdown, `${renderGroundingMarkdown(report, liveDoc, webDoc)}\n`);
    // without a live attempt the document says the baseline is unmeasured;
    // with one it carries the paired table and the separately labelled diagnostic
    if (liveDoc === null) assert.match(markdown, /still unmeasured/);
    else {
      assert.match(markdown, /The paired baseline/);
      assert.match(markdown, /DIAGNOSTIC/);
    }
  });

  it('carry no clock, hostname, or absolute path', () => {
    const bytes = JSON.stringify(committed);
    assert.doesNotMatch(bytes, /20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/);
    assert.doesNotMatch(bytes, /home\/|Users\//);
  });
});

describe('the scripted structured-output path', () => {
  it('drives the exact answer contract through the suite without network', async () => {
    const oracle = fixture.scripted.find((s) => s.key === 'oracle:q-relay-port')!;
    const { fetch, calls } = scriptedFetch({ chat: () => ({ content: JSON.stringify(oracle.answer) }) });
    const client = chatClientFor({ provider: 'openrouter', baseUrl: null, model: 'stub', apiKey: 'k' }, { fetch, retry: { attempts: 1 } });
    const generator = createStructuredOutput({ client, schema: GROUNDED_ANSWER_SCHEMA, name: 'grounding_answer' });
    const reply = await generator.generate([{ role: 'user', content: 'q' }]) as { value: AnswerValue };
    assert.ok('value' in reply);
    const question = fixture.questions.find((q) => q.key === 'q-relay-port')!;
    const expected = fixture.claims.filter((c) => c.question === question.key);
    const trace = fixture.trace.find((t) => t.question === question.key)!;
    const scored = scoreAnswer(question, expected, reply.value, fixtureCorpus(fixture), trace, fixture.cutoff);
    assert.equal(scored.claims.f1, 1);
    assert.equal(calls.chat, 1);
    assert.equal(calls.embeddings, 0);
  });

  it('repairs once and then reports a schema-invalid reply as errors, never as an answer', async () => {
    let asked = 0;
    const { fetch } = scriptedFetch({
      chat: () => { asked++; return completion(JSON.stringify({ disposition: 'answer' })) as unknown as { content: string }; },
    });
    const client = chatClientFor({ provider: 'openrouter', baseUrl: null, model: 'stub', apiKey: 'k' }, { fetch, retry: { attempts: 1 } });
    const generator = createStructuredOutput({ client, schema: GROUNDED_ANSWER_SCHEMA, name: 'grounding_answer', maxRepairs: 1 });
    const reply = await generator.generate([{ role: 'user', content: 'q' }]) as { errors?: unknown[] };
    assert.ok(!('value' in reply));
    assert.ok((reply.errors ?? []).length > 0);
    assert.equal(asked, 2);
  });
});

describe('the import census', () => {
  it('consumes the suite and the shared instruments rather than re-implementing them', async () => {
    const lib = await readFile('benchmark/lib/grounding.ts', 'utf8');
    const cli = await readFile('benchmark/grounding.ts', 'utf8');
    assert.match(lib, /from '@jarenjs\/json\/canonical'/);
    assert.match(lib, /from '\.\/locomo-parity\.ts'/);
    assert.match(lib, /createReportValidator/);
    assert.match(lib, /from '\.\/report-envelope\.ts'/);
    for (const text of [lib, cli]) {
      assert.doesNotMatch(text, /Math\.random/);
      assert.doesNotMatch(text, /new JarenValidator/);
      assert.doesNotMatch(text, /class .*Pool|mapLimit|pLimit/);
      assert.doesNotMatch(text, /node-fetch|axios/);
    }
    const types = await readFile('benchmark/lib/grounding.types.ts', 'utf8');
    assert.match(types, /^\/\/ Generated by @jarenjs\/emit/);
  });
});

// ---------------------------------------------------------------------------
// the paired current-path baseline (scripted tier — no network, no key)
// ---------------------------------------------------------------------------

const { DEFAULT_SETTINGS, embedderFor } = await import('../../apps/desktop/src/settings.ts');
const { chatSettingsOf, embedSettingsOf, envConfigIdentity } = await import('../../benchmark/lib/ai-env.ts');
const { scriptedEnv } = await import('../fixtures/scripted-wire.ts');
const {
  GROUNDING_ANSWER_PROMPT,
  authorizationOf,
  buildFixtureCorpus,
  countingFetch,
  emptyEvidenceContext,
  executeGroundingLive,
  groundingMessages,
  liveReportIdOf,
  planGroundingLive,
} = await import('../../benchmark/lib/grounding-run.ts');
const { collectDocumentEvidence, describeDocumentEvidence, serializeDocumentEvidence, GROUNDING_DEFAULTS } = await import('../../apps/desktop/src/grounding.ts');
const { createOfflineEmbedder } = await import('@tangleai/pipeline');
const { openWireCache } = await import('../../benchmark/lib/wire-cache.ts');
type GroundingLiveDoc = import('../../benchmark/lib/grounding.types.ts').GroundingLive;
type ScriptOptions = import('../fixtures/scripted-wire.ts').ScriptOptions;
type AnswerValueT = import('../../benchmark/lib/grounding.ts').AnswerValue;

const elementQuoteOf = new Map(fixture.elements.map((e) => [e.key, e.quote]));
const fixtureQuestionByText = new Map(fixture.questions.map((q) => [q.text, q]));

/** The scripted oracle: reads ONLY ids/texts from the evidence blocks. */
function oracleHook(): NonNullable<ScriptOptions['grounding']> {
  return ({ question, evidence }) => {
    const fx = fixtureQuestionByText.get(question);
    if (fx === undefined || fx.kind === 'unanswerable') {
      return { disposition: 'abstain', reason: 'No supplied source supports an answer.', claims: [] };
    }
    const claims = fixture.claims.filter((c) => c.question === fx.key).map((c, i) => {
      const quotes = c.support.map((k) => elementQuoteOf.get(k)!);
      const hit = evidence.find((e) => quotes.some((quote) => e.text.includes(quote)));
      return { id: `a${i + 1}`, text: `${c.reference}.`, citations: hit === undefined ? [] : [hit.id] };
    });
    return { disposition: 'answer', claims };
  };
}

async function scriptedRun(options: ScriptOptions, overrides: Record<string, string> = {}, cache?: import('../../benchmark/lib/wire-cache.ts').WireCache, fetchOverride?: typeof globalThis.fetch): Promise<{ report: GroundingLiveDoc, counts: { embeddings: number, chat: number, other: number } }> {
  const env = scriptedEnv(overrides);
  const scripted = fetchOverride ?? scriptedFetch(options).fetch;
  const counted = countingFetch(scripted);
  const replay = cache?.adapter();
  const chat = chatClientFor(chatSettingsOf(env), { fetch: counted.fetch, retry: { attempts: 1 }, cache: replay });
  const embedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, counted.fetch, replay);
  const context = await planGroundingLive({ env, thinking: 'off', locomo: null, locomoSkipReason: 'the test runs the fixture stratum only', cache });
  const report = await executeGroundingLive(context, {
    env,
    chat,
    embedder,
    fetchCounts: counted.counts,
    tier: 'scripted',
    configIdentityFor: (observed) => envConfigIdentity(env, observed, 'scripted'),
    clock: () => new Date('2026-09-01T00:00:00.000Z'),
  });
  return { report, counts: counted.counts };
}

describe('the current-path helper', () => {
  it('serializes evidence byte-for-byte as the desktop prompt always has, empty case included', async () => {
    const embedder = createOfflineEmbedder();
    const built = await buildFixtureCorpus(fixture, embedder);
    try {
      const [vector] = await embedder.embed(['What TCP port does the Harbor Relay listen on by default?']);
      const outcome = await collectDocumentEvidence(built.store, vector, { model: embedder.model, dims: embedder.dims! }, GROUNDING_DEFAULTS);
      assert.ok(outcome.ok);
      const { evidence } = outcome;
      // the exact historical serialization, reconstructed independently
      const expected = `DOCUMENT CHUNKS:\n${evidence.ranked.map(({ chunk, context, source, score: s }) => {
        const expanded = context.map((item) => item.text).join('\n\n');
        return `[${chunk.id}] (${s.toFixed(3)}) ${expanded}\n    source: ${source.canonicalUrl}${chunk.pageStart === undefined ? '' : ` page ${chunk.pageStart}`}`;
      }).join('\n')}`;
      assert.equal(evidence.context, expected);
      assert.equal(serializeDocumentEvidence([]).context, 'DOCUMENT CHUNKS: (none recalled)');
      assert.equal(evidence.characters, evidence.context.length);
      assert.equal(evidence.serializedChunkIds.length - evidence.suppliedChunkIds.length, evidence.duplicateExpansions);
    } finally {
      await built.close();
    }
  });

  it('returns a failed recall as an error value, never as an empty result', async () => {
    const dead = { listSources: async () => { throw new Error('the store is gone'); } } as never;
    const outcome = await collectDocumentEvidence(dead, [0, 0], { model: 'x', dims: 2 });
    assert.ok(!outcome.ok);
    assert.match(outcome.error.message, /store is gone/);
  });

  it('runs at exactly the shipped defaults', () => {
    assert.deepEqual(GROUNDING_DEFAULTS, { k: 6, minScore: 0, maxPerSource: 2, neighbours: 1 });
  });

  it('preserves duplicate neighbour expansion instead of deduplicating it', () => {
    const chunk = (id: string, text: string) => ({ id, sourceId: 's', versionId: 'v', elementIds: [`${id}-e`], text, tokenCount: 1, order: 0, headingPath: [], embedding: [0], embeddedBy: { model: 'm', dims: 1 } });
    const source = { id: 's', requestedUrl: 'https://x.example/', finalUrl: 'https://x.example/', canonicalUrl: 'https://x.example/', title: null, mimeType: 'text/html', fetchMode: 'static', status: 'ready', fetchedAt: 'now' } as never;
    const shared = chunk('c-shared', 'shared');
    const ranked = [
      { chunk: chunk('c-a', 'a'), source, score: 0.9, context: [chunk('c-a', 'a'), shared], citation: {} as never },
      { chunk: chunk('c-b', 'b'), source, score: 0.8, context: [shared, chunk('c-b', 'b')], citation: {} as never },
    ];
    const evidence = describeDocumentEvidence(ranked as never);
    assert.equal(evidence.serializedChunkIds.length, 4);
    assert.equal(evidence.suppliedChunkIds.length, 3);
    assert.equal(evidence.duplicateExpansions, 1);
  });
});

describe('the paired scripted baseline', () => {
  it('reproduces the oracle ceiling through createStructuredOutput over the real ingested corpus', async () => {
    const { report, counts } = await scriptedRun({ grounding: oracleHook() });
    assert.ok(validate(report).valid, describeErrors(validate(report)).join('; '));
    const stratum = report.strata.find((s) => s.key === 'fixture')!;
    assert.equal(stratum.pairing.eligible, true);
    const grounded = stratum.rows.find((r) => r.key === 'grounded-answer')!;
    assert.deepEqual({ tp: grounded.claims!.tp, fp: grounded.claims!.fp, fn: grounded.claims!.fn }, { tp: 24, fp: 0, fn: 0 });
    assert.equal(grounded.claims!.meanF1, 1);
    assert.equal(grounded.citations!.byOutcome.supporting, 24);
    const retrieved = stratum.rows.find((r) => r.key === 'documents-retrieved')!;
    assert.equal(retrieved.generates, false);
    assert.equal(retrieved.cost, null);
    assert.equal(retrieved.questions.results.every((r) => r.status === 'analytic'), true);
    assert.ok(retrieved.suppliedRecall! > 0.9);
    const noDocs = stratum.rows.find((r) => r.key === 'no-documents')!;
    assert.equal(noDocs.claims!.tp, 0, 'nothing is supplied, so nothing can be supported');
    const claimComparison = stratum.pairing.comparisons.find((c) => c.metric === 'supported-claim-f1')!;
    assert.equal(claimComparison.pairs, 14);
    assert.equal(claimComparison.interval.low, 1);
    // the run's identity rows: generated rows reference the one run identity, the analytic row is not-run
    const rows = (report.configIdentities as { rows: Array<{ rowId: string, identityStatus: string }> }).rows;
    assert.equal(rows.filter((r) => r.identityStatus === 'run').length, 2);
    assert.equal(rows.filter((r) => r.identityStatus === 'not-run').length, 1);
    assert.equal(counts.chat, 32);
  });

  it('records a scripted no-support answer with zero cited sources despite retrieved candidates', async () => {
    const { report } = await scriptedRun({
      grounding: ({ question }) => fixtureQuestionByText.get(question)?.kind === 'unanswerable'
        ? { disposition: 'abstain', reason: 'No source supports an answer.', claims: [] }
        : { disposition: 'answer', claims: [{ id: 'a1', text: 'No source supports an answer to this.', citations: [] }] },
    });
    const grounded = report.strata[0].rows.find((r) => r.key === 'grounded-answer')!;
    assert.equal(grounded.citations!.raw, 0);
    assert.ok(grounded.questions.results.every((r) => r.trace === null || r.trace.retrieved.length >= 0));
    assert.ok(grounded.questions.results.some((r) => (r.trace?.retrieved.length ?? 0) > 0));
  });

  it('classifies a fabricated id from the wire as unknown-evidence without losing the pair', async () => {
    const { report } = await scriptedRun({
      grounding: ({ question }) => fixtureQuestionByText.get(question)?.kind === 'unanswerable'
        ? { disposition: 'abstain', reason: 'nothing supports it', claims: [] }
        : { disposition: 'answer', claims: [{ id: 'a1', text: 'An answer.', citations: ['chk-fabricated'] }] },
    });
    const grounded = report.strata[0].rows.find((r) => r.key === 'grounded-answer')!;
    assert.equal(grounded.citations!.byOutcome.unknownEvidence, 14);
    assert.equal(report.strata[0].pairing.eligible, true);
  });

  it('keeps a wire failure as per-question outcomes and refuses the comparison', async () => {
    const { report } = await scriptedRun({ fail: 502 });
    const stratum = report.strata[0];
    assert.equal(stratum.pairing.eligible, false);
    assert.ok(stratum.pairing.reasons.some((r) => r.code === 'wire-failure'));
    assert.equal(stratum.pairing.comparisons.length, 0);
    const grounded = stratum.rows.find((r) => r.key === 'grounded-answer')!;
    assert.equal(grounded.questions.unanswered.wire, 16);
    assert.equal(grounded.questions.results.filter((r) => r.status === 'wire-failure').length, 16);
    assert.ok(validate(report).valid);
  });

  it('counts a schema-invalid reply after repair as invalid and refuses the comparison', async () => {
    const { report } = await scriptedRun({ grounding: () => ({ content: 'not a structured answer' }) });
    const stratum = report.strata[0];
    assert.equal(stratum.pairing.eligible, false);
    assert.ok(stratum.pairing.reasons.some((r) => r.code === 'invalid-reply'));
    const grounded = stratum.rows.find((r) => r.key === 'grounded-answer')!;
    assert.equal(grounded.questions.invalid, 16);
  });

  it('stops at the budget with counted budget-stop outcomes, never a narrowed mean', async () => {
    const { report } = await scriptedRun({ grounding: oracleHook() }, { TANGLE_AI_MAX_CALLS: '40' });
    const stratum = report.strata[0];
    assert.equal(stratum.pairing.eligible, false);
    assert.ok(stratum.pairing.reasons.some((r) => r.code === 'budget-stop'));
    const budgetStopped = stratum.rows.reduce((n, r) => n + r.questions.unanswered.budget, 0);
    assert.ok(budgetStopped > 0);
    assert.ok(validate(report).valid, describeErrors(validate(report)).join('; '));
  });
});

describe('the frozen plan and its authorization', () => {
  it('computes the dry plan with exactly zero model and embedding calls', async () => {
    const env = scriptedEnv();
    const counted = countingFetch(scriptedFetch({}).fetch);
    const context = await planGroundingLive({ env, thinking: 'off', locomo: null, locomoSkipReason: 'test' });
    assert.deepEqual(counted.counts, { embeddings: 0, chat: 0, other: 0 });
    assert.equal(context.plan.chat.planned, 32);
    assert.equal(context.plan.chat.maxFreshCalls, 64);
    assert.ok(context.plan.maxFreshTotal <= env.maxCalls);
    assert.equal(context.plan.skipped, null);
    assert.equal(authorizationOf(context.plan, undefined), 'dry-run');
    assert.equal(authorizationOf(context.plan, 'not-the-plan'), 'refused');
    assert.equal(authorizationOf(context.plan, context.plan.planId), 'execute');
  });

  it('skips up front when the plan exceeds the configured ceiling', async () => {
    const env = scriptedEnv({ TANGLE_AI_MAX_CALLS: '10' });
    const context = await planGroundingLive({ env, thinking: 'off', locomo: null, locomoSkipReason: 'test' });
    assert.notEqual(context.plan.skipped, null);
    assert.match(context.plan.skipped!, /exceed TANGLE_AI_MAX_CALLS=10/);
    assert.equal(authorizationOf(context.plan, context.plan.planId), 'skipped');
  });

  it('changes the plan id when --fresh changes what would be bought', async () => {
    const env = scriptedEnv();
    const a = await planGroundingLive({ env, thinking: 'off', locomo: null, locomoSkipReason: 'test' });
    const b = await planGroundingLive({ env, thinking: 'off', locomo: null, locomoSkipReason: 'test', fresh: true });
    assert.notEqual(a.plan.planId, b.plan.planId);
    assert.equal(b.plan.fresh, true);
  });

  it('carries no credential in the plan or the report bytes', async () => {
    const { report } = await scriptedRun({ grounding: oracleHook() });
    const bytes = JSON.stringify(report);
    assert.doesNotMatch(bytes, /"k"[^e]*:"k"/);
    assert.ok(!bytes.includes('"apiKey"'));
    assert.ok(bytes.includes('OPENROUTER_AI_KEY'), 'the key VARIABLE NAME is recorded, never the value');
  });
});

describe('replay determinism', () => {
  it('reproduces the identical report identity from the cache with zero transport calls', async () => {
    const cache = await openWireCache({ path: ':memory:' });
    try {
      const first = await scriptedRun({ grounding: oracleHook() }, {}, cache);
      assert.ok(first.counts.chat > 0);
      const throwing = (async () => { throw new Error('the transport must not be touched on replay'); }) as unknown as typeof globalThis.fetch;
      const second = await scriptedRun({}, {}, cache, throwing);
      assert.deepEqual(second.counts, { embeddings: 0, chat: 0, other: 0 });
      assert.equal(second.report.reportId, first.report.reportId);
      assert.equal(await liveReportIdOf(second.report), second.report.reportId);
      assert.equal(second.report.replayed, 32);
    } finally {
      await cache.close();
    }
  });
});

describe('the live report schema', () => {
  it('refuses an eligible pairing whose generated rows differ or are incomplete', async () => {
    const { report } = await scriptedRun({ grounding: oracleHook() });
    const differing = structuredClone(report);
    differing.strata[0].rows.find((r) => r.key === 'grounded-answer')!.questionSet = 'f'.repeat(64);
    assert.ok(!validate(differing).valid);
    const incomplete = structuredClone(report);
    const row = incomplete.strata[0].rows.find((r) => r.key === 'grounded-answer')!;
    row.questions.results[0] = { ...row.questions.results[0], status: 'wire-failure' };
    assert.ok(!validate(incomplete).valid, 'answered/status counts must reconcile');
  });

  it('refuses a generating analytic row and an adoption the rows no longer support', async () => {
    const { report } = await scriptedRun({ grounding: oracleHook() });
    const generating = structuredClone(report);
    (generating.strata[0].rows.find((r) => r.key === 'documents-retrieved') as { generates: boolean }).generates = true;
    assert.ok(!validate(generating).valid);
    // the scripted oracle attempt legitimately adopts — its own rows
    // recompute every clause; break one input and the same state refuses
    assert.equal(report.decision.state, 'adopt-claim-citations');
    const forged = structuredClone(report);
    forged.strata[0].pairing.comparisons.find((c) => c.metric === 'supported-claim-f1')!.interval.low = -1;
    assert.ok(!validate(forged).valid);
  });

  it('shares one system instruction and answer schema across the rows', () => {
    const withEvidence = groundingMessages('Q?', 'DOCUMENT CHUNKS:\n[x] (0.100) text\n    source: https://x.example/');
    const without = groundingMessages('Q?', emptyEvidenceContext());
    assert.ok(withEvidence[0].content.startsWith(GROUNDING_ANSWER_PROMPT));
    assert.ok(without[0].content.startsWith(GROUNDING_ANSWER_PROMPT));
    assert.equal(without[0].content, `${GROUNDING_ANSWER_PROMPT}\n\nDOCUMENT CHUNKS: (none recalled)`);
    assert.equal(withEvidence[1].content, 'Question: Q?');
  });
});

describe('the LoCoMo stratum', () => {
  it('publishes official answer F1 and gold-element recall as a separate diagnostic, never a claim score', async () => {
    const { loadLocomo } = await import('../../benchmark/lib/locomo.ts');
    const dataset = await loadLocomo();
    if (!dataset.available || !dataset.valid) {
      assert.ok(true, 'the submodule is absent; the stratum skip path is covered below');
      return;
    }
    const env = scriptedEnv();
    const gold = new Map<string, string>();
    for (const s of dataset.samples) for (const qa of s.qa) gold.set(qa.question, String(qa.answer ?? 'unknown'));
    const { fetch } = scriptedFetch({
      grounding: ({ question, evidence }) => ({
        disposition: 'answer',
        claims: [{ id: 'a1', text: gold.get(question) ?? 'unknown', citations: evidence.length === 0 ? [] : [evidence[0].id] }],
      }),
    });
    const counted = countingFetch(fetch);
    const chat = chatClientFor(chatSettingsOf(env), { fetch: counted.fetch, retry: { attempts: 1 } });
    const embedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, counted.fetch);
    const context = await planGroundingLive({ env, thinking: 'off', locomo: { samples: dataset.samples, sha256: dataset.sha256 } });
    assert.equal(context.locomoRegistration!.questionIds.length, 16);
    const report2 = await executeGroundingLive(context, {
      env, chat, embedder, fetchCounts: counted.counts, tier: 'scripted',
      configIdentityFor: (observed) => envConfigIdentity(env, observed, 'scripted'),
      clock: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    assert.ok(validate(report2).valid, describeErrors(validate(report2)).join('; '));
    const locomo = report2.strata.find((s) => s.key === 'locomo')!;
    for (const r of locomo.rows) assert.equal(r.claims, null);
    const grounded = locomo.rows.find((r) => r.key === 'grounded-answer')!;
    assert.ok(grounded.answerF1 !== null && grounded.answerF1 > 0.5, 'the scripted gold answers score');
    assert.ok(locomo.pairing.comparisons.every((c) => c.metric === 'answer-f1'));
    const retrieved = locomo.rows.find((r) => r.key === 'documents-retrieved')!;
    assert.ok(retrieved.retrievedRecall !== null);
  });

  it('states the skip as a schema-valid reason when the release is absent', async () => {
    const { report } = await scriptedRun({ grounding: oracleHook() });
    assert.equal(report.strata.length, 1);
    assert.match(report.locomoSkipped!, /fixture stratum only/);
    assert.equal(report.locomoRegistration, null);
  });
});

describe('the run-path import census', () => {
  it('consumes the one environment reader, factory pair, replay adapter, budget account, structured output and bounded mapper', async () => {
    const run = await readFile('benchmark/lib/grounding-run.ts', 'utf8');
    const cli = await readFile('benchmark/grounding.ts', 'utf8');
    assert.match(run, /createBudgetAccount, createStructuredOutput/);
    assert.match(run, /mapConcurrent/);
    assert.match(run, /from '\.\.\/\.\.\/apps\/desktop\/src\/grounding\.ts'/);
    assert.match(run, /bootstrapInterval/);
    assert.match(cli, /readAiEnv/);
    assert.match(cli, /chatClientFor/);
    assert.match(cli, /embedderFor/);
    assert.match(cli, /openWireCache/);
    for (const text of [run, cli]) {
      assert.doesNotMatch(text, /Math\.random/);
      assert.doesNotMatch(text, /new JarenValidator/);
      assert.doesNotMatch(text, /process\.env\[/);
    }
  });
});
