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

/** Wait for the app to reach a condition (default: one macrotask breath) — a fixed sleep loses races under a loaded runner. */
const settle = async (done: () => boolean = () => true, deadlineMs = 4000): Promise<void> => {
  const start = Date.now();
  do {
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (!done() && Date.now() - start < deadlineMs);
};

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

  it('holds one run\'s frames at a time: watching another replaces the rows', async () => {
    const handler = toFetchHandler(desktop.dispatcher);
    const wire = openHttpClient(compileContract(DESKTOP_CONTRACT), {
      baseUrl: 'http://tangle.test', fetch: (url: any, init: any) => handler(new Request(url, init)),
    });
    const isolated = createTangleUi({ client: { invoke: wire.invoke } });
    try {
      const frame = (runId: string, seq: number, node: string): any =>
        ({ id: `${runId}:${String(seq).padStart(8, '0')}`, runId, seq, at: '2026-09-14T00:00:00.000Z', kind: 'node', body: { node, status: 'ok', ms: 1 } });
      isolated.dispatch('loom/follow', 'r-a');
      isolated.dispatch('loom/frames', { runId: 'r-a', rows: [frame('r-a', 1, 'embed'), frame('r-a', 2, 'report')], lastSeq: 2 });
      assert.equal(isolated.getState().loom.watch, 'r-a');
      assert.equal(isolated.getState().loom.frames.lastSeq, 2);

      // watching a second run replaces the picture with that run's own;
      // the two runs' frames are never merged, and the Loom draws
      // nothing until the slot names the run it is watching
      isolated.dispatch('loom/follow', 'r-b');
      assert.equal(isolated.getState().loom.watch, 'r-b');
      assert.notEqual(isolated.getState().loom.frames.runId, isolated.getState().loom.watch);
      assert.equal(JSON.stringify(isolated.getVnode()).includes('embed'), false,
        'the earlier run\'s nodes are not drawn under the newly watched run');
      isolated.dispatch('loom/frames', { runId: 'r-b', rows: [frame('r-b', 1, 'fetch')], lastSeq: 1 });
      assert.deepEqual(isolated.getState().loom.frames.rows.map((row: any) => row.runId), ['r-b']);

      // a lost stream asks for a fresh attempt, which is what restarts
      // the subscription at the seq the rows already reached
      isolated.dispatch('loom/frameLost', 1);
      assert.equal(isolated.getState().loom.frameAttempt, 1);
      assert.equal(isolated.getState().loom.frames.lastSeq, 1, 'the cursor survives the restart');
    } finally { isolated.destroy(); wire.close(); }
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
    await settle(() => !app.getState().loom.syncing && app.getState().loom.runs.rows.length > 0 && app.getState().memory.items.length > 0);
    const state = app.getState();
    assert.equal(state.loom.syncing, false);
    assert.equal(state.loom.syncError, null);
    assert.equal(state.loom.runs.rows.length, 1);
    assert.equal(state.loom.runs.rows[0].status, 'ok');
    await settle(() => app.getState().loom.frames.rows.some((row: any) => row.kind === 'status'));
    const watched = app.getState();
    assert.equal(watched.loom.watch, watched.loom.runs.rows[0].id, 'the Loom follows the run it watched start');
    assert.equal(watched.loom.frames.runId, watched.loom.watch);
    const terminal = watched.loom.frames.rows.find((row: any) => row.kind === 'status');
    assert.equal(terminal.body.status, 'ok');
    assert.equal(watched.loom.frames.rows.every((row: any) => row.runId === watched.loom.watch), true,
      'a subscriber never sees another run\'s frame');
    assert.equal(state.memory.items.length, 2);
    assert.ok(state.status.counts.live >= 2);
  });

  it('shows what the host watcher observed, and a refused slot as a note rather than a failure', async () => {
    const watched = await mkdtemp(join(tmpdir(), 'tangle-ui-watch-'));
    await writeFile(join(watched, 'seed.md'),
      'The watcher scans at start so a restart cannot leave the corpus stale\n\nA second statement long enough to become a unit');
    const local = await createDesktop({
      driver: nodeDriver(),
      presetSettings: { folder: watched },
      watch: { enabled: true, debounceMs: 25 },
    });
    const handler = toFetchHandler(local.dispatcher);
    const client = openHttpClient(compileContract(DESKTOP_CONTRACT), {
      baseUrl: 'http://tangle.test',
      fetch: (async (url: any, init: any) => handler(new Request(url, init))) as any,
    });
    const errors: any[] = [];
    const local_app = createTangleUi({ client, onError: (report: any) => errors.push(report) });
    try {
      await settle(() => local_app.getState().loom.watcher !== null);
      assert.equal(local_app.getState().loom.watcher.enabled, true);
      // the counts move when the run's own `sync` frame arrives, so the
      // surface never shows a number it was not told
      await settle(() => (local_app.getState().loom.watcher?.scans.start ?? 0) >= 1);
      const observed = local_app.getState().loom.watcher;
      assert.equal(observed.folder, watched);
      assert.equal(observed.mode, 'recursive');
      assert.equal(observed.scans.start, 1, 'the start scan happened without a click');
      assert.ok(observed.lastRunId, 'the pass names the run the Loom is already following');

      local_app.dispatch('nav', 'loom');
      await settle(() => local_app.getVnode() !== undefined);
      const dom = JSON.stringify(local_app.getVnode());
      assert.match(dom, /watching /, 'the Loom says what the host is watching');
      assert.match(dom, /recursive/, 'the observed capability is shown, not assumed');
      assert.match(dom, /scans: \d+ start/, 'the numbers are the watcher\'s own');

      // the Loom follows the run the watcher started, with nothing clicked
      await settle(() => local_app.getState().loom.runs.rows.length > 0);
      const state = local_app.getState();
      assert.equal(state.loom.watch, state.loom.runs.rows[0].id,
        'a watcher-started run is followed with no click and no new subscription');

      local_app.dispatch('sync/busy', 'a folder sync is already running and one more is queued');
      await settle(() => local_app.getState().loom.syncNote !== null);
      assert.equal(local_app.getState().loom.syncError, null, 'a refused slot is not a failure');
      assert.equal(local_app.getState().loom.syncing, false);
      await settle(() => JSON.stringify(local_app.getVnode()).includes('already running'));
      assert.match(JSON.stringify(local_app.getVnode()), /sync-note/, 'the refusal renders beside the button, not as an error');
      assert.equal(errors.length, 0, JSON.stringify(errors[0] ?? null));
    } finally {
      local_app.destroy();
      await local.close();
      await rm(watched, { recursive: true, force: true });
    }
  });

  it('reads a finished run\'s frames as a plain snapshot when no stream is available', async () => {
    const localDesktop = await createDesktop({ driver: nodeDriver(), presetSettings: { folder } });
    const handler = toFetchHandler(localDesktop.dispatcher);
    const wire = openHttpClient(compileContract(DESKTOP_CONTRACT), {
      baseUrl: 'http://tangle.test', fetch: (url: any, init: any) => handler(new Request(url, init)),
    });
    const isolated = createTangleUi({ client: { invoke: wire.invoke } });
    try {
      isolated.dispatch('sync');
      await settle(() => isolated.getState().loom.frames.rows.length > 0);
      const frames = isolated.getState().loom.frames;
      assert.equal(frames.rows.filter((row: any) => row.kind === 'node').length, 6);
      assert.equal(frames.rows.at(-1).kind, 'status', 'the terminal frame is committed with the run row');
      assert.equal(frames.lastSeq, frames.rows.length);
    } finally { isolated.destroy(); wire.close(); await localDesktop.close(); }
  });

  it('chat send flows through: optimistic user message, grounded reply, citations', async () => {
    app.dispatch('chat/input', null, { value: 'which port does the service use?' });
    // the input action reads $event.value; simulate the event object
    app.setState({ ...app.getState(), chat: { ...app.getState().chat, input: 'which port does the service use?' } });
    app.dispatch('chat/send');
    await settle(() => !app.getState().chat.busy && app.getState().chat.messages.length >= 2);
    const state = app.getState();
    assert.equal(state.chat.busy, false);
    assert.equal(state.chat.messages.length, 2);
    assert.equal(state.chat.messages[0].role, 'user');
    assert.match(state.chat.messages[1].text, /8080/);
    // the answer's citations are the ids it named, carried on the
    // persisted reply and rendered from what the surface holds
    assert.ok(state.chat.messages[1].citations.length >= 1);
    assert.equal(JSON.stringify(app.getVnode()).includes('"citation"'), true, 'the citation chips render');
    assert.equal(state.chat.input, '');
    assert.equal(state.chat.run.status, 'ok', 'the run that answered says how it ended');
  });

  it('a thumb opens the verdict form, and only an evidenced submission records anything', async () => {
    const reply = app.getState().chat.messages.find((m: any) => m.role === 'assistant');
    assert.equal(typeof reply.id, 'string');

    app.dispatch('feedback/open', { messageId: reply.id, verdict: 'success' });
    await settle(() => app.getState().chat.feedback.form !== null);
    const feedback = app.getState().chat.feedback;
    assert.equal(feedback.messageId, reply.id, 'the thumb opened the form on the reply it was clicked on');
    assert.equal(feedback.verdict, 'success', 'the thumb pre-selects what it meant');
    assert.equal(feedback.form.eligible, true);
    assert.equal(feedback.receipt, null, 'a thumb records nothing on its own');
    assert.equal(JSON.stringify(app.getVnode()).includes('feedback-submit'), true, 'the form renders');

    // the submit control stays disabled until the published bounds are met
    const disabled = (): boolean => JSON.stringify(app.getVnode()).includes('"feedback-submit","disabled":true');
    assert.equal(disabled(), true, 'no reason and no evidence yet');

    // the reason action reads $event.value; simulate the typed value
    const typed = app.getState();
    app.setState({ ...typed, chat: { ...typed.chat, feedback: { ...typed.chat.feedback, reason: 'this named the port I asked about' } } });
    app.dispatch('feedback/toggle', feedback.form.evidence[0].ref);
    await settle(() => app.getState().chat.feedback.refs.length === 1);
    assert.equal(disabled(), false, 'a reason and one named source meet the bounds');

    app.dispatch('feedback/submit');
    await settle(() => app.getState().chat.feedback.receipt !== null);
    const receipt = app.getState().chat.feedback.receipt;
    assert.equal(receipt.outcome, 'success');
    assert.equal(receipt.utility, 1);
    assert.equal(receipt.replayed, false);
    assert.equal(receipt.applied >= 1, true);
    assert.equal(JSON.stringify(app.getVnode()).includes('feedback-recorded'), true, 'the row shows what was recorded');
    assert.equal(JSON.stringify(app.getVnode()).includes('the assistant is learning'), false);
  });

  it('run selection loads the per-node event detail', async () => {
    const sync = app.getState().loom.runs.rows.find((row: any) => row.kind === 'sync');
    app.dispatch('run/select', sync.id);
    await settle(() => app.getState().loom.detail?.run.id === sync.id);
    const detail = app.getState().loom.detail;
    assert.equal(detail.run.id, sync.id);
    assert.ok(detail.events.some((e: any) => e.node === 'crystallize'));
    assert.equal(detail.frames, detail.events.length + 2, 'every node, plus the counted pass and the run\'s terminal frame');
    // the detail states what configuration produced the run, not what the
    // settings happen to say now
    assert.equal(detail.identity.requested.kind, 'legacy');
    app.dispatch('nav', 'loom');
    await settle();
    assert.match(JSON.stringify(app.getVnode()), /requested legacy · settings projection/);
    assert.match(JSON.stringify(app.getVnode()), /embeddings builtin\/hash-trigram-512 @ 512/);
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

  it('selecting a profile renders its refusal as fixable items, and saving keeps the name', async () => {
    app.dispatch('nav', 'settings');
    await settle(() => app.getState().settings.inspect !== null);
    const listed = app.getState().settings.inspect.registry.profiles.map((entry: any) => entry.id);
    assert.deepEqual(listed, ['desktop-default', 'benchmark-live', 'benchmark-cheap'],
      'the selector is fed by what the registry declares');

    app.dispatch('settings/profile', undefined, { target: { value: 'desktop-default' } }, ['value']);
    await settle(() => app.getState().settings.preview !== null);
    const preview = app.getState().settings.preview;
    assert.equal(preview.profile, 'desktop-default');
    assert.equal(preview.state, 'refused');
    assert.deepEqual(preview.issues.map((issue: any) => issue.code), ['TCFG1015']);

    const dom = JSON.stringify(app.getVnode());
    assert.match(dom, /TCFG1015 \/roles\/chat\/capability/, 'the refusal renders with its code and path');
    assert.match(dom, /openrouter-primary/, 'and with the detail that says what to fix');
    assert.match(dom, /operator-declared/, "the registry's own stated limitation renders beside the selector");

    app.dispatch('settings/save');
    await settle(() => app.getState().settings.saved === true);
    assert.equal(app.getState().settings.draft.profile, 'desktop-default', 'the saved settings keep the name');
    await settle(() => app.getState().settings.inspect.request.kind === 'profile');
    assert.equal(app.getState().settings.inspect.resolution.state, 'refused');
    assert.equal(app.getState().settings.preview, null, 'the saved selection is stated once, by the inspection');

    // clearing the selection returns the host to its own projection
    app.dispatch('settings/profile', undefined, { target: { value: '' } }, ['value']);
    app.dispatch('settings/save');
    await settle(() => app.getState().settings.inspect.request.kind === 'legacy');
    assert.equal(app.getState().settings.draft.profile, null);
    assert.equal(app.getState().settings.inspect.resolution.state, 'ready');
  });

  it('renders every refusal code as a fixable item, stale name included', async () => {
    // a stored name the registry no longer declares: the panel says refused,
    // and the group must say the same thing rather than "(none)"
    const stale = await createDesktop({
      driver: nodeDriver(),
      presetSettings: { folder, profile: 'no-such-profile' },
    });
    const handler = toFetchHandler(stale.dispatcher);
    const client = openHttpClient(compileContract(DESKTOP_CONTRACT), {
      baseUrl: 'http://tangle.test',
      fetch: (async (url: any, init: any) => handler(new Request(url, init))) as any,
    });
    const errors: any[] = [];
    const staleApp = createTangleUi({ client, onError: (report: any) => errors.push(report) });
    try {
      await settle(() => staleApp.getState().settings.inspect !== null && staleApp.getState().settings.draft !== null);
      staleApp.dispatch('nav', 'settings');
      await settle(() => staleApp.getVnode() !== undefined);
      const dom = JSON.stringify(staleApp.getVnode());
      assert.match(dom, /TCFG1005 \/profile/, 'the unknown-profile refusal renders with its code and path');
      assert.match(dom, /'no-such-profile' names no profile in this registry/,
        'the stored name stays visible instead of reading as no selection');
      assert.equal(/No profile selected/.test(dom), false, 'a refused name is not the absence of a selection');

      // the issue renderer is generic: an uninstalled component renders the
      // same way, code, path and detail
      staleApp.setState({
        ...staleApp.getState(),
        settings: {
          ...staleApp.getState().settings,
          preview: {
            profile: 'desktop-default',
            state: 'refused',
            issues: [{ code: 'TCFG1017', path: '/policyComponent', detail: "policy component 'memory-policies-selected' at revision abcdef012345… is not installed on this host" }],
            identity: null,
          },
        },
      });
      await settle();
      const withPreview = JSON.stringify(staleApp.getVnode());
      assert.match(withPreview, /TCFG1017 \/policyComponent/);
      assert.match(withPreview, /is not installed on this host/);
      assert.deepEqual(errors, []);
    } finally {
      staleApp.destroy();
      await stale.close();
    }
  });

  it('the whole session raised no UI errors', () => {
    assert.deepEqual(uiErrors, []);
  });
});
