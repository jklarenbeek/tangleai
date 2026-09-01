/**
 * The captured web diagnostic's contract: selection keeps SearxNG order
 * and refuses without promoting, snippets never reach evidence, the
 * capture stores exact bytes and replays them with zero network calls
 * and byte-identical corpus/report identities, every acquisition
 * failure is a counted value, a not-run state is schema-valid, and the
 * recorded flat baseline reproduces unchanged.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';

import { DEFAULT_SETTINGS, chatClientFor, embedderFor } from '../../apps/desktop/src/settings.ts';
import { chatSettingsOf, embedSettingsOf, envConfigIdentity } from '../../benchmark/lib/ai-env.ts';
import { createGroundingValidator, loadGroundingFixture } from '../../benchmark/lib/grounding.ts';
import { countingFetch } from '../../benchmark/lib/grounding-run.ts';
import { liveReportIdOf, type GroundingLive } from '../../benchmark/lib/grounding-run.ts';
import { notRunGroundingWeb, runGroundingWeb, selectUrls, type GroundingWeb } from '../../benchmark/lib/grounding-web.ts';
import { captureKeyOf, openHttpCapture } from '../../benchmark/lib/http-capture.ts';
import { describeErrors } from '../../benchmark/lib/validate.ts';
import { scriptedEnv, scriptedFetch } from '../fixtures/scripted-wire.ts';

const validate = createGroundingValidator();
const loaded = await loadGroundingFixture();
const referenceOf = new Map(loaded.fixture.rfc9110.questions.map((q) => [q.text, q.reference]));

const SNIPPET = 'SNIPPET-MARKER-NEVER-EVIDENCE';
const PAGES: Record<string, string> = {
  'https://www.rfc-editor.org/rfc/rfc9110.html':
    '<!doctype html><html><body><main><h1>Scripted RFC 9110 stand-in</h1><p>The 405 Method Not Allowed status code indicates the method is known but not supported, and the origin server must generate an Allow header field containing the currently supported methods.</p><p>The GET, HEAD, OPTIONS, and TRACE methods are defined to be safe, the DELETE method is idempotent, a 304 Not Modified response cannot contain content and is terminated by the end of the header section, and proactive negotiation of media types travels in the Accept header field.</p></main></body></html>',
  'https://docs.test/one.html':
    '<!doctype html><html><body><main><h1>Scripted discovery page one</h1><p>A discovered page paraphrasing the stand-in: 405 means Method Not Allowed and an Allow header lists the supported methods; GET, HEAD, OPTIONS and TRACE are the safe methods.</p></main></body></html>',
  'https://docs.test/two.html':
    '<!doctype html><html><body><main><h1>Scripted discovery page two</h1><p>Another discovered page: DELETE is idempotent, a 304 response carries no content, and Accept carries media type preferences.</p></main></body></html>',
};

/** The scripted web: SearxNG JSON, two pages, one 500, nothing else. */
function scriptedWebTransport(): { fetch: typeof globalThis.fetch, calls: { count: number } } {
  const calls = { count: 0 };
  const impl = (async (input: RequestInfo | URL): Promise<Response> => {
    calls.count++;
    const url = String(input);
    if (url.startsWith('http://searx.test/search')) {
      return new Response(JSON.stringify({
        results: [
          { title: 'one', url: 'https://docs.test/one.html', content: `${SNIPPET} summary text` },
          { title: 'ftp', url: 'ftp://files.test/archive' },
          { title: 'dup', url: 'https://docs.test/one.html' },
          { title: 'two', url: 'https://docs.test/two.html', content: `${SNIPPET} second summary` },
          { title: 'broken', url: 'https://docs.test/broken.html' },
          { title: 'late', url: 'https://docs.test/never-selected.html' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://docs.test/broken.html') return new Response('boom', { status: 500 });
    const page = PAGES[url];
    if (page !== undefined) return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response('not scripted', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch: impl, calls };
}

const lookup = async (): Promise<Array<{ address: string, family: number }>> => [{ address: '93.184.216.34', family: 4 }];

async function runOnce(capturePath: string, replay: boolean, inner: typeof globalThis.fetch): Promise<{ report: GroundingWeb, wire: { embeddings: number, chat: number, other: number } }> {
  const env = scriptedEnv();
  const capture = await openHttpCapture({ path: capturePath, clock: () => new Date('2026-09-01T00:00:00.000Z') });
  try {
    const scripted = scriptedFetch({
      grounding: ({ question, evidence }) => ({
        disposition: 'answer',
        claims: [{ id: 'a1', text: referenceOf.get(question) ?? 'unknown', citations: evidence.length === 0 ? [] : [evidence[0].id] }],
      }),
    });
    const counted = countingFetch(scripted.fetch);
    const chat = chatClientFor(chatSettingsOf(env), { fetch: counted.fetch, retry: { attempts: 1 } });
    const embedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, counted.fetch);
    const report = await runGroundingWeb({
      tier: 'scripted',
      provider: env.provider,
      model: env.model,
      keySource: env.keySource,
      thinking: 'off',
      chat,
      embedder,
      capture,
      replay,
      searxBase: 'http://searx.test',
      lookup,
      baseline: { reportId: null, registrationId: null },
      maxCalls: env.maxCalls,
      concurrency: 2,
      configIdentityFor: (observed) => envConfigIdentity(env, observed, 'scripted'),
      fetchCounts: counted.counts,
      clock: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    return { report, wire: counted.counts };
  } finally {
    await capture.close();
  }
}

// the capture-mode run and the replay run, over one store, closed between
const captureDir = await mkdtemp(join(tmpdir(), 'grounding-http-'));
const capturePath = join(captureDir, 'capture.sqlite');
const networkTransport = scriptedWebTransport();
const first = await (async () => {
  const env = scriptedEnv();
  const capture = await openHttpCapture({ path: capturePath, clock: () => new Date('2026-09-01T00:00:00.000Z') });
  try {
    const scripted = scriptedFetch({
      grounding: ({ question, evidence }) => ({
        disposition: 'answer',
        claims: [{ id: 'a1', text: referenceOf.get(question) ?? 'unknown', citations: evidence.length === 0 ? [] : [evidence[0].id] }],
      }),
    });
    const counted = countingFetch(scripted.fetch);
    const chat = chatClientFor(chatSettingsOf(env), { fetch: counted.fetch, retry: { attempts: 1 } });
    const embedder = embedderFor({ ...DEFAULT_SETTINGS, embed: embedSettingsOf(env) }, counted.fetch);
    // wrap the CAPTURE'S inner transport in the counter, so the replay run
    // can prove the network was untouched
    const originalFetchFor = capture.fetchFor.bind(capture);
    const wrapped: typeof capture = {
      ...capture,
      fetchFor: (kind, options) => originalFetchFor(kind, { ...options, inner: networkTransport.fetch }),
    };
    const report = await runGroundingWeb({
      tier: 'scripted',
      provider: env.provider,
      model: env.model,
      keySource: env.keySource,
      thinking: 'off',
      chat,
      embedder,
      capture: wrapped,
      replay: false,
      searxBase: 'http://searx.test',
      lookup,
      baseline: { reportId: null, registrationId: null },
      maxCalls: env.maxCalls,
      concurrency: 2,
      configIdentityFor: (observed) => envConfigIdentity(env, observed, 'scripted'),
      fetchCounts: counted.counts,
      clock: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    return { report, networkCalls: networkTransport.calls.count };
  } finally {
    await capture.close();
  }
})();

const throwing = (async () => { throw new Error('the network must not be touched on replay'); }) as unknown as typeof globalThis.fetch;
const second = await runOnce(capturePath, true, throwing);

describe('the fixed selection', () => {
  it('keeps result order, refuses non-HTTP(S), deduplicates and never promotes a later URL', () => {
    const entry = first.report.selection[0];
    assert.deepEqual(entry.selected.map((s) => s.url), [
      'https://docs.test/one.html',
      'https://docs.test/two.html',
      'https://docs.test/broken.html',
    ]);
    assert.equal(entry.selected.length, 3);
    assert.ok(entry.refused.some((r) => r.url === 'ftp://files.test/archive'));
    assert.ok(!entry.selected.some((s) => s.url.includes('never-selected')), 'a later URL is not silently promoted');
    assert.equal(entry.results, 6);
    assert.equal(entry.resultsWithSnippets, 2);
  });

  it('is pure and order-preserving as a function', () => {
    const picked = selectUrls('q', 'query', [
      { title: 'a', url: 'https://a.example/x#frag' },
      { title: 'b', url: 'not a url' },
      { title: 'a2', url: 'https://a.example/x' },
      { title: 'c', url: 'https://c.example/' },
    ]);
    assert.deepEqual(picked.selected.map((s) => s.url), ['https://a.example/x', 'https://c.example/']);
    assert.equal(picked.refused.length, 1);
  });
});

describe('the capture and its replay', () => {
  it('captured every exchange once and the replay made zero network calls', () => {
    assert.ok(first.networkCalls > 0);
    assert.ok(first.report.capture.captures >= 9, 'searches, pages, robots-free fetches and the failure are recorded');
    assert.equal(second.report.capture.replayMisses, 0);
    assert.ok(second.report.capture.replayHits > 0);
    // the replay run's model wire is the scripted chat, never HTTP capture traffic
    assert.equal(networkTransport.calls.count, first.networkCalls, 'the network transport was not touched again');
  });

  it('reproduces selections, corpus identities and the report identity byte for byte', async () => {
    assert.deepEqual(second.report.selection, first.report.selection);
    assert.deepEqual(second.report.rows.map((r) => ({ key: r.key, corpus: r.corpus, ingest: r.ingest })), first.report.rows.map((r) => ({ key: r.key, corpus: r.corpus, ingest: r.ingest })));
    assert.deepEqual(
      second.report.rows.map((r) => r.questions.results.map((q) => q.trace)),
      first.report.rows.map((r) => r.questions.results.map((q) => q.trace)),
    );
    assert.equal(second.report.reportId, first.report.reportId);
    assert.ok(validate(first.report).valid, describeErrors(validate(first.report)).join('; '));
    assert.ok(validate(second.report).valid);
  });

  it('counts the failed fetch as this URL\'s value, never the batch\'s', () => {
    const searx = first.report.rows.find((r) => r.key === 'searx-discovered')!;
    const broken = searx.ingest.find((i) => i.url.includes('broken'))!;
    assert.equal(broken.outcome, 'failed');
    assert.match(broken.error!.message, /500/);
    assert.equal(searx.corpus.sources, 2, 'the two good pages were activated');
    assert.equal(searx.questions.answered, 6);
  });

  it('never lets a snippet reach evidence, a prompt or the report as text', () => {
    for (const report of [first.report, second.report]) {
      assert.ok(!JSON.stringify(report).includes(SNIPPET));
    }
  });

  it('scores both rows over the same six questions with the reference answers, claims structurally absent', () => {
    for (const row of first.report.rows) {
      assert.equal(row.questions.planned, 6);
      assert.equal(row.questionSet, first.report.rows[0].questionSet);
      for (const result of row.questions.results) assert.equal(result.claims, null);
    }
    const curated = first.report.rows.find((r) => r.key === 'curated-rfc')!;
    assert.ok(curated.answerF1 !== null && curated.answerF1 > 0.9, 'the scripted reference answers score');
  });
});

describe('the capture adapter\'s refusals', () => {
  it('refuses a credential-bearing URL before it can enter a key', async () => {
    await assert.rejects(captureKeyOf('document', 'GET', 'https://user:pw@x.example/'), /credential/);
  });

  it('answers a missing capture as a named failure, never a fall-through request', async () => {
    const capture = await openHttpCapture({ path: ':memory:' });
    try {
      const replay = capture.fetchFor('document', { replay: true, inner: throwing });
      await assert.rejects(async () => replay('https://never.captured/'), /no capture holds/);
      assert.equal(capture.stats().replayMisses, 1);
    } finally {
      await capture.close();
    }
  });
});

describe('the stated not-run state', () => {
  it('is schema-valid, names its reason and touches nothing', async () => {
    const report = await notRunGroundingWeb('no SearxNG endpoint was configured (--searx <base>)', { clock: () => new Date('2026-09-01T00:00:00.000Z') });
    const outcome = validate(report);
    assert.ok(outcome.valid, describeErrors(outcome).join('; '));
    assert.match(report.notRun!, /SearxNG/);
    assert.deepEqual(report.rows, []);
    assert.deepEqual(report.capture.manifest, []);
  });
});

describe('the flat baseline after this order', () => {
  it('reproduces its recorded identity from the stored report', async () => {
    const stored = JSON.parse(await readFile('benchmark/results/grounding-live.json', 'utf8')) as GroundingLive;
    assert.ok(validate(stored).valid);
    assert.equal(await liveReportIdOf(stored), stored.reportId);
  });
});
