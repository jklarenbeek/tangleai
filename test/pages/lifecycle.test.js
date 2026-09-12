import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createStubHost } from '../assistant/dom.stub.js';
import { mountPageHost } from '../../apps/pages/src/demos/host.js';
it('cancelling the assistant aborts child authoring and refuses its late candidate', async t => {
  const { container, document } = createStubHost(), assistantNode = document.createElement('aside'); container.appendChild(assistantNode);
  let chatStart, authorStart, finishAuthor, finishChat, authorSignal;
  const chatReady = new Promise(resolve => { chatStart = resolve; }), authorReady = new Promise(resolve => { authorStart = resolve; });
  const host = mountPageHost({ root: container, assistantNode, schedule: fn => fn(), hash: '#/flow',
    slots: { settings: { read: () => ({ provider: 'openrouter', model: 'scripted', apiKey: 'fixture', baseUrl: '' }), write() {} } },
    aiFetch: (_url, init) => new Promise(resolve => {
      if (JSON.parse(init.body).stream) { finishChat = () => resolve(new Response('data: [DONE]\n\n')); chatStart(); }
      else { authorSignal = init.signal; finishAuthor = () => resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"$fsm":"0.1","initial":"a","states":["a"],"transitions":[]}' } }] }))); authorStart(); }
    }),
  });
  t.after(() => host.dispose());
  host.assistant.dispatch('ai/draft', null, { target: { value: 'Start a turn' } });
  const chat = host.assistant.controller.effects['ai-send']({}, host.assistant.dispatch); await chatReady;
  const before = host.flow().read();
  const author = host.toolbox.execute('jaren_flow_author', { kind: 'fsm', prompt: 'Create a machine.' }); await authorReady;
  host.assistant.dispatch('ai/cancel'); assert.equal(authorSignal.aborted, true);
  finishAuthor(); const result = await author; assert.equal(result.ok, false); assert.match(result.error, /cancelled/);
  assert.deepEqual(host.flow().read(), before); finishChat(); await chat;
});
