import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeDriver } from '@jarenjs/db/node';
import { toFetchHandler } from '@jarenjs/contract/fetch';
import { compileContract } from '@jarenjs/contract';
import { openHttpClient } from '@jarenjs/contract/client';
import { DESKTOP_CONTRACT } from '../../apps/desktop/src/contract.ts';
import { createResearchStore } from '@tangleai/store';
import { createDesktop } from '../../apps/desktop/src/server.ts';
import { createTangleUi } from '../../apps/desktop/src/ui/app.ts';
import { lessonFixture } from '../research/lessons-store-fixtures.ts';

async function settle(done: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!done() && Date.now() < deadline) await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(done(), 'the requested UI outcome did not settle');
}
it('Research renders retained lineage and refusals, reads on navigation, and rejects late project responses', async () => {
  const bytes = await readFile('benchmark/results/research.json', 'utf8'), report = JSON.parse(bytes);
  const desktop = await createDesktop({ driver: nodeDriver(), researchReport: async () => ({ bytes, sourceFiles: report.source.files, expectedReportId: report.reportId }) });
  const store = createResearchStore(desktop.db);
  const one = await lessonFixture(store, { id: 'ui-project-one' }), two = await lessonFixture(store, { id: 'ui-project-two' });
  const handler = toFetchHandler(desktop.dispatcher);
  const client = openHttpClient(compileContract(DESKTOP_CONTRACT), { baseUrl: 'http://desktop.test', fetch: (request: any, init?: any) => handler(new Request(request, init)) });
  const calls: string[] = [], pending = new Map<string, { ready: Promise<void>; resolve: () => void }>();
  for (const id of [one.owner.id, two.owner.id]) {
    let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; }); pending.set(id, { ready, resolve: release });
  }
  const errors: unknown[] = [];
  const app = createTangleUi({ client: { invoke: async (op, input, ctx) => {
    if (op.startsWith('research.')) calls.push(op);
    if (op === 'research.runs.get') await pending.get(input.projectId)?.ready;
    return client.invoke(op, input, ctx);
  } }, onError: error => errors.push(error) });
  try {
    app.dispatch('nav', 'research'); await settle(() => app.getState().research.report !== null && app.getState().research.runs.length === 2);
    assert.ok(JSON.stringify(app.getVnode()).includes('TRSH2012')); assert.ok(JSON.stringify(app.getVnode()).includes('not-run'));
    assert.equal(calls.filter(op => op === 'research.reports.get').length, 1);
    app.dispatch('research/select', one.owner.id); app.dispatch('research/select', two.owner.id);
    pending.get(two.owner.id)!.resolve(); await settle(() => app.getState().research.detail?.project.id === two.owner.id);
    assert.ok(JSON.stringify(app.getVnode()).includes('research-lineage'));
    app.dispatch('research/close'); pending.get(one.owner.id)!.resolve();
    await settle(() => calls.filter(op => op === 'research.runs.get').length === 2);
    for (let i = 0; i < 20; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(app.getState().research.detail, null); assert.equal(app.getState().research.projectId, null);
    app.dispatch('research/refresh'); await settle(() => calls.filter(op => op === 'research.reports.get').length === 2);
    assert.deepEqual(errors, []);
  } finally { pending.forEach(item => item.resolve()); app.destroy(); client.close(); await desktop.close(); }
});

it('a research project waiting at a gate does not take over the Loom from a folder pass', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tangle-research-loom-'));
  await writeFile(join(folder, 'notes.md'), 'The demo service listens on port 9090.');
  const desktop = await createDesktop({ driver: nodeDriver(), now: () => '2026-06-01T00:00:00.000Z', presetSettings: { folder } });
  await lessonFixture(createResearchStore(desktop.db), { id: 'waiting-research-project' });
  const handler = toFetchHandler(desktop.dispatcher), errors: unknown[] = [];
  const client = openHttpClient(compileContract(DESKTOP_CONTRACT), {
    baseUrl: 'http://desktop.test', fetch: (request: any, init?: any) => handler(new Request(request, init)),
  });
  const app = createTangleUi({ client, onError: error => errors.push(error) });
  try {
    await settle(() => app.getState().loom.runs.rows.some((row: any) => row.kind === 'research'));
    const sync = await client.invoke('folder.sync', {}); assert.ok(sync.ok, JSON.stringify(sync));
    const runId = (sync.value as { runId: string }).runId;
    await settle(() => app.getState().loom.runs.rows.some((row: any) => row.id === runId && row.status === 'ok'));
    assert.equal(app.getState().loom.watch, runId);
    await settle(() => app.getState().loom.frames.rows.some((row: any) => row.kind === 'status'));
    assert.equal(app.getState().loom.frames.runId, runId);
    assert.ok(app.getState().loom.runs.rows.some((row: any) => row.kind === 'research' && row.status === 'running'));
    assert.deepEqual(errors, []);
  } finally { app.destroy(); client.close(); await desktop.close(); await rm(folder, { recursive: true, force: true }); }
});

for (const mode of ['navigation', 'navigation-without-subscriptions', 'reconnect'] as const) {
  it(`Research refreshes selected detail after a stored transition during ${mode}`, async () => {
    const bytes = await readFile('benchmark/results/research.json', 'utf8'), report = JSON.parse(bytes);
    const desktop = await createDesktop({ driver: nodeDriver(), researchReport: async () => ({ bytes,
      sourceFiles: report.source.files, expectedReportId: report.reportId }) });
    const store = createResearchStore(desktop.db);
    const fixture = await lessonFixture(store, { id: 'refresh-' + mode, committed: false });
    const handler = toFetchHandler(desktop.dispatcher);
    const client = openHttpClient(compileContract(DESKTOP_CONTRACT), { baseUrl: 'http://desktop.test',
      fetch: (request: any, init?: any) => handler(new Request(request, init)) });
    let snapshots = 0, reads = 0;
    let disconnect = () => {}, reconnect = () => {};
    const subscribe = (op: string, input: any, options: any) => {
      if (op !== 'research.runs.live') return client.subscribe(op, input, options);
      const connect = () => client.subscribe(op, input, { ...options,
        onSnapshot(value: any) { options.onSnapshot(value); snapshots++; } });
      let subscription = connect();
      disconnect = () => subscription.stop();
      reconnect = () => { subscription = connect(); };
      return { stop() { subscription.stop(); } };
    };
    const errors: unknown[] = [];
    const app = createTangleUi({ client: {
      invoke: (op, input, ctx) => { if (op === 'research.runs.get') reads++; return client.invoke(op, input, ctx); },
      ...(mode === 'navigation-without-subscriptions' ? {} : { subscribe }),
    }, onError: error => errors.push(error) });
    try {
      app.dispatch('nav', 'research'); await settle(() => app.getState().research.runs.length === 1);
      app.dispatch('research/select', fixture.owner.id);
      await settle(() => app.getState().research.detail?.states.at(-1)?.status === 'DISCOVERY'
        && (mode === 'navigation-without-subscriptions' || snapshots === 1));
      const previousReads = reads;
      if (mode === 'reconnect') disconnect();
      else app.dispatch('nav', 'chat');
      const committed = await store.commitStage(fixture.plan);
      assert.ok(committed.ok, JSON.stringify(committed));
      if (mode === 'reconnect') reconnect();
      else app.dispatch('nav', 'research');
      await settle(() => (mode === 'navigation-without-subscriptions' || snapshots === 2)
        && (mode === 'reconnect' || app.getState().research.runs[0]?.status === 'LITERATURE_GATE'));
      assert.ok(reads > previousReads, 'New navigation or a fresh subscription snapshot must read the selected run again.');
      await settle(() => app.getState().research.detail?.states.at(-1)?.status === 'LITERATURE_GATE');
      assert.equal(app.getState().research.projectId, fixture.owner.id);
      assert.equal(app.getState().research.detail.attempts[0].attempt.id, fixture.plan.attempt.id);
      assert.deepEqual(errors, []);
    } finally { app.destroy(); client.close(); await desktop.close(); }
  });
}
