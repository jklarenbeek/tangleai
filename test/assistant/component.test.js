import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountAssistant, createAssistantWidget } from '@tangleai/assistant/component';
import { createStubHost, fire, serialize } from './dom.stub.js';
const settings = { provider: 'custom', baseUrl: 'https://fixture.invalid/v1', model: 'fixture', apiKey: '' };
const find = (node, predicate) => predicate(node) ? node : (node.childNodes ?? []).map(child => find(child, predicate)).find(Boolean);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function host(t, options = {}) {
  const { container, document } = createStubHost();
  const handle = mountAssistant(container, { schedule: fn => fn(), onError: error => { throw error; }, ...options });
  t.after(() => handle.dispose());
  return { container, document, handle };
}
it('mounts different host copy and capabilities without shared settings or datalist IDs', async t => {
  const a = host(t, { title: 'Research desk', intro: 'Read evidence.', capabilities: ['Search papers'], open: true });
  const b = host(t, { title: 'Workshop', intro: 'Build a tool.', capabilities: ['Run a project'], open: true });
  await settle();
  assert.match(serialize(a.container), /Research desk/); assert.match(serialize(b.container), /Workshop/);
  const aid = find(a.container, n => n.tagName === 'datalist').attributes.get('id');
  const bid = find(b.container, n => n.tagName === 'datalist').attributes.get('id');
  assert.notEqual(aid, bid);
  const model = find(a.container, n => n.attributes?.get('list') === aid);
  model.value = 'configured-a'; fire(model, 'input');
  assert.equal(a.handle.read().settings.model, 'configured-a');
  assert.equal(b.handle.read().settings.model, '');
  const ready = host(t, { settings, open: true, capabilities: ['Run a project'] });
  assert.match(serialize(ready.container), /Run a project/);
});
it('updates branding while preserving the composer node, draft and stream display', async t => {
  const { handle, container } = host(t, { settings, open: true });
  const textarea = find(container, n => n.tagName === 'textarea');
  textarea.value = 'Keep my draft'; fire(textarea, 'input');
  handle.update({ title: 'Renamed host' });
  assert.equal(find(container, n => n.tagName === 'textarea'), textarea);
  assert.equal(handle.read().draft, 'Keep my draft'); assert.match(serialize(container), /Renamed host/);
  handle.dispatch('ai/user', 'A question'); handle.dispatch('ai/delta', '**streamed**');
  assert.match(serialize(container), /\*\*streamed\*\*/); assert.match(serialize(container), /Cancel/);
  handle.dispatch('ai/reply', '**rendered**'); await settle();
  assert.match(serialize(container), /<strong>rendered<\/strong>/);
});
it('cancels with the visible control and removes DOM and listeners on repeated disposal', async t => {
  let start, signal, closed = 0;
  const ready = new Promise(resolve => { start = resolve; });
  const { handle, container } = host(t, { settings, open: true, onDispose: () => { closed++; }, aiFetch: (_url, init) => new Promise((_resolve, reject) => {
    signal = init.signal; start(); signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }) });
  const draft = find(container, n => n.tagName === 'textarea');
  draft.value = 'Wait for me'; fire(draft, 'input'); handle.dispatch('ai/send'); await ready;
  const cancel = find(container, n => n.tagName === 'button' && serialize(n).includes('Cancel'));
  fire(cancel, 'click'); await settle();
  assert.equal(signal.aborted, true); assert.equal(handle.read().status, 'idle');
  assert.equal(container.listeners.get('click').size, 1);
  await handle.dispose(); await handle.dispose();
  assert.equal(container.childNodes.length, 0); assert.equal(container.listeners.get('click').size, 0); assert.equal(closed, 1);
  const before = handle.read();
  fire(cancel, 'click'); handle.dispatch('ai/user', 'after disposal');
  assert.deepEqual(handle.read(), before);
});
it('supports the app widget mount/update/unmount contract', async () => {
  const { container } = createStubHost();
  const widget = createAssistantWidget({ settings, schedule: fn => fn() });
  const handle = widget.mount(container, { title: 'Mounted', open: true });
  widget.update(handle, { title: 'Updated' }); assert.match(serialize(container), /Updated/);
  await widget.unmount(handle); assert.equal(container.childNodes.length, 0);
});
it('ships scoped selectors and retains the mobile sheet and primary tap targets', () => {
  const css = readFileSync(new URL('../../components/assistant/styles/assistant.css', import.meta.url), 'utf8');
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g);
  for (const selector of selectors) if (!selector.trim().startsWith('@media')) {
    for (const part of selector.split(',')) assert.match(part.trim(), /^:where\(\.tangle-assistant\)/);
  }
  assert.match(css, /85dvh/); assert.match(css, /2\.75rem/); assert.match(css, /safe-area-inset-bottom/);
});

it('assistant reply heading ids remain outside the host page namespace', async t => {
  const { container } = createStubHost();
  const host = mountAssistant(container, { open: true, transcript: { messages: [{ role: 'assistant', content: '## md\n\nSee [below](#md).\n' }] }, schedule: fn => fn() });
  t.after(() => host.dispose());
  const html = serialize(container);
  assert.match(html, /id="user-content-tangle-assistant-\d+-md"/, 'foreign reply headings carry the instance prefix');
  assert.doesNotMatch(html, /id="md"/, 'a reply never claims the host page heading id');
});
