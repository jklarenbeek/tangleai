/**
 * The desktop API, end to end through `dispatcher.dispatch` — plain
 * request objects in, wire responses out, no sockets. A temp folder
 * with real files exercises sync → memories → grounded chat; the
 * subscribe operation is read as its plain-JSON snapshot (the contract
 * binding's documented no-accept-header behavior).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeDriver } from '@jarenjs/db/node';
import { createDesktop, type Desktop } from '../../apps/desktop/src/server.ts';

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
    assert.equal(sync.json.report.contradiction.contradictions, 1,
      'the rate-limit conflict across files is caught');

    const after1 = await call(desktop, 'GET', '/api/status');
    assert.ok(after1.json.counts.live >= 3);

    const live = await call(desktop, 'GET', '/api/dag/live');
    assert.equal(live.status, 200, 'a subscribe op without accept: text/event-stream answers its snapshot');
    assert.equal(live.json.run.id, sync.json.runId);
    assert.equal(live.json.nodes.crystallize.status, 'ok', 'the live DAG carries per-node status');

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

  it('serves the DAG document, its mermaid projection, and the live snapshot', async () => {
    const dag = await call(desktop, 'GET', '/api/dag');
    assert.equal(dag.status, 200);
    assert.equal(dag.json.doc.$dag, '0.1');
    assert.match(dag.json.mermaid, /flowchart TD/);

    const live = await call(desktop, 'GET', '/api/dag/live');
    assert.equal(live.status, 200);
    assert.equal(live.json.run.status, 'ok',
      'after the no-op sync the live view honestly shows that run — with no nodes, because no pipeline ran');
    assert.deepEqual(live.json.nodes, {});
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
    assert.doesNotMatch(sent.json.reply.text, /100 requests per minute/,
      'the superseded figure cannot surface');
    assert.ok(sent.json.citations.length >= 1);

    const history = await call(desktop, 'GET', '/api/chat');
    assert.equal(history.json.length, 2);
    assert.deepEqual(history.json.map((m: any) => m.role), ['user', 'assistant']);
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
    assert.deepEqual(probe.json, { ok: true, model: 'hash-trigram-64', dims: 64 });
  });

  it('a configured embedding wire is probed through @jarenjs/ai, and a legacy `openai` setting reads as `custom`', async () => {
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
