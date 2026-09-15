/**
 * The desktop API, end to end through `dispatcher.dispatch` — plain
 * request objects in, wire responses out, no sockets. A temp folder
 * with real files exercises sync → memories → grounded chat; a
 * subscribe operation is read as its plain-JSON snapshot (the contract
 * binding's documented no-accept-header behavior) and, where the
 * streaming half is what is under test, over SSE through a fetch
 * handler.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeDriver } from '@jarenjs/db/node';
import { toFetchHandler } from '@jarenjs/contract/fetch';
import { createScheduler } from '@jarenjs/core/schedule';
import { PIPELINE_NODES } from '@tangleai/pipeline';
import { createDbMemoryStore, createIdentityRepository, createRunLog, openTangleDb, type TangleDb } from '@tangleai/store';
import { CHAT_ADMISSION, CONFIG_AWARE_RUN_KINDS, FOLDER_ADMISSION, createDesktop, type Desktop } from '../../apps/desktop/src/server.ts';
import { createFolderSync } from '../../apps/desktop/src/handlers.ts';
import { createSettingsStore } from '../../apps/desktop/src/settings.ts';
import { settingsStack } from '../../apps/desktop/src/ai-host.ts';
import type { DocumentRecord } from '../../apps/desktop/src/ingest.ts';

let tick = 0;
const now = (): string => `2026-08-24T14:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick++ % 60).padStart(2, '0')}Z`;

async function call(desktop: Desktop, method: string, url: string, body?: any): Promise<{ status: number, json: any }> {
  const response = await desktop.dispatcher.dispatch({
    method,
    url,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const text = typeof response.body === 'string'
    ? response.body
    : response.body === null ? '' : new TextDecoder().decode(response.body);
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
}

/** Wait until `done()` answers true, or give up — a fixed sleep loses races. */
const settle = async (done: () => boolean, deadlineMs = 4000): Promise<void> => {
  const start = Date.now();
  while (!done() && Date.now() - start < deadlineMs) await new Promise((resolve) => setTimeout(resolve, 5));
};

describe('tangle desktop API', () => {
  let desktop: Desktop;
  let folder: string;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'tangle-'));
    await writeFile(join(folder, 'ops.md'), [
      'The staging database lives on host db-staging.internal port 5432',
      '',
      'The API rate limit is 100 requests per minute',
    ].join('\n'));
    await writeFile(join(folder, 'update.md'), [
      'The API rate limit is 500 requests per minute',
      '',
      'Deploys must run the full gate before shipping to production',
    ].join('\n'));
    await mkdir(join(folder, 'node_modules'), { recursive: true });
    await writeFile(join(folder, 'node_modules', 'skip.md'), 'must never be ingested');

    desktop = await createDesktop({ driver: nodeDriver(), now, presetSettings: { folder } });
  });

  after(async () => {
    await desktop.close();
    await rm(folder, { recursive: true, force: true });
  });

  it('describes itself at the well-known path', async () => {
    const { status, json } = await call(desktop, 'GET', '/.well-known/jaren-contract');
    assert.equal(status, 200);
    assert.equal(json.id, 'tangle-desktop');
  });

  it('starts empty, syncs the folder, and the counts move', async () => {
    const empty = await call(desktop, 'GET', '/api/status');
    assert.equal(empty.status, 200);
    assert.equal(empty.json.counts.memories, 0);
    assert.equal(empty.json.folder, folder);

    const sync = await call(desktop, 'POST', '/api/folder/sync', {});
    assert.equal(sync.status, 200);
    assert.equal(sync.json.files.ingested, 2, 'node_modules is skipped by the walk');
    assert.ok(sync.json.report.novelty.admitted >= 3);
    assert.equal(sync.json.report.contradiction.contradictions, 0,
      'the measured default keeps both conflicting observations');
    assert.equal(sync.json.report.memories.live, 4);

    const after1 = await call(desktop, 'GET', '/api/status');
    assert.ok(after1.json.counts.live >= 3);

    const frames = await call(desktop, 'GET', `/api/runs/live/frames?runId=${sync.json.runId}`);
    assert.equal(frames.status, 200, 'a subscribe op without accept: text/event-stream answers its snapshot');
    assert.equal(frames.json.rows.every((row: any) => row.runId === sync.json.runId), true);
    const nodeFrames = frames.json.rows.filter((row: any) => row.kind === 'node');
    assert.equal(nodeFrames.find((row: any) => row.body.node === 'crystallize').body.status, 'ok',
      'the run\'s own record carries per-node status');
    assert.deepEqual(frames.json.rows.map((row: any) => row.seq),
      nodeFrames.map((_: any, i: number) => i + 1).concat(nodeFrames.length + 1, nodeFrames.length + 2),
      'the sequence is dense, ascending, and ends with the counted pass and the terminal frame');
    assert.equal(frames.json.rows.at(-2).kind, 'sync');
    assert.deepEqual(frames.json.rows.at(-2).body,
      { trigger: 'manual', scanned: 2, ingested: 2, skipped: 0, removed: 0, truncated: 0, orphanedUnits: 0 },
      'what the pass counted is part of the run\'s own record');
    assert.equal(frames.json.rows.at(-1).kind, 'status');
    assert.equal(frames.json.rows.at(-1).body.status, 'ok');

    // the run row and its frames are one committed truth: the count read
    // straight after the command is the whole record, not whatever landed
    const detail = await call(desktop, 'GET', `/api/runs/detail?id=${sync.json.runId}`);
    assert.equal(detail.json.frames, detail.json.events.length + 2, 'every node record, plus the counted pass and the terminal frame');
    assert.equal(detail.json.events.length, PIPELINE_NODES.length);

    const unknown = await call(desktop, 'GET', '/api/runs/live/frames?runId=r-nope');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.code, 'not-found');
    assert.equal(unknown.json.details.issues[0].code, 'TDSK1001');

    const again = await call(desktop, 'POST', '/api/folder/sync', {});
    assert.equal(again.json.files.ingested, 0, 'unchanged files are hash-skipped');
    assert.equal(again.json.report, null, 'no observations, no pipeline pass');
    assert.ok(again.json.runId, 'a no-op sync is still an honest run in the history');
  });

  it('lists runs with their per-node DAG events', async () => {
    const runs = await call(desktop, 'GET', '/api/runs');
    assert.equal(runs.status, 200);
    assert.equal(runs.json.length, 2, 'both syncs are runs — the no-op one too');
    const withReport = runs.json.find((r: any) => r.summary?.report !== null && r.summary?.report !== undefined);
    assert.ok(withReport, 'the real sync run carries its report');

    const detail = await call(desktop, 'GET', `/api/runs/detail?id=${withReport.id}`);
    assert.equal(detail.status, 200);
    const nodes = detail.json.events.map((e: any) => e.node);
    for (const id of ['embed', 'novelty', 'contradiction', 'crystallize']) {
      assert.ok(nodes.includes(id), `run history recorded '${id}'`);
    }

    const missing = await call(desktop, 'GET', '/api/runs/detail?id=r-nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.code, 'not-found');
  });

  it('serves the DAG document, its mermaid projection, and the live run window', async () => {
    const dag = await call(desktop, 'GET', '/api/dag');
    assert.equal(dag.status, 200);
    assert.equal(dag.json.doc.$dag, '0.1');
    assert.match(dag.json.mermaid, /flowchart TD/);

    const window = await call(desktop, 'GET', '/api/runs/live?limit=5');
    assert.equal(window.status, 200);
    assert.equal(window.json.rows.length, 2, 'both syncs are in the window, newest first');
    assert.equal(window.json.rows[0].kind, 'sync');
    assert.equal(window.json.rows[0].identityStatus, 'run');

    // the no-op sync is an honest run that says what it counted and
    // nothing else: no pipeline ran, so it recorded no node
    const idle = window.json.rows[0];
    const frames = await call(desktop, 'GET', `/api/runs/live/frames?runId=${idle.id}`);
    assert.deepEqual(frames.json.rows.map((row: any) => row.kind), ['sync', 'status']);
    assert.equal(frames.json.rows[0].body.ingested, 0);
    assert.equal(frames.json.rows[0].body.removed, 0);
    assert.equal(frames.json.rows[1].body.status, 'ok');

    assert.equal((await call(desktop, 'GET', '/api/dag/live')).status, 404,
      'nothing answers "whatever is running now" any more');
  });

  it('searches memories and refuses a missing id with 404', async () => {
    const hits = await call(desktop, 'GET', '/api/memories?q=rate%20limit');
    assert.equal(hits.status, 200);
    assert.ok(hits.json.length >= 1);
    assert.equal(hits.json[0].hasEmbedding, true);
    assert.equal(hits.json[0].embedding, undefined, 'vectors never cross the wire');
    assert.ok(hits.json[0].evidence.includes('.md#'), 'evidence cites the source file');

    const one = await call(desktop, 'GET', `/api/memories/detail?id=${hits.json[0].id}`);
    assert.equal(one.status, 200);

    const missing = await call(desktop, 'GET', '/api/memories/detail?id=m-nope');
    assert.equal(missing.status, 404);
  });

  it('chat answers grounded and offline, with citations, and keeps history', async () => {
    const sent = await call(desktop, 'POST', '/api/chat', { text: 'what is the current api rate limit?' });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.provider, null, 'no model configured — offline grounded answer');
    assert.match(sent.json.reply.text, /500 requests per minute/);
    assert.match(sent.json.reply.text, /100 requests per minute/,
      'inert defaults preserve conflicting observations in grounded recall');
    assert.ok(sent.json.citations.length >= 1);

    const history = await call(desktop, 'GET', '/api/chat');
    assert.equal(history.json.length, 2);
    assert.deepEqual(history.json.map((m: any) => m.role), ['user', 'assistant']);

    // the reply IS a decision: a verdict on it has something to resolve,
    // and the transcript surface is unchanged by recording it
    const form = await call(desktop, 'GET', `/api/feedback?messageId=${encodeURIComponent(sent.json.reply.id)}`);
    assert.equal(form.status, 200);
    assert.equal(form.json.eligible, true, 'a reply under a real identity carries a decision');
    assert.equal(typeof form.json.decisionId, 'string');
    assert.equal(form.json.submitted, null, 'recording the decision is not recording a verdict');
  });

  it('validates input at the boundary — an empty chat message never reaches the engine', async () => {
    const bad = await call(desktop, 'POST', '/api/chat', { text: '' });
    assert.equal(bad.status, 400);
  });

  it('probe reports the unconfigured provider as a value, not an error', async () => {
    const probe = await call(desktop, 'GET', '/api/provider/probe');
    assert.equal(probe.status, 200);
    assert.equal(probe.json.ok, false);
  });

  it('the embed probe answers for the built-in embedder without a network', async () => {
    const probe = await call(desktop, 'GET', '/api/embed/probe');
    assert.equal(probe.status, 200);
    assert.deepEqual(probe.json, { ok: true, model: 'hash-trigram-512', dims: 512 });
  });

  it('a configured embedding wire is probed through the models package, and a legacy `openai` setting reads as `custom`', async () => {
    let seen: string | null = null;
    const scripted = async (url: any): Promise<Response> => {
      seen = String(url);
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const stubbed = await createDesktop({
      driver: nodeDriver(),
      now,
      fetch: scripted as any,
      presetSettings: {
        folder,
        embed: { provider: 'openai' as any, baseUrl: 'http://stub.local:8000/v1', model: 'stub-embed', apiKey: 'k' },
      },
    });
    try {
      const settings = await call(stubbed, 'GET', '/api/settings');
      assert.equal(settings.json.embed.provider, 'custom');
      const probe = await call(stubbed, 'GET', '/api/embed/probe');
      assert.deepEqual(probe.json, { ok: true, model: 'stub-embed', dims: 3 });
      assert.equal(seen, 'http://stub.local:8000/v1/embeddings');
    } finally {
      await stubbed.close();
    }
  });

  /** The memory ids and texts a grounded prompt listed, read back out of the wire request. */
  function listedIds(body: any): string[] {
    const system: string = body.messages.find((m: any) => m.role === 'system' && String(m.content).includes('MEMORIES:'))?.content ?? '';
    return [...system.matchAll(/^\[([^\]]+)\] \([\d.]+\) /gm)].map((m) => m[1] as string);
  }

  function structuredCompletion(value: unknown): Response {
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: 'stub',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  async function configuredDesktop(scripted: (body: any) => Response | Promise<Response>): Promise<Desktop> {
    const impl = async (_url: any, init?: any): Promise<Response> => scripted(JSON.parse(String(init?.body ?? '{}')));
    const stubbed = await createDesktop({
      driver: nodeDriver(),
      now,
      fetch: impl as any,
      presetSettings: {
        folder,
        chat: { provider: 'ollama', baseUrl: 'http://stub.local:11434', model: 'stub-model', apiKey: null },
      },
    });
    await call(stubbed, 'POST', '/api/folder/sync', {});
    return stubbed;
  }

  it('a configured model answers under the measured claims contract, and only answer-named ids become citations', async () => {
    let listed: string[] = [];
    const stubbed = await configuredDesktop((body) => {
      listed = listedIds(body);
      return structuredCompletion({
        disposition: 'answer',
        claims: [{ id: 'a1', text: 'The API rate limit is 500 requests per minute.', citations: [listed[0]] }],
      });
    });
    try {
      const sent = await call(stubbed, 'POST', '/api/chat', { text: 'what is the rate limit?' });
      assert.equal(sent.status, 200);
      assert.equal(sent.json.provider, 'ollama/stub-model');
      assert.equal(sent.json.reply.text, 'The API rate limit is 500 requests per minute.');
      assert.ok(listed.length >= 2, 'more than one candidate was retrieved');
      assert.deepEqual(sent.json.reply.citations, [listed[0]], 'the unused candidates never became citations');
      assert.equal(sent.json.citations.length, 1);
      assert.equal(sent.json.citations[0].id, listed[0]);
      assert.deepEqual(sent.json.documentCitations, []);
      // the persisted history carries the same answer-named citations
      const history = await call(stubbed, 'GET', '/api/chat');
      const persisted = history.json.at(-1);
      assert.deepEqual(persisted.citations, [listed[0]]);
    } finally {
      await stubbed.close();
    }
  });

  it('a fabricated citation id is repaired through the supplied-reference gate', async () => {
    let asked = 0;
    let listed: string[] = [];
    const stubbed = await configuredDesktop((body) => {
      asked++;
      listed = listedIds(body);
      if (asked === 1) {
        return structuredCompletion({ disposition: 'answer', claims: [{ id: 'a1', text: 'The limit is 500 requests per minute.', citations: ['mem-fabricated'] }] });
      }
      return structuredCompletion({ disposition: 'answer', claims: [{ id: 'a1', text: 'The limit is 500 requests per minute.', citations: [listed[0]] }] });
    });
    try {
      const sent = await call(stubbed, 'POST', '/api/chat', { text: 'limit?' });
      assert.equal(asked, 2, 'the one bounded repair corrected the fabricated id');
      assert.deepEqual(sent.json.reply.citations, [listed[0]]);
      assert.equal(sent.json.provider, 'ollama/stub-model');
    } finally {
      await stubbed.close();
    }
  });

  it('a permanently invalid reply degrades to visibly quoted grounded recall — the failure is a value', async () => {
    let asked = 0;
    const stubbed = await configuredDesktop(() => {
      asked++;
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'The limit is 500 rpm, no JSON here.' }, finish_reason: 'stop' }],
        usage: {},
        model: 'stub',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    try {
      const sent = await call(stubbed, 'POST', '/api/chat', { text: 'limit?' });
      assert.equal(sent.status, 200);
      assert.equal(asked, 2, 'one attempt plus one bounded repair, then the value degrades');
      assert.equal(sent.json.provider, null, 'no model answer was accepted');
      assert.match(sent.json.reply.text, /failed the grounded answer contract/);
      assert.match(sent.json.reply.text, /Grounded recall:/, 'the degraded answer quotes its sources, so its citations are used');
      assert.ok(sent.json.citations.length >= 1, 'the quoted sources stay cited');
    } finally {
      await stubbed.close();
    }
  });

  it('an explicit abstention carries zero citations even though candidates were retrieved', async () => {
    const stubbed = await configuredDesktop(() => structuredCompletion({
      disposition: 'abstain',
      reason: 'No source supports an answer.',
      claims: [],
    }));
    try {
      const sent = await call(stubbed, 'POST', '/api/chat', { text: 'what is the moon made of?' });
      assert.equal(sent.json.reply.text, 'No source supports an answer.');
      assert.deepEqual(sent.json.reply.citations, []);
      assert.deepEqual(sent.json.citations, []);
      assert.deepEqual(sent.json.documentCitations, []);
    } finally {
      await stubbed.close();
    }
  });
});

/**
 * How a run is addressed today, pinned so a change has to say it changed
 * something. Both assertions below describe current behavior that is
 * wrong, not behavior worth keeping: they exist because a later
 * correction should turn a red test green rather than assert a property
 * nobody ever watched fail.
 */

/**
 * Run addressing: every live thing names its run, resumes by its own
 * sequence, and never shows another run's frame.
 */
describe('run-addressed streams', () => {
  let desktop: Desktop;
  let folder: string;

  const page = async (url: any): Promise<Response> =>
    new Response(
      `<!doctype html><html><body><main><h1>Web handbook</h1><p>${String(url)} documents the violet deployment channel and its verified operational procedure for every production client.</p></main></body></html>`,
      { headers: { 'content-type': 'text/html' } },
    );

  /**
   * Read an SSE stream until it has said what the test asked for. A live
   * subscription does not end by itself, so `until` — not an end event —
   * is what stops the read; a quiet stream is released by the idle bound.
   */
  async function readStream(
    target: Desktop,
    url: string,
    lastEventId?: string,
    until: (events: Array<{ event: string, id: string | null, data: any }>) => boolean = () => false,
  ): Promise<Array<{ event: string, id: string | null, data: any }>> {
    const handler = toFetchHandler(target.dispatcher);
    const controller = new AbortController();
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    if (lastEventId !== undefined) headers['last-event-id'] = lastEventId;
    const response = await handler(new Request(`http://tangle.test${url}`, { headers, signal: controller.signal }));
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const events: Array<{ event: string, id: string | null, data: any }> = [];
    let buffer = '';
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const idle = new Promise<null>((resolve) => setTimeout(() => resolve(null), 500));
      const next = await Promise.race([reader.read(), idle]);
      if (next === null) break; // nothing more is coming
      const { done, value } = next;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf('\n\n');
      while (cut !== -1) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const lines = block.split('\n').filter((line) => !line.startsWith(':'));
        if (lines.length > 0) {
          const field = (name: string): string | null => {
            const line = lines.find((entry) => entry.startsWith(`${name}: `));
            return line === undefined ? null : line.slice(name.length + 2);
          };
          const data = field('data');
          events.push({ event: field('event') ?? 'message', id: field('id'), data: data === null ? null : JSON.parse(data) });
        }
        cut = buffer.indexOf('\n\n');
      }
      if (events.some((entry) => entry.event === 'end' || entry.event === 'error') || until(events)) break;
    }
    controller.abort();
    await reader.cancel().catch(() => undefined);
    return events;
  }

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'tangle-addressing-'));
    await writeFile(join(folder, 'notes.md'), [
      'The staging database lives on host db-staging.internal port 5432',
      '',
      'The API rate limit is 100 requests per minute',
    ].join('\n'));
    desktop = await createDesktop({
      driver: nodeDriver(),
      now,
      fetch: page as any,
      presetSettings: { folder },
      documentFetch: {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        limits: { respectRobots: false, perHostDelayMs: 0 },
      },
    });
  });

  after(async () => {
    await desktop.close();
    await rm(folder, { recursive: true, force: true });
  });

  it('keeps two interleaved runs in separate address spaces', async () => {
    const [sync, ingest] = await Promise.all([
      call(desktop, 'POST', '/api/folder/sync', {}),
      call(desktop, 'POST', '/api/documents/ingest', { url: 'https://alpha.example/handbook' }),
    ]);
    assert.equal(sync.status, 200);
    assert.equal(ingest.status, 200);

    const runs = await call(desktop, 'GET', '/api/runs');
    const document = runs.json.find((run: any) => run.kind === 'document');
    assert.ok(document, 'the ingest is its own run in the history');
    assert.notEqual(document.id, sync.json.runId);

    for (const runId of [sync.json.runId, document.id]) {
      const frames = await call(desktop, 'GET', `/api/runs/live/frames?runId=${runId}`);
      assert.equal(frames.status, 200);
      assert.ok(frames.json.rows.length > 0, `run ${runId} recorded frames of its own`);
      assert.equal(frames.json.rows.every((row: any) => row.runId === runId), true,
        'a subscriber sees exactly the run it named');
      assert.deepEqual(frames.json.rows.map((row: any) => row.seq), frames.json.rows.map((_: any, i: number) => i + 1),
        'each run numbers its own frames from one');
      assert.equal(frames.json.rows.at(-1).kind, 'status');
    }

    // both runs are readable in full, and neither erased the other
    const syncNodes = (await call(desktop, 'GET', `/api/runs/detail?id=${sync.json.runId}`)).json.events.map((e: any) => e.node);
    assert.deepEqual([...syncNodes].sort(), [...PIPELINE_NODES].sort());
  });

  it('streams a snapshot then patches, and resumes by seq without a lost or duplicated frame', async () => {
    const log = createRunLog(desktop.db, { now });
    const run = await log.startRun('probe');
    await log.appendFrame(run.id, { kind: 'delta', body: { text: 'one', chars: 3 } });
    await log.appendFrame(run.id, { kind: 'delta', body: { text: 'two', chars: 3 } });

    const opened = readStream(desktop, `/api/runs/live/frames?runId=${run.id}`, undefined,
      (seen) => seen.filter((entry) => entry.event === 'patch').length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 60));
    await log.appendFrame(run.id, { kind: 'delta', body: { text: 'three', chars: 5 } });
    await log.finishRun(run.id, 'ok', { probe: true });
    const events = await opened;

    const snapshot = events.find((entry) => entry.event === 'snapshot');
    assert.ok(snapshot, 'the stream opens with a snapshot');
    assert.equal(snapshot.data.resumed, false);
    assert.deepEqual(snapshot.data.value.rows.map((row: any) => row.seq), [1, 2]);
    const patches = events.filter((entry) => entry.event === 'patch');
    assert.deepEqual(patches.map((entry) => entry.data.seq), [3, 4], 'the live half carries the frames the snapshot did not');
    assert.deepEqual(patches.map((entry) => Number(entry.id)), [3, 4], 'the event id IS the frame seq');
    assert.equal(patches.at(-1)!.data.patch[0].value.kind, 'status');

    // a reconnect names the seq it reached; replay delivers exactly the
    // frames above it, once, and no snapshot to apply them onto
    const resumed = await readStream(desktop, `/api/runs/live/frames?runId=${run.id}`, '2',
      (seen) => seen.filter((entry) => entry.event === 'patch').length >= 2);
    assert.equal(resumed.some((entry) => entry.event === 'snapshot'), false, 'a resumed stream re-seeds nothing');
    const replayed = resumed.filter((entry) => entry.event === 'patch');
    assert.deepEqual(replayed.map((entry) => entry.data.seq), [3, 4]);
    assert.deepEqual(replayed.flatMap((entry) => entry.data.patch.map((op: any) => op.value.id)),
      [`${run.id}:00000003`, `${run.id}:00000004`], 'exactly the missing frames, each once');

    const exhausted = await readStream(desktop, `/api/runs/live/frames?runId=${run.id}`, '4');
    assert.deepEqual(exhausted.filter((entry) => entry.event === 'patch'), [], 'a cursor at the head replays nothing');
  });

  it('ends a chat run as cancelled when the wire never answers, and says so in the transcript', async () => {
    let stopped = false;
    const waiting: Array<() => void> = [];
    const releaseAll = (): void => {
      stopped = true;
      while (waiting.length > 0) (waiting.pop() as () => void)();
    };
    const hung = async (_url: any, init?: any): Promise<Response> => new Promise((_resolve, reject) => {
      if (stopped) { reject(new Error('released')); return; }
      waiting.push(() => reject(new Error('released')));
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const stubbed = await createDesktop({
      driver: nodeDriver(),
      now,
      fetch: hung as any,
      presetSettings: { folder, chat: { provider: 'ollama', baseUrl: 'http://stub.local:11434', model: 'stub-model', apiKey: null } },
    });
    try {
      const started = await call(stubbed, 'POST', '/api/chat/start', { text: 'what is the rate limit?' });
      assert.equal(started.status, 200);
      assert.ok(started.json.runId);
      await new Promise((resolve) => setTimeout(resolve, 80));

      const cancelled = await call(stubbed, 'POST', '/api/runs/cancel', { runId: started.json.runId });
      assert.equal(cancelled.status, 200);
      assert.deepEqual(cancelled.json, { runId: started.json.runId, status: 'running', cancelled: true, issues: [] });

      const deadline = Date.now() + 4000;
      let detail = await call(stubbed, 'GET', `/api/runs/detail?id=${started.json.runId}`);
      while (detail.json.run.status === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        detail = await call(stubbed, 'GET', `/api/runs/detail?id=${started.json.runId}`);
      }
      assert.equal(detail.json.run.status, 'cancelled', 'a cancelled run is neither ok nor error');

      const frames = await call(stubbed, 'GET', `/api/runs/live/frames?runId=${started.json.runId}`);
      const terminal = frames.json.rows.at(-1);
      assert.equal(terminal.kind, 'status');
      assert.equal(terminal.body.status, 'cancelled');

      const history = await call(stubbed, 'GET', '/api/chat');
      assert.equal(history.json.at(-1).role, 'assistant');
      assert.match(history.json.at(-1).text, /cancelled/);

      // asking again is a value, not an error
      const again = await call(stubbed, 'POST', '/api/runs/cancel', { runId: started.json.runId });
      assert.equal(again.status, 200);
      assert.equal(again.json.cancelled, false);
      assert.equal(again.json.status, 'cancelled');
      assert.equal(again.json.issues[0].code, 'TDSK1002');
    } finally {
      releaseAll();
      await stubbed.close();
    }
  });

  it('refuses a question past the admission bound as a value', async () => {
    let released = false;
    const waiting: Array<() => void> = [];
    const releaseAll = (): void => {
      released = true;
      while (waiting.length > 0) (waiting.pop() as () => void)();
    };
    const held = async (_url: any, init?: any): Promise<Response> => new Promise((_resolve, reject) => {
      if (released) { reject(new Error('released')); return; }
      waiting.push(() => reject(new Error('released')));
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const stubbed = await createDesktop({
      driver: nodeDriver(),
      now,
      fetch: held as any,
      presetSettings: { folder, chat: { provider: 'ollama', baseUrl: 'http://stub.local:11434', model: 'stub-model', apiKey: null } },
    });
    try {
      // the bound is what runs plus what may wait; the request past it is
      // answered, not queued behind an unbounded backlog
      const admitted = [];
      for (let i = 0; i < CHAT_ADMISSION.concurrency + CHAT_ADMISSION.maxQueue; i++) {
        admitted.push(call(stubbed, 'POST', '/api/chat/start', { text: `question ${i}` }));
        // each request reaches admission before the next is made, so the
        // bound is measured rather than raced
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const refused = await call(stubbed, 'POST', '/api/chat/start', { text: 'one too many' });
      assert.equal(refused.status, 429);
      assert.equal(refused.json.code, 'busy');
      assert.equal(refused.json.details.issues[0].code, 'TDSK1004');
      assert.equal(refused.json.details.issues[0].detail, 'queue-full');

      releaseAll();
      const opened = await Promise.all(admitted);
      assert.equal(opened.every((entry) => entry.status === 200), true, 'every admitted question opened a run');
    } finally {
      releaseAll();
      await stubbed.close();
    }
  });

  it('records what a streamed answer did: deltas, usage, identity, the answer and one terminal frame', async () => {
    const chunk = (text: string): string =>
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
    const streamed = async (_url: any, init?: any): Promise<Response> => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const answer = JSON.stringify({
        disposition: 'answer',
        claims: [{ id: 'a1', text: 'The API rate limit is 100 requests per minute.', citations: [] }],
      });
      if (body.stream !== true) {
        return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer } }], usage: { total_tokens: 9 } }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const halves = [answer.slice(0, Math.floor(answer.length / 2)), answer.slice(Math.floor(answer.length / 2))];
      return new Response(`${chunk(halves[0])}${chunk(halves[1])}data: [DONE]\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const stubbed = await createDesktop({
      driver: nodeDriver(),
      now,
      fetch: streamed as any,
      presetSettings: { folder, chat: { provider: 'ollama', baseUrl: 'http://stub.local:11434', model: 'stub-model', apiKey: null } },
    });
    try {
      await call(stubbed, 'POST', '/api/folder/sync', {});
      const sent = await call(stubbed, 'POST', '/api/chat', { text: 'what is the rate limit?' });
      assert.equal(sent.status, 200);
      assert.equal(sent.json.reply.text, 'The API rate limit is 100 requests per minute.');

      const runs = await call(stubbed, 'GET', '/api/runs');
      const chatRun = runs.json.find((run: any) => run.kind === 'chat');
      assert.ok(chatRun, 'a question is a run');
      assert.equal(chatRun.status, 'ok');
      assert.equal(chatRun.identityStatus, 'run', 'a chat run says what stack produced it');

      const frames = (await call(stubbed, 'GET', `/api/runs/live/frames?runId=${chatRun.id}`)).json.rows;
      const kinds = frames.map((row: any) => row.kind);
      assert.ok(kinds.filter((kind: string) => kind === 'delta').length >= 1, 'the generation was observable');
      assert.equal(kinds.filter((kind: string) => kind === 'usage').length, 1);
      assert.equal(kinds.filter((kind: string) => kind === 'identity').length, 1);
      assert.equal(kinds.filter((kind: string) => kind === 'retrieval').length, 1);
      assert.equal(kinds.filter((kind: string) => kind === 'answer').length, 1);
      assert.equal(kinds.filter((kind: string) => kind === 'status').length, 1);
      assert.equal(kinds.at(-1), 'status');
      assert.equal(frames.find((row: any) => row.kind === 'answer').body.messageId, sent.json.reply.id);
      assert.equal(frames.find((row: any) => row.kind === 'answer').body.provider, 'ollama/stub-model');
      assert.ok(frames.find((row: any) => row.kind === 'retrieval').body.memories >= 1);
      assert.equal(frames.every((row: any) => !JSON.stringify(row.body).includes('MEMORIES:')), true,
        'a frame carries counts and addresses, never the prompt');
    } finally {
      await stubbed.close();
    }
  });

  it('names a dead embedding wire as a degradation and still answers', async () => {
    const dead = async (url: any): Promise<Response> => {
      if (String(url).includes('/embeddings')) return new Response('no', { status: 500 });
      return new Response('no', { status: 500 });
    };
    const stubbed = await createDesktop({
      driver: nodeDriver(),
      now,
      fetch: dead as any,
      presetSettings: {
        folder,
        embed: { provider: 'ollama', baseUrl: 'http://stub.local:11434', model: 'stub-embed', apiKey: null },
      },
    });
    try {
      const sent = await call(stubbed, 'POST', '/api/chat', { text: 'what is the rate limit?' });
      assert.equal(sent.status, 200, 'a dead embedding wire degrades recall, never chat');
      assert.ok(sent.json.reply.text.length > 0);

      const runs = await call(stubbed, 'GET', '/api/runs');
      const chatRun = runs.json.find((run: any) => run.kind === 'chat');
      const frames = (await call(stubbed, 'GET', `/api/runs/live/frames?runId=${chatRun.id}`)).json.rows;
      const degraded = frames.filter((row: any) => row.kind === 'degraded').map((row: any) => row.body.reason);
      assert.ok(degraded.includes('embedding'), `the run names the failure: ${JSON.stringify(degraded)}`);
      assert.equal(frames.find((row: any) => row.kind === 'retrieval').body.memories, 0,
        'the retrieval frame reports the empty recall as a count, not as silence');
      // an embedder that never answered cannot finalize an identity, and a
      // run that cannot say what stack produced it does not complete
      assert.equal(chatRun.status, 'error');
      assert.equal(typeof chatRun.summary.refused, 'string');
      assert.equal(frames.at(-1).body.status, 'error');
    } finally {
      await stubbed.close();
    }
  });
});

/**
 * The counted folder pass, built from its own seams so the embedder can
 * be counted: a pass that changes nothing must call it zero times.
 */
describe('the counted folder pass', () => {
  let db: TangleDb;
  let folder: string;
  let embedCalls: number;
  let sync: ReturnType<typeof createFolderSync>;
  let scheduler: ReturnType<typeof createScheduler>;

  const paragraph = (n: number): string => `Statement number ${n} is long enough to survive the minimum unit length.`;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'tangle-counted-'));
    await writeFile(join(folder, 'keep.md'), [paragraph(1), '', paragraph(2)].join('\n'));
    await writeFile(join(folder, 'gone.md'), [paragraph(3), '', paragraph(4)].join('\n'));
    // 65 paragraphs against a 64-piece bound: ingested, and said to be partial
    await writeFile(join(folder, 'long.md'), Array.from({ length: 65 }, (_, i) => paragraph(100 + i)).join('\n\n'));

    db = await openTangleDb({ driver: nodeDriver(), capture: { mode: 'auto' } });
    const memoryStore = createDbMemoryStore(db.collection('memories'));
    const runLog = createRunLog(db, { now, configAwareKinds: CONFIG_AWARE_RUN_KINDS });
    const settings = createSettingsStore(db);
    await settings.write({ folder });
    scheduler = createScheduler({ ...FOLDER_ADMISSION });
    embedCalls = 0;
    sync = createFolderSync({
      db,
      memoryStore,
      runLog,
      settings,
      identities: createIdentityRepository(db),
      scheduler,
      now,
      stackFor: async (current, options) => {
        const stack = await settingsStack(current, options);
        // the built-in embedder resolves ready; counting its calls is the
        // whole point of this seam
        if (stack.state !== 'ready') return stack;
        const inner = stack.embedder;
        return {
          ...stack,
          embedder: {
            model: inner.model,
            dims: inner.dims,
            embed: (texts: string[], embedOptions?: { signal?: AbortSignal }) => {
              embedCalls += 1;
              return inner.embed(texts, embedOptions);
            },
          },
        };
      },
    });
  });

  after(async () => {
    await scheduler.close();
    await db.close();
    await rm(folder, { recursive: true, force: true });
  });

  it('counts what it took in part, what it left and what it never touched', async () => {
    const first = await sync.scan('manual');
    assert.equal(first.ok, true);
    assert.equal(first.ok === true && first.trigger, 'manual');
    const counts = first.ok === true ? first.files : null;
    assert.deepEqual(counts, {
      scanned: 3, ingested: 3, skipped: 0, removed: 0, truncated: 1, orphanedUnits: 0,
    }, 'the file past the piece bound is ingested AND reported partial');
    assert.ok(embedCalls > 0, 'the first pass embedded what it read');

    const documents = db.collection<DocumentRecord>('documents');
    assert.equal((await documents.get('long.md'))?.chunks, 64, 'the shipped bound is unchanged; only the silence is');
  });

  it('writes nothing and embeds nothing when nothing changed', async () => {
    const before = await db.collection('memories').execute({ $for: { m: '$[*]' }, $return: '$m' });
    const unitsBefore = [...(before as any)].length;
    const documentsBefore = [...(await db.collection('documents').execute({ $for: { d: '$[*]' }, $return: '$d' }) as any)]
      .map((row: any) => JSON.stringify(row)).sort();
    const runsBefore = (await createRunLog(db, { now }).listRuns(500)).length;
    embedCalls = 0;

    const again = await sync.scan('manual');
    assert.equal(again.ok, true);
    assert.deepEqual(again.ok === true && again.files, {
      scanned: 3, ingested: 0, skipped: 3, removed: 0, truncated: 0, orphanedUnits: 0,
    });
    assert.equal(again.ok === true && again.report, null, 'no observations, no pipeline pass');
    assert.equal(embedCalls, 0, 'a pass that changes nothing calls the embedder zero times');

    const after = [...(await db.collection('memories').execute({ $for: { m: '$[*]' }, $return: '$m' }) as any)].length;
    assert.equal(after, unitsBefore, 'zero memory units created');
    const documentsAfter = [...(await db.collection('documents').execute({ $for: { d: '$[*]' }, $return: '$d' }) as any)]
      .map((row: any) => JSON.stringify(row)).sort();
    assert.deepEqual(documentsAfter, documentsBefore, 'zero documents rows written — ingestedAt included');

    const log = createRunLog(db, { now });
    const runs = await log.listRuns(500);
    assert.equal(runs.length, runsBefore + 1, 'exactly one run row: a pass that happened is a fact');
    const detail = await log.getRun(again.ok === true ? again.runId : '');
    assert.equal(detail?.frames, 2, 'exactly two frames: what it counted, then how it ended');
    const frames = await log.frames(again.ok === true ? again.runId : '');
    assert.deepEqual(frames.map((frame) => frame.kind), ['sync', 'status']);
    assert.equal(frames.some((frame) => frame.kind === 'node'), false, 'no node ran, so no node is claimed');
    assert.deepEqual(frames[0].body, {
      trigger: 'manual', scanned: 3, ingested: 0, skipped: 3, removed: 0, truncated: 0, orphanedUnits: 0,
    });
  });

  it('deletes the row of a file that left and counts the units it stranded, deleting none', async () => {
    const strandedEvidence = (units: any[]): any[] => units.filter((unit) => unit.evidence.startsWith('gone.md#'));
    const memories = createDbMemoryStore(db.collection('memories'));
    const before = strandedEvidence(await memories.list());
    assert.ok(before.length > 0, 'the file that is about to leave has units');

    await rm(join(folder, 'gone.md'));
    const outcome = await sync.scan('change');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok === true && outcome.trigger, 'change');
    assert.equal(outcome.ok === true && outcome.files.removed, 1);
    assert.equal(outcome.ok === true && outcome.files.orphanedUnits, before.length);
    assert.ok(outcome.ok === true && outcome.files.orphanedUnits > 0);
    assert.equal(outcome.ok === true && outcome.files.scanned, 2);

    assert.equal(await db.collection<DocumentRecord>('documents').get('gone.md'), undefined,
      'the stale hash is gone, so the same path can be ingested again');

    const after = await memories.list();
    const stranded = strandedEvidence(after);
    assert.equal(stranded.length, before.length, 'the watcher deletes no memory unit');
    assert.equal(stranded.every((unit) => unit.supersededBy === undefined), true,
      'a deleted file is not evidence that a statement became false');
    assert.deepEqual(stranded.map((unit) => unit.id).sort(), before.map((unit) => unit.id).sort());
  });

  it('refuses a third concurrent pass as a value while the second waits', async () => {
    const outcomes = await Promise.all([sync.scan('manual'), sync.scan('manual'), sync.scan('manual')]);
    const refusals = outcomes.filter((outcome) => !outcome.ok);
    assert.equal(refusals.length, 1, 'one runs, one waits, the third is refused');
    const refused = refusals[0];
    assert.equal(refused.ok === false && refused.refused, 'queue-full');
    assert.deepEqual(refused.ok === false && refused.issues, [{
      code: 'TDSK1004', path: '/folder',
      detail: 'a folder sync is already running and one more is queued',
    }]);
  });
});

/**
 * The watched folder over the wire, against the real `node:fs` watch:
 * what the host observed is a read, a click during a pass is a value,
 * and moving the folder in Settings moves the watch.
 */
describe('the watched folder', () => {
  let desktop: Desktop;
  let folder: string;
  let elsewhere: string;

  const sentence = (n: number): string => `Watched statement ${n} is long enough to become a unit.`;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'tangle-watched-'));
    elsewhere = await mkdtemp(join(tmpdir(), 'tangle-moved-'));
    await writeFile(join(folder, 'seed.md'), [sentence(1), '', sentence(2)].join('\n'));
    // a corpus a pass takes real time to walk, so admission is what
    // decides the order of three clicks rather than the clock
    await mkdir(join(folder, 'filler'), { recursive: true });
    for (let i = 0; i < 150; i++) await writeFile(join(folder, 'filler', `f${i}.md`), 'too short to be a unit');
    await writeFile(join(elsewhere, 'other.md'), [sentence(9), '', sentence(10)].join('\n'));
    desktop = await createDesktop({
      driver: nodeDriver(),
      now,
      presetSettings: { folder },
      watch: { enabled: true, debounceMs: 25 },
    });
    // the counter moves when the pass opens its run; the corpus is only
    // there once that run ends
    await settle(() => desktop.watcher.state().scans.start === 1);
    const deadline = Date.now() + 20_000;
    let finished = false;
    while (!finished && Date.now() < deadline) {
      const runs = await call(desktop, 'GET', '/api/runs');
      finished = runs.json.some((row: any) => row.kind === 'sync' && row.status === 'ok');
      if (!finished) await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });

  after(async () => {
    await desktop.close();
    await rm(folder, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  });

  it('scans at start without a click and says what it observed', async () => {
    const watch = await call(desktop, 'GET', '/api/folder/watch');
    assert.equal(watch.status, 200);
    assert.equal(watch.json.enabled, true);
    assert.equal(watch.json.folder, folder);
    assert.equal(watch.json.mode, 'recursive', 'this platform accepted a recursive watch');
    assert.equal(watch.json.scans.start, 1, 'a restart cannot leave the corpus stale');
    assert.equal(watch.json.overflows, 0);
    assert.deepEqual(watch.json.refused, { 'queue-full': 0, closed: 0, cancelled: 0, deadline: 0 });
    assert.deepEqual(watch.json.unscanned, { 'no-folder': 0, 'bad-folder': 0, 'config-refused': 0, failed: 0 });
    assert.deepEqual(watch.json.issues, []);
    assert.ok(watch.json.lastRunId, 'the pass names the run a reader can open');

    const started = await call(desktop, 'GET', `/api/runs/detail?id=${watch.json.lastRunId}`);
    assert.equal(started.json.run.kind, 'sync');
    assert.equal(started.json.run.status, 'ok');
    const status = await call(desktop, 'GET', '/api/status');
    assert.ok(status.json.counts.live >= 2, 'nobody clicked anything');
    assert.equal(status.json.counts.documents, 151, 'every scanned file has a row, unit-bearing or not');
  });

  it('ingests a file written into the folder, with no click at all', async () => {
    await writeFile(join(folder, 'arrived.md'), [sentence(3), '', sentence(4)].join('\n'));

    // a write can reach the watcher as more than one event, so the pass
    // that took the file in is found by what it did, not by being last
    let ingesting: any = null;
    const deadline = Date.now() + 10_000;
    while (ingesting === null && Date.now() < deadline) {
      const runs = await call(desktop, 'GET', '/api/runs');
      ingesting = runs.json.find((row: any) =>
        row.kind === 'sync' && row.summary?.trigger === 'change' && (row.summary?.files?.ingested ?? 0) >= 1) ?? null;
      if (ingesting === null) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(ingesting !== null, 'a watcher-triggered pass took the new file in');

    const state = desktop.watcher.state();
    assert.ok(state.events > 0, 'the filesystem event reached the watcher');
    assert.ok(state.scans.change >= 1);
    const frames = await call(desktop, 'GET', `/api/runs/live/frames?runId=${ingesting.id}`);
    const counted = frames.json.rows.find((row: any) => row.kind === 'sync');
    assert.equal(counted.body.trigger, 'change', 'the run says what asked for it');
    assert.ok(counted.body.ingested >= 1);
    assert.ok(frames.json.rows.some((row: any) => row.kind === 'node'), 'a pass with work records its stages');
  });

  it('refuses a third concurrent click as sync-busy, never as a bad folder', async () => {
    // let the watcher settle first: what is under test is admission
    await settle(() => desktop.watcher.state().lastRunId !== null, 8000);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const first = call(desktop, 'POST', '/api/folder/sync', {});
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const [second, third] = [call(desktop, 'POST', '/api/folder/sync', {}), call(desktop, 'POST', '/api/folder/sync', {})];
    const answers = await Promise.all([first, second, third]);

    const refused = answers.filter((answer) => answer.status === 409);
    assert.equal(refused.length, 1, 'one pass runs, one waits, the third is refused');
    assert.equal(refused[0].json.code, 'sync-busy');
    assert.equal(refused[0].json.details.issues[0].code, 'TDSK1004');
    assert.equal(refused[0].json.details.issues[0].path, '/folder');
    assert.equal(answers.filter((answer) => answer.status === 200).length, 2);
    for (const answer of answers.filter((a) => a.status === 200)) {
      assert.equal(answer.json.trigger, 'manual');
      assert.equal(typeof answer.json.files.removed, 'number');
      assert.equal(typeof answer.json.files.truncated, 'number');
      assert.equal(typeof answer.json.files.orphanedUnits, 'number');
    }
  });

  it('moves the watch when Settings moves the folder', async () => {
    const before = desktop.watcher.state().scans.start;
    const saved = await call(desktop, 'POST', '/api/settings', { settings: { folder: elsewhere } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.folder, elsewhere);

    const watch = await call(desktop, 'GET', '/api/folder/watch');
    assert.equal(watch.json.folder, elsewhere, 'the watched folder IS the setting');
    assert.equal(watch.json.scans.start, before + 1, 'the new folder gets its own full scan');
    assert.equal(watch.json.mode, 'recursive');

    // a save that does not move the folder does not rescan
    const again = await call(desktop, 'POST', '/api/settings', { settings: { folder: elsewhere } });
    assert.equal(again.status, 200);
    assert.equal((await call(desktop, 'GET', '/api/folder/watch')).json.scans.start, before + 1);
  });
});

/** One owner for admission, one owner for timers — asserted over the source. */
describe('the desktop has exactly one admission owner', () => {
  it('keeps createScheduler in the assembly file and the flag out of the handlers', async () => {
    const sources = await readdir('apps/desktop/src');
    const files = sources.filter((name) => name.endsWith('.ts'));
    const withScheduler: string[] = [];
    const withTimers: string[] = [];
    for (const name of files) {
      const text = await readFile(join('apps/desktop/src', name), 'utf8');
      if (text.includes('createScheduler(')) withScheduler.push(name);
      if (/\bsetInterval\(|\bsetTimeout\(/.test(text)) withTimers.push(name);
    }
    assert.deepEqual(withScheduler, ['server.ts'], 'admission is constructed in one place');
    assert.deepEqual(withTimers, [], 'the debounce is the suite\'s abortable sleep, not a raw timer');

    const handlers = await readFile('apps/desktop/src/handlers.ts', 'utf8');
    assert.equal(/\bsyncing\b/.test(handlers), false, 'the module-scope busy flag is gone; the scheduler is the bound');
  });
});

describe('a named profile selection reaches the run row', () => {
  let folder: string;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'tangle-profile-'));
    await writeFile(join(folder, 'notes.md'), [
      'The nightly export finishes before the morning standby window opens.',
      '',
      'Retention for the export archive is ninety days, then it is deleted.',
    ].join('\n'));
  });

  after(async () => { await rm(folder, { recursive: true, force: true }); });

  it('records the selected identity on the run it produced, and runs.get shows it', async () => {
    // the key is merely HELD for the candidate's provider — resolution is
    // pure and keyless, the pass embeds with the built-in embedder, and
    // nothing leaves the host
    const desktopWithProfile = await createDesktop({
      driver: nodeDriver(),
      now,
      fetch: (() => { throw new Error('a selected profile resolves without calling anything'); }) as never,
      presetSettings: { folder, profile: 'desktop-default', chat: { provider: 'openrouter', baseUrl: null, model: null, apiKey: 'k' } },
    });
    try {
      const synced = await call(desktopWithProfile, 'POST', '/api/folder/sync');
      assert.equal(synced.status, 200);
      assert.ok(synced.json.runId);

      const detail = await call(desktopWithProfile, 'GET', `/api/runs/detail?id=${synced.json.runId}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.json.run.identityStatus, 'run');
      assert.equal(typeof detail.json.run.identityId, 'string');
      const identity = detail.json.identity;
      assert.notEqual(identity, null, 'runs.get answers the identity the row names');
      assert.equal(identity.identityId, detail.json.run.identityId);
      assert.equal(identity.requested.kind, 'profile');
      assert.equal(identity.requested.profile, 'desktop-default');
      assert.equal(identity.roles.chat.model, 'z-ai/glm-5.3-flash');
      assert.equal(identity.embedding.provider, 'builtin');

      // a list stays a list: the status, never a whole identity per row
      const rows = await call(desktopWithProfile, 'GET', '/api/runs');
      assert.equal(rows.json.every((row: any) => row.identity === undefined), true);
      assert.equal(rows.json.find((row: any) => row.id === synced.json.runId).identityStatus, 'run');
    } finally {
      await desktopWithProfile.close();
    }
  });

  it('refuses every run producer uniformly under a refused selection, and never answers offline', async () => {
    const refusing = await createDesktop({
      driver: nodeDriver(),
      now,
      fetch: (() => { throw new Error('a refused selection calls nothing'); }) as never,
      presetSettings: { folder, profile: 'desktop-default' },
    });
    try {
      const issuesOf = (json: any): string[] =>
        (json?.error?.details?.issues ?? json?.details?.issues ?? json?.issues ?? []).map((issue: any) => `${issue.code} ${issue.path}`);

      const sync = await call(refusing, 'POST', '/api/folder/sync');
      assert.equal(sync.status, 409);
      assert.deepEqual(issuesOf(sync.json), ['TCFG1015 /roles/chat/capability']);

      const ingest = await call(refusing, 'POST', '/api/documents/ingest', { url: 'https://example.com/a' });
      assert.equal(ingest.status, 409);
      assert.deepEqual(issuesOf(ingest.json), ['TCFG1015 /roles/chat/capability']);

      const batch = await call(refusing, 'POST', '/api/documents/ingest-many', { urls: ['https://example.com/a'] });
      assert.equal(batch.status, 409);
      assert.deepEqual(issuesOf(batch.json), ['TCFG1015 /roles/chat/capability']);

      // a started chat run carries its refusal as the run's own terminal
      // value: the request is admitted, the RUN is refused, and the frame
      // names the same issue the three request-shaped producers answered
      const started = await call(refusing, 'POST', '/api/chat/start', { text: 'what is the retention window?' });
      assert.equal(started.status, 200);
      const deadline = Date.now() + 4000;
      let startedDetail = await call(refusing, 'GET', `/api/runs/detail?id=${started.json.runId}`);
      while (startedDetail.json.run.status === 'running' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        startedDetail = await call(refusing, 'GET', `/api/runs/detail?id=${started.json.runId}`);
      }
      assert.equal(startedDetail.json.run.status, 'error');
      assert.equal(startedDetail.json.identity, null, 'a refused run resolved no identity to show');
      const startedFrames = await call(refusing, 'GET', `/api/runs/live/frames?runId=${started.json.runId}`);
      const degraded = startedFrames.json.rows.find((row: any) => row.kind === 'degraded');
      assert.equal(degraded.body.reason, 'refused');
      assert.match(degraded.body.detail, /TCFG1015/);

      // chat.send answers the refusal reply, never a grounded-recall answer
      const sent = await call(refusing, 'POST', '/api/chat', { text: 'what is the retention window?' });
      assert.equal(sent.status, 200);
      assert.equal(sent.json.reply.identityId, null);
      assert.equal(sent.json.reply.provider, null);
      assert.deepEqual(sent.json.citations, []);
      assert.deepEqual(sent.json.documentCitations, []);
      assert.match(sent.json.reply.text, /TCFG1015/);
      assert.equal(/ninety days/.test(sent.json.reply.text), false, 'a refused configuration answers issues, not sources');
    } finally {
      await refusing.close();
    }
  });
});
