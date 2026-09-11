import { it } from 'node:test';
import assert from 'node:assert/strict';
import { chatClientFor, DEFAULT_SETTINGS } from '../../apps/desktop/src/settings.ts';
import { inspectStack } from '../../apps/desktop/src/ai-host.ts';

it('sends the configured completion field through the suite and records it in the run identity', async () => {
  const bodies: any[] = [];
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.chat = { provider: 'ollama', baseUrl: null, model: 'test', apiKey: null, maxTokens: 128, maxTokensField: 'max_completion_tokens' };
  const client = chatClientFor(settings.chat, { fetch: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] });
  } });
  await client.complete({ messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(bodies[0].max_completion_tokens, 128);
  assert.equal(Object.hasOwn(bodies[0], 'max_tokens'), false);
  const first = await inspectStack(settings);
  assert.equal(first.state, 'ready');
  assert.equal(first.identity?.roles.chat.inference.maxTokensField, 'max_completion_tokens');
  settings.chat.maxTokensField = 'max_tokens';
  await chatClientFor(settings.chat, { fetch: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] });
  } }).complete({ messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(bodies[1].max_tokens, 128);
  assert.equal(Object.hasOwn(bodies[1], 'max_completion_tokens'), false);
  const second = await inspectStack(settings);
  assert.notDeepEqual(first.identity, second.identity);
});
