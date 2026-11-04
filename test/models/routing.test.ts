import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { inspect } from 'node:util';

import { createRoutedClient } from '@tangleai/models/routing';
import { createChatClient } from '@tangleai/models/client';
import { AiError } from '@tangleai/models/errors';

const scripted = (complete: any) => ({ endpoint: { provider: 'openrouter' }, complete });

describe('ai — the routed client codes its own failures', function () {
  it('a deadline is AI0004 with outcome timeout and the deadline it ran past', async function () {
    const router = createRoutedClient({ client: scripted(() => new Promise(() => { })), limits: { deadlineMs: 5 } },
      { purpose: 'author' });
    await assert.rejects(router.complete({ messages: [] }),
      (err) => err instanceof AiError && err.code === 'AI0004' && err.outcome === 'timeout'
        && err.deadlineMs === 5 && /deadline/.test(err.message));
  });

  it('a deadline that aborts a chat client mid-request still surfaces as AI0004, not a network error', async function () {
    const chat = createChatClient({
      provider: 'openrouter', model: 'm', apiKey: 'k',
      // what Node's fetch does: reject with the signal's reason
      fetch: (_url: any, init: any) => new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(init.signal.reason))),
    });
    const router = createRoutedClient({ client: chat, limits: { deadlineMs: 5 } }, { purpose: 'author' });
    await assert.rejects(router.complete({ messages: [{ role: 'user', content: 'x' }] }),
      (err) => err instanceof AiError && err.code === 'AI0004' && err.outcome === 'timeout');
  });

  it('a reply over its token ceiling is AI0005, carrying what it cost and the limit', async function () {
    const completion = createRoutedClient({
      client: scripted(async () => ({ message: { content: 'ok' }, usage: { completion_tokens: 50 } })),
      limits: { outputTokens: 10 },
    }, { purpose: 'subcall' });
    await assert.rejects(completion.complete({ messages: [] }),
      (err) => err instanceof AiError && err.code === 'AI0005' && err.outcome === 'token-limit'
        && err.limit === 10 && err.usage.completion_tokens === 50 && /token ceiling: 50 completion tokens/.test(err.message));
    const reasoning = createRoutedClient({
      client: scripted(async () => ({
        message: { content: 'ok' }, usage: { completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 30 } },
      })),
      limits: { reasoningTokens: 10 },
    }, { purpose: 'subcall' });
    await assert.rejects(reasoning.complete({ messages: [] }),
      (err) => err instanceof AiError && err.code === 'AI0005' && err.limit === 10 && /30 reasoning tokens/.test(err.message));
  });

  it('an account stop is AI0006 with outcome budget, and nothing is sent', async function () {
    const account = { stop: () => 'budget-turns', reserve() { }, settle() { } };
    const router = createRoutedClient({ client: scripted(async () => assert.fail('must not be sent')), account },
      { purpose: 'subcall' });
    await assert.rejects(router.complete({ messages: [] }),
      (err) => err instanceof AiError && err.code === 'AI0006' && err.outcome === 'budget' && /budget-turns/.test(err.message));
  });

  it("a caller's own abort rejects with the caller's reason, as it came", async function () {
    const reason = new Error('the operator stopped it');
    const before = new AbortController();
    before.abort(reason);
    const idle = createRoutedClient({ client: scripted(async () => assert.fail('must not be sent')) }, { purpose: 'author' });
    await assert.rejects(idle.complete({ messages: [], signal: before.signal }), (err) => err === reason);

    const during = new AbortController();
    const hung = createRoutedClient({
      client: scripted(() => new Promise(() => { })), limits: { deadlineMs: 1000 },
    }, { purpose: 'author' });
    const pending = hung.complete({ messages: [], signal: during.signal });
    during.abort(reason);
    await assert.rejects(pending, (err) => err === reason);
  });

  it('routes a host purpose; only the embedding purpose and an empty one are refused', async function () {
    const events: any[] = [];
    const router = createRoutedClient({ client: scripted(async () => ({ message: { content: 'ok' } })), limits: { deadlineMs: 1000 }, onRoute: (event) => events.push(event) },
      { purpose: 'proposal' });
    assert.strictEqual((await router.complete({ messages: [] })).message.content, 'ok');
    assert.deepStrictEqual([events[0].purpose, events[0].outcome], ['proposal', 'complete']);
    for (const purpose of ['embedding', ''])
      assert.throws(() => createRoutedClient({ client: scripted(async () => ({})) }, { purpose }), /chat routing/);
  });

  it('re-exposes only the credential-free endpoint of the client it routes', function () {
    const chat = createChatClient({ provider: 'openrouter', model: 'm', apiKey: 'sk-or-secret-value' });
    const router = createRoutedClient({ client: chat }, { purpose: 'author' });
    assert.deepStrictEqual(router.endpoint, chat.endpoint);
    assert.ok(!inspect(router, { showHidden: true, depth: null }).includes('sk-or-secret-value'));
  });
});
