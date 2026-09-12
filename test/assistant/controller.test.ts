import { execFileSync } from 'node:child_process';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, formEventFields } from '@jarenjs/app';
import { createLedger } from '@tangleai/context';
import { createToolbox } from '@tangleai/agents';
import { createAssistantController, createAssistantState, ASSISTANT_ACTIONS } from '@tangleai/assistant';
const configured = { provider: 'openrouter', apiKey: 'test-only', model: 'fixture', baseUrl: '' };
const sse = (content: any) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
function fixture(t: any, options: Record<string, any> = {}) {
  let app: any, settings = options.settings ?? configured, transcript = options.transcript ?? null;
  const requests: any[] = [], ledger = createLedger();
  const controller = createAssistantController({
    getApp: () => app, ledger, toolbox: createToolbox(),
    system: options.system ?? 'Help this host finish its task.', headers: options.headers,
    aiStorage: { read: () => settings, write: (value: any) => { settings = structuredClone(value); } },
    aiChat: { read: () => transcript, write: (value: any) => { transcript = structuredClone(value); } },
    aiFetch: (url: any, init: any) => { requests.push({ url, init }); return options.fetch ? options.fetch(url, init) : Promise.resolve(sse('Finished.')); },
    ...options.controller,
  });
  app = createApp({ state: { ai: { ...createAssistantState(settings, transcript), draft: 'Please finish.' } }, actions: ASSISTANT_ACTIONS, view: [] },
    { schedule: flush => flush(), eventFields: formEventFields(), effects: controller.effects, onError: error => { throw error; } });
  t.after(async () => { await controller.dispose(); app.destroy(); });
  return { app, controller, requests, ledger, settings: () => settings, transcript: () => transcript };
}
it('streams with injected host instructions, preserves request settings and resumes its transcript', async t => {
  for (const name of ['Research desk', 'Workshop']) {
    const host = fixture(t, { system: name, headers: { 'X-Title': name } }), states: any[] = [];
    host.app.subscribe((state: any) => states.push(state.ai.pending));
    await host.controller.effects['ai-send']({}, host.app.dispatch);
    assert.equal(host.app.getState().ai.status, 'idle'); assert.ok(states.includes('Finished.'));
    assert.equal(host.transcript().messages.at(-1).content, 'Finished.');
    const request = JSON.parse(host.requests[0].init.body);
    assert.ok(request.messages[0].content.includes(name)); assert.equal(host.requests[0].init.headers['X-Title'], name);
    assert.equal(request.model, 'fixture'); assert.equal(request.stream, true);
    assert.equal(JSON.stringify(host.transcript()).includes('test-only'), false);
    const resumed = fixture(t, { transcript: host.transcript() });
    assert.deepEqual(resumed.app.getState().ai.messages, host.app.getState().ai.messages);
  }
});
it('pins settings open when unconfigured, probes the actual provider and preserves failures', async t => {
  const host = fixture(t, { settings: { ...configured, model: '' }, fetch: async () => new Response(JSON.stringify({ data: [{ id: 'fixture' }] })) });
  host.app.dispatch('ai/toggle'); assert.equal(host.app.getState().ai.settingsOpen, true);
  await host.controller.effects['ai-send']({}, host.app.dispatch); assert.equal(host.requests.length, 0);
  await host.controller.effects['ai-probe']({}, host.app.dispatch);
  assert.match(host.requests[0].url, /\/models$/); assert.deepEqual(host.app.getState().ai.probe.models, ['fixture']);
  const failed = fixture(t, { fetch: async () => { throw new Error('connection refused'); } });
  await failed.controller.effects['ai-send']({}, failed.app.dispatch);
  assert.equal(failed.app.getState().ai.status, 'error'); assert.match(failed.app.getState().ai.error, /connection refused/);
});
it('cancels a turn and prevents late results from restoring cleared conversation state', async t => {
  let entered: any, finish;
  const ready = new Promise<AbortSignal>(resolve => { entered = resolve; });
  const host = fixture(t, { fetch: (_url: any, init: any) => new Promise(resolve => { finish = () => resolve(sse('too late')); entered(init.signal); }) });
  const pending = host.controller.effects['ai-send']({}, host.app.dispatch), signal = await ready;
  host.app.dispatch('ai/clear'); assert.equal(signal.aborted, true); finish!(); await pending;
  assert.deepEqual(host.app.getState().ai.messages, []); assert.equal(host.app.getState().ai.pending, '');
  await host.controller.effects['ai-remember']({}, host.app.dispatch);
  assert.match(host.app.getState().ai.remembered, /Nothing to remember/);
});
it('disposal aborts provider probes, releases owned storage once and ignores later effects', async t => {
  let entered: any, closed = 0;
  const ready = new Promise<AbortSignal>(resolve => { entered = resolve; });
  const host = fixture(t, {
    controller: { onDispose: () => { closed++; } }, fetch: (_url: any, init: any) => new Promise((_resolve, reject) => {
      entered(); init.signal.addEventListener('abort', () => reject(new Error('disposed')), { once: true });
    })
  });
  const pending = host.controller.effects['ai-probe']({}, host.app.dispatch); await ready;
  await host.controller.dispose(); await host.controller.dispose(); await pending;
  const before = structuredClone(host.app.getState());
  await host.controller.effects['ai-send']({}, host.app.dispatch);
  assert.equal(closed, 1); assert.deepEqual(host.app.getState(), before); assert.equal(host.requests.length, 1);
});
it('reports failed settings and transcript writes instead of claiming persistence', async t => {
  const host = fixture(t, { controller: { aiStorage: { read: () => null, write: () => false }, aiChat: { read: () => null, write: () => { throw new Error('quota'); } } } });
  await host.controller.effects['ai-save-settings']({}, host.app.dispatch);
  assert.equal(host.app.getState().ai.settingsOpen, true); assert.match(host.app.getState().ai.error, /could not be saved/);
  await host.controller.effects['ai-persist']({}, host.app.dispatch); assert.match(host.app.getState().ai.error, /quota/);
});

it('imports with no window or DOM and creates isolated transcript states', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    delete globalThis.window;
    for (const name of ['document', 'navigator']) Object.defineProperty(globalThis, name, { get() { throw new Error('DOM read: ' + name); } });
    const { createAssistantState } = await import('@tangleai/assistant');
    if (createAssistantState().open !== false) throw new Error('bad initial state');
  `]);
  const transcript = { messages: [{ role: 'user', content: 'original' }] };
  const a = createAssistantState(null, transcript), b = createAssistantState(null, transcript);
  a.messages[0].content = 'changed';
  assert.equal(b.messages[0].content, 'original'); assert.equal(transcript.messages[0].content, 'original');
});
it('a non-cooperating late provider cannot execute host tools after cancellation', async t => {
  let start: any, finish, calls = 0, requests = 0;
  const entered = new Promise(resolve => { start = resolve; });
  const toolbox = createToolbox(); toolbox.add({ name: 'mutate', description: 'Change the host', inputSchema: { type: 'object' }, execute: () => { calls++; return {}; } });
  const host = fixture(t, {
    controller: { toolbox }, fetch: () => ++requests === 1 ? new Promise(resolve => {
      finish = () => resolve(new Response('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'one', type: 'function', function: { name: 'mutate', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n')); start();
    }) : Promise.resolve(sse('Done'))
  });
  const pending = host.controller.effects['ai-send']({}, host.app.dispatch); await entered;
  const signal = host.controller.signal; host.app.dispatch('ai/cancel'); assert.equal(signal.aborted, true);
  finish!(); await pending; assert.equal(calls, 0); assert.equal(host.app.getState().ai.status, 'idle');
});
