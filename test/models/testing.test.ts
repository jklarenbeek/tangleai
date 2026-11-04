import { it } from 'node:test';
import assert from 'node:assert/strict';

import { createChatClient } from '@tangleai/models/client';
import { AiError } from '@tangleai/models/errors';
import { createStructuredOutput } from '@tangleai/models/structured';
import { createScriptedFetch } from '@tangleai/models/testing';

const messages = [{ role: 'user', content: 'x' }];

it('answers each step as the request asked — a stream or one document — and keeps every request', async () => {
  const { fetch, calls, remaining } = createScriptedFetch([
    'hello',
    { content: 'hi', usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }, model: 'm-1' },
    { toolCalls: [{ name: 'lookup', arguments: '{"q":1}' }] },
  ]);
  const client = createChatClient({ provider: 'openrouter', model: 'm', apiKey: 'sk-test', fetch });
  const streamed = await client.complete({ messages });
  assert.equal(streamed.message.content, 'hello');
  assert.equal(streamed.finishReason, 'stop');
  const whole = await client.complete({ messages, stream: false });
  assert.deepEqual([whole.message.content, whole.usage.total_tokens, whole.model], ['hi', 4, 'm-1']);
  const tools = await client.complete({ messages });
  assert.deepEqual([tools.finishReason, tools.message.toolCalls[0].name], ['tool_calls', 'lookup']);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].headers.authorization, 'Bearer sk-test');
  assert.equal((calls[1].body as any).stream, false);
  assert.equal(remaining(), 0);
  await assert.rejects(client.complete({ messages }), /no step for request \d+; the script has 3/);
});

it('scripts HTTP failures, network failures, truncation and a hang that honours abort', async () => {
  const { fetch } = createScriptedFetch([{ status: 429, body: 'slow down' }, 'recovered']);
  const retrying = createChatClient({ provider: 'openrouter', model: 'm', fetch, retry: { attempts: 2, sleep: async () => { } } });
  assert.equal((await retrying.complete({ messages })).message.content, 'recovered');

  const network = createChatClient({ provider: 'openrouter', model: 'm', retry: { attempts: 1 }, fetch: createScriptedFetch([new TypeError('network')]).fetch });
  await assert.rejects(network.complete({ messages }), (err) => err instanceof AiError && err.code === 'AI0002' && err.status === 0);

  const cut = createChatClient({ provider: 'custom', baseUrl: 'https://x.test/v1', model: 'm', fetch: createScriptedFetch([{ content: '{"a":', finishReason: 'length' }]).fetch });
  const result = await createStructuredOutput({ client: cut, schema: { type: 'object' } }).generate(messages);
  assert.equal(result.errors?.[0].stage, 'truncated');

  const controller = new AbortController();
  const hung = createChatClient({ provider: 'openrouter', model: 'm', fetch: createScriptedFetch(['hang']).fetch });
  const pending = hung.complete({ messages, signal: controller.signal });
  const reason = new Error('stop');
  controller.abort(reason);
  await assert.rejects(pending, (err) => err === reason);

  assert.throws(() => createScriptedFetch([], { mode: 'xml' as any }), /mode/);
  const forced = createChatClient({ provider: 'openrouter', model: 'm', fetch: createScriptedFetch(['as json'], { mode: 'json' }).fetch });
  assert.equal((await forced.complete({ messages })).message.content, 'as json', 'a stream request accepts one JSON document');
});
