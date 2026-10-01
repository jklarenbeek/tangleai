import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeDriver } from '@jarenjs/db/node';
import { createGroundingStore, createMasStore } from '@tangleai/store';
import { loadGroundingProfile } from '@tangleai/grounding';
import { MasInfrastructureCrash } from '@tangleai/mas';
import { createDesktop, type Desktop, type DesktopOptions } from '../../apps/desktop/src/server.ts';
import { DESKTOP_CONTRACT } from '../../apps/desktop/src/contract.ts';
import { groundingHostHarness, HOST_AT, HOST_QUERY } from '../fixtures/grounding/host-harness.ts';
import profileDocument from '../fixtures/grounding/profile-minimal.json' with { type: 'json' };
import chatBaseline from '../fixtures/desktop-chat-pre-sessions.json' with { type: 'json' };

export async function groundingCall(d: Desktop, method: string, url: string, body?: unknown) {
  const reply = await d.dispatcher.dispatch({ method, url, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? null : JSON.stringify(body) });
  return { status: reply.status, value: JSON.parse(typeof reply.body === 'string' ? reply.body : new TextDecoder().decode(reply.body)) };
}
async function setup(input: Parameters<typeof groundingHostHarness>[0] = {}, options: DesktopOptions = {}) {
  const loaded = await loadGroundingProfile(profileDocument); assert.ok(loaded.valid);
  let h: Awaited<ReturnType<typeof groundingHostHarness>>;
  const desktop = await createDesktop({ driver: nodeDriver(), now: () => HOST_AT, ...options, grounding: {
    profiles: [loaded.value], bindings: async ({ db }) => { h ??= await groundingHostHarness({ ...input, db }); return h.bindings(); },
  } });
  return { desktop, get h() { return h!; }, call: (method: string, path: string, body?: unknown) => groundingCall(desktop, method, path, body) };
}
it('seven desktop operations drive the same SQLite workflow through clarification, answer and refresh', async () => {
  const { desktop, call } = await setup({ complex: true });
  try {
    const started = await call('POST', '/api/grounding/start', { text: HOST_QUERY });
    assert.equal(started.status, 200, JSON.stringify(started)); assert.equal(started.value.disposition, 'clarification');
    const wait = started.value, read = await call('GET', '/api/grounding/get?sessionId=' + wait.sessionId);
    assert.deepEqual(read.value, wait); assert.equal(wait.question.fields[0].id, 'q1');
    const invalid = await call('POST', '/api/grounding/reply', { sessionId: wait.sessionId, interactionId: wait.question.interactionId, response: { answers: { invented: 'Archive' } } });
    assert.equal(invalid.status, 422);
    const answered = await call('POST', '/api/grounding/reply', { sessionId: wait.sessionId, interactionId: wait.question.interactionId, response: { answers: { q1: 'Archive' } } });
    assert.equal(answered.status, 200, JSON.stringify(answered)); assert.equal(answered.value.disposition, 'answer');
    assert.equal(answered.value.trace.calls, 9); assert.equal(answered.value.answer.text, 'The archive desk is in Square Hall.');
    const duplicate = await call('POST', '/api/grounding/reply', { sessionId: wait.sessionId, interactionId: wait.question.interactionId, response: { answers: { q1: 'Archive' } } });
    assert.deepEqual(duplicate.value, answered.value);
    const evidence = await call('GET', '/api/grounding/evidence?sessionId=' + wait.sessionId);
    assert.equal(evidence.status, 200, JSON.stringify(evidence)); assert.ok(evidence.value.candidates.length);
    assert.ok(evidence.value.candidates.every((row: any) => row.lane === 'local' && row.authority.tier === 'official' && row.times.provenance === 'curator'));
    assert.ok(evidence.value.candidates.some((row: any) => row.used));
    const conflicts = await call('GET', '/api/grounding/conflicts?sessionId=' + wait.sessionId);
    assert.equal(conflicts.status, 200); assert.deepEqual(conflicts.value, []);
    const listed = await call('GET', '/api/grounding/list?limit=10'); assert.equal(listed.value[0].disposition, 'answer');
    const refreshed = await call('POST', '/api/grounding/refresh', { sessionId: wait.sessionId, reason: 'Check again' });
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed)); assert.notEqual(refreshed.value.identities.runId, wait.identities.runId);
    const retained = await createGroundingStore(desktop.db).getSession(wait.sessionId);
    assert.equal(retained!.execution!.previousRunId, wait.identities.runId);
  } finally { await desktop.close(); }
});
it('the desktop reports zero-call refusal, named dependency failure and an in-flight read', async () => {
  const context = await setup({ dead: 'model' });
  try {
    const refusal = await context.call('POST', '/api/grounding/start', { text: 'urgent fixture signal' });
    assert.equal(refusal.status, 200); assert.equal(refusal.value.disposition, 'refusal'); assert.equal(refusal.value.trace.calls, 0);
    const failure = await context.call('POST', '/api/grounding/start', { text: HOST_QUERY });
    assert.equal(failure.status, 200, JSON.stringify(failure)); assert.equal(failure.value.disposition, 'failure'); assert.equal(failure.value.failure.code, 'TGRD1009');
    const deferred = await context.h.host.start({ text: HOST_QUERY, conversationId: 'deferred', defer: true });
    const running = await context.call('GET', '/api/grounding/get?sessionId=' + deferred.sessionId);
    assert.equal(running.status, 200); assert.equal(running.value.disposition, 'running');
    assert.equal((await context.call('GET', '/api/grounding/get?sessionId=absent')).status, 404);
  } finally { await context.desktop.close(); }
});
it('unconfigured desktop grounding is a retained named failure without provider traffic', async () => {
  let requests = 0; const d = await createDesktop({ driver: nodeDriver(), fetch: async () => { requests++; throw Error('No network registered'); } });
  try {
    const result = await groundingCall(d, 'POST', '/api/grounding/start', { text: 'Where is the desk?' });
    assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.value.disposition, 'failure'); assert.match(result.value.failure.detail, /No grounding model/); assert.equal(requests, 0);
    assert.deepEqual((await groundingCall(d, 'GET', '/api/grounding/get?sessionId=' + result.value.sessionId)).value, result.value);
  } finally { await d.close(); }
});
it('plain chat output and the three baseline operation declarations stay byte-identical', async () => {
  const d = await createDesktop({ driver: nodeDriver(), now: () => chatBaseline.now });
  try {
    const result = await groundingCall(d, 'POST', '/api/chat', { text: chatBaseline.text });
    assert.equal(result.status, chatBaseline.status); assert.equal(JSON.stringify(result.value), JSON.stringify(chatBaseline.output));
    for (const [name, operation] of Object.entries(chatBaseline.operations)) assert.equal(JSON.stringify(DESKTOP_CONTRACT.operations[name as keyof typeof DESKTOP_CONTRACT.operations]), JSON.stringify(operation), name);
    assert.deepEqual(Object.entries(DESKTOP_CONTRACT.operations).filter(([, op]) => op.kind === 'subscribe').map(([name]) => name), ['runs.live', 'run.live']);
  } finally { await d.close(); }
});
it('retained histories survive settings changes without binding clients or changing identities', async () => {
  const { desktop, call } = await setup();
  try {
    const answer = (await call('POST', '/api/grounding/start', { text: HOST_QUERY })).value;
    await call('POST', '/api/settings', { settings: { chat: { provider: 'custom', model: 'another', baseUrl: 'https://models.example', apiKey: null } } });
    assert.deepEqual((await call('GET', '/api/grounding/get?sessionId=' + answer.sessionId)).value, answer);
  } finally { await desktop.close(); }
});
it('a desktop restart resumes committed stages and retains the same completed answer without duplicate calls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-grounding-')); let armed = true;
  const first = await setup({ observer: { onNodeSettle(path, state) { if (armed && path === 'generate' && state === 'completed') { armed = false; throw new MasInfrastructureCrash('registered desktop restart'); } } } }, { dbPath: join(dir, 'flow.sqlite') });
  let id: string, originalCalls: number, answerId: string;
  try {
    assert.equal((await first.call('POST', '/api/grounding/start', { text: HOST_QUERY })).status, 422);
    const store = createGroundingStore(first.desktop.db), session = (await store.listSessions())[0]!;
    id = session.id; answerId = session.answerIds[0]!; originalCalls = first.h.stats().calls; assert.equal(originalCalls, 3);
    // The unfinished native run is older than a complete page of terminal history.
    for (let index = 0; index < 200; index++) {
      const created = await store.createSession({ conversationId: 'newer-' + index, profileId: session.profileId, profileRevision: session.profileRevision }); assert.ok(created.ok);
      const attached = await store.transitionSession(created.value.id, { kind: 'attachExecution', execution: { ...session.execution!, runId: 'newer-' + index, at: '2026-06-02T00:00:00.000Z' } }, created.value.revision); assert.ok(attached.ok);
      const failed = await store.transitionSession(attached.value.id, { kind: 'fail', reason: 'Registered terminal history.' }, attached.value.revision); assert.ok(failed.ok);
    }
    assert.ok(!(await store.listSessions(200)).some(row => row.id === id));
    assert.equal((await store.listSessions(200, 200))[0]!.id, id);

  } finally { await first.desktop.close(); }
  const second = await setup({}, { dbPath: join(dir, 'flow.sqlite') });
  try {
    await second.desktop.close();
    // close drains startup recovery before closing SQLite; reopen to inspect persisted truth.
    const third = await setup({}, { dbPath: join(dir, 'flow.sqlite') });
    try {
      const result = await third.call('GET', '/api/grounding/get?sessionId=' + id!);
      assert.equal(result.value.disposition, 'answer', JSON.stringify(result)); assert.equal(result.value.trace.calls, originalCalls!);
      assert.equal((await createGroundingStore(third.desktop.db).getSession(id!))!.answerIds[0], answerId!);
      const run = await createMasStore(third.desktop.db).getRun(result.value.identities.runId); assert.equal(run!.status, 'completed');
      assert.equal(second.h.stats().calls, 0);
    } finally { await third.desktop.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('the native UI submits typed clarification and shows actual citations, provenance, spend and history', async () => {
  const [{ compileContract }, { openHttpClient }, { toFetchHandler }, { createTangleUi }] = await Promise.all([
    import('@jarenjs/contract'), import('@jarenjs/contract/client'), import('@jarenjs/contract/fetch'), import('../../apps/desktop/src/ui/app.ts'),
  ]);
  const { desktop } = await setup({ complex: true }), errors: unknown[] = [];
  const handler = toFetchHandler(desktop.dispatcher), client = openHttpClient(compileContract(DESKTOP_CONTRACT), {
    baseUrl: 'http://tangle.test', fetch: (url: any, init: any) => handler(new Request(url, init)),
  });
  const app = createTangleUi({ client: { invoke: client.invoke }, onError: issue => errors.push(issue) });
  async function settle() {
    for (let i = 0; i < 250 && app.getState().grounding.busy; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(app.getState().grounding.busy, false); assert.equal(app.getState().grounding.error, null);
  }
  try {
    app.dispatch('nav', 'grounding');
    // The browser binding writes the input event; headless state supplies that value.
    app.setState({ ...app.getState(), grounding: { ...app.getState().grounding, input: HOST_QUERY } });
    app.dispatch('grounding/start'); await settle();
    assert.equal(app.getState().grounding.reply.disposition, 'clarification');
    app.setState({ ...app.getState(), grounding: { ...app.getState().grounding, answers: { q1: 'Archive' } } });
    app.dispatch('grounding/reply'); await settle();
    assert.equal(app.getState().grounding.reply.disposition, 'answer');
    const rendered = JSON.stringify(app.getVnode());
    for (const marker of ['Square Hall', 'local', 'official', 'provenance: curator', '9 calls', 'unused candidates']) assert.ok(rendered.includes(marker), marker);
    assert.deepEqual(errors, []); assert.equal(app.getState().grounding.rows.length, 1);
  } finally { app.destroy(); client.close(); await desktop.close(); }
});
