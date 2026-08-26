/**
 * The desktop UI, headless — the WHOLE stack in one process with no
 * browser and no socket: the app document runs under node, its client
 * is `openHttpClient` whose injected fetch is `toFetchHandler` over the
 * real dispatcher. What the user's clicks dispatch, this dispatches.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeDriver } from '@jarenjs/db/node';
import { compileContract } from '@jarenjs/contract';
import { openHttpClient } from '@jarenjs/contract/client';
import { toFetchHandler } from '@jarenjs/contract/fetch';

import { createDesktop, type Desktop } from '../../apps/desktop/src/server.ts';
import { DESKTOP_CONTRACT } from '../../apps/desktop/src/contract.ts';
import { createTangleUi } from '../../apps/desktop/src/ui/app.ts';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 25));

describe('tangle desktop UI (headless)', () => {
  let desktop: Desktop;
  let folder: string;
  let app: any;
  const uiErrors: any[] = [];

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'tangle-ui-'));
    await writeFile(join(folder, 'notes.md'),
      'The deploy gate for this repo is npm run check and nothing else\n\nThe service listens on port 8080 by default');

    const fetchImpl = async (url: any): Promise<Response> => {
      const target = String(url);
      if (target.startsWith('http://searx.test/search')) {
        return Response.json({
          results: [
            { title: 'Alpha handbook', url: 'https://alpha.example/handbook', content: 'Alpha operations guide' },
            { title: 'Beta handbook', url: 'https://beta.example/handbook', content: 'Beta operations guide' },
          ],
          suggestions: [],
        });
      }
      return new Response(`<!doctype html><html><body><main><h1>Web handbook</h1><p>${target} documents the violet deployment channel and its verified operational procedure for every production client.</p></main></body></html>`, {
        headers: { 'content-type': 'text/html' },
      });
    };
    desktop = await createDesktop({
      driver: nodeDriver(),
      fetch: fetchImpl as any,
      presetSettings: { folder, search: { searxngUrl: 'http://searx.test' } },
      documentFetch: {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        limits: { respectRobots: false, perHostDelayMs: 0 },
      },
    });
    const handler = toFetchHandler(desktop.dispatcher);
    const client = openHttpClient(compileContract(DESKTOP_CONTRACT), {
      baseUrl: 'http://tangle.test',
      fetch: (async (url: any, init: any) => handler(new Request(url, init))) as any,
    });
    app = createTangleUi({ client, onError: (report: any) => uiErrors.push(report) });
  });

  after(async () => {
    app.destroy();
    await desktop.close();
    await rm(folder, { recursive: true, force: true });
  });

  it('boots: loads status, dag, settings through the wire', async () => {
    await settle(); // boot dispatches inside the factory

    const state = app.getState();
    assert.equal(state.status.counts.memories, 0);
    assert.match(state.loom.mermaid, /flowchart TD/);
    assert.equal(state.settings.draft.folder, folder);
    assert.ok(app.getVnode(), 'the view renders headless');
  });

  it('sync from the Loom updates runs, status and memory list', async () => {
    app.dispatch('sync');
    await settle();
    const state = app.getState();
    assert.equal(state.loom.syncing, false);
    assert.equal(state.loom.syncError, null);
    assert.equal(state.loom.runs.length, 1);
    assert.equal(state.loom.runs[0].status, 'ok');
    assert.equal(state.memory.items.length, 2);
    assert.ok(state.status.counts.live >= 2);
  });

  it('chat send flows through: optimistic user message, grounded reply, citations', async () => {
    app.dispatch('chat/input', null, { value: 'which port does the service use?' });
    // the input action reads $event.value; simulate the event object
    app.setState({ ...app.getState(), chat: { ...app.getState().chat, input: 'which port does the service use?' } });
    app.dispatch('chat/send');
    await settle();
    const state = app.getState();
    assert.equal(state.chat.busy, false);
    assert.equal(state.chat.messages.length, 2);
    assert.equal(state.chat.messages[0].role, 'user');
    assert.match(state.chat.messages[1].text, /8080/);
    assert.ok(state.chat.citations.length >= 1);
    assert.equal(state.chat.input, '');
  });

  it('run selection loads the per-node event detail', async () => {
    const runId = app.getState().loom.runs[0].id;
    app.dispatch('run/select', runId);
    await settle();
    const detail = app.getState().loom.detail;
    assert.equal(detail.run.id, runId);
    assert.ok(detail.events.some((e: any) => e.node === 'crystallize'));
  });

  it('selects SearxNG results and ingests them through the bounded batch operation', async () => {
    app.setState({
      ...app.getState(),
      documents: { ...app.getState().documents, webQ: 'operations handbooks' },
    });
    app.dispatch('documents/webSearch');
    await settle();
    const urls = app.getState().documents.webResults.map((result: any) => result.url);
    assert.equal(urls.length, 2);

    app.dispatch('documents/webSelected', urls);
    app.dispatch('documents/webIngest');
    await settle();
    await settle();
    const documents = app.getState().documents;
    assert.equal(documents.busy, false);
    assert.equal(documents.webIngestResults.length, 2);
    assert.ok(documents.webIngestResults.every((result: any) => result.outcome?.status === 'ingested'));
    assert.equal(documents.items.length, 2);
  });

  it('the whole session raised no UI errors', () => {
    assert.deepEqual(uiErrors, []);
  });
});
