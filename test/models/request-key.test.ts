import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createChatClient } from '@tangleai/models/client';
import { replayKey } from '@tangleai/models/replay';

it('requestKey is the credential-free effective wire and cache identity without I/O', async () => {
  const keys: string[] = [], bodies: any[] = [];
  const options = { provider: 'custom', baseUrl: 'https://fixture.invalid/v1',model: 'configured-model',maxTokens: 321,maxTokensField: 'max_completion_tokens' as const,reasoning: { effort: 'low' as const },apiKey: 'do-not-record',headers: { 'X-Private': 'private-value' },retry: { attempts: 1 },
    cache: { get: (key: string) => { keys.push(key); return undefined; },set: () => {} },
    fetch: async (_url: any, init: any) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant',content: 'ok' },finish_reason: 'stop' }] })); } };
  const client = createChatClient(options), request = { messages: [{ role: 'user',content: 'question' }],responseFormat: { name: 'result',schema: { type: 'string' } } };
  const key = client.requestKey(request);
  assert.equal(bodies.length,0); assert.equal(keys.length,0);
  assert.equal(key,client.requestKey({ ...request,stream: false,signal: new AbortController().signal,onDelta: () => {},onReasoning: () => {} }));
  assert.equal(key,createChatClient({ ...options,apiKey: 'other',headers: { 'X-Private': 'changed' } }).requestKey(request));
  await client.complete({ ...request,stream: false });
  const { stream: _,...body } = bodies[0];
  assert.equal(key,replayKey('chat',client.endpoint,body)); assert.equal(key,keys[0]);
  assert.equal(body.max_completion_tokens,321); assert.equal(body.max_tokens,undefined);
  assert.equal(body.model,'configured-model'); assert.equal(body.reasoning.effort,'low');
  assert.ok(!key.includes('do-not-record') && !key.includes('private-value'));
  assert.notEqual(key,client.requestKey({ ...request,maxTokens: 322 }));
});
