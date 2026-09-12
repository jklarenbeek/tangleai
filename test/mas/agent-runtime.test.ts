/**
 * The shared budget and tool seams: concurrent last-turn reservation, a
 * failed call still consuming its turn, provider usage winning over
 * estimation, bind-time refusal of an unhonored effectful tool, the
 * toolbox's readable refusal shapes, and the uncertainty guard.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createBudgetAccount } from '@tangleai/agents/recursive';
import {
  buildEffectiveToolbox,
  createSharedBudgetClient,
  MasBudgetStop,
  MasUncertainEffect,
  validateToolBindings,
  type MasChatCompletion,
  type MasRegistry,
} from '@tangleai/mas';

const registry = JSON.parse(await readFile('benchmark/fixtures/mas/registry.json', 'utf8')) as MasRegistry;

function deferred<T = void>(): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('one shared budget account around every model call', () => {
  it('reserves synchronously so concurrent branches cannot all spend the last turn', async () => {
    const account = createBudgetAccount({ turns: 3 }, () => 0);
    const release = deferred();
    const scripted = {
      complete: async (): Promise<MasChatCompletion> => {
        await release.promise;
        return { message: { content: 'ok' }, usage: { prompt_tokens: 1, completion_tokens: 1 } };
      },
    };
    const client = createSharedBudgetClient(scripted, account);
    const outcomes: Array<'ok' | 'stopped'> = [];
    const calls = [1, 2, 3, 4].map(() => client.complete({ messages: [] })
      .then(() => outcomes.push('ok'), (error) => {
        assert.ok(error instanceof MasBudgetStop);
        outcomes.push('stopped');
      }));
    release.resolve();
    await Promise.all(calls);
    assert.equal(outcomes.filter((outcome) => outcome === 'ok').length, 3);
    assert.equal(outcomes.filter((outcome) => outcome === 'stopped').length, 1, 'the fourth concurrent call stopped before launching');
  });

  it('a failed call still consumed its reserved turn; provider usage wins on success', async () => {
    const account = createBudgetAccount({ turns: 5, tokens: 1000 }, () => 0);
    let attempt = 0;
    const flaky = {
      complete: async (): Promise<MasChatCompletion> => {
        attempt += 1;
        if (attempt === 1) throw new Error('transport failed');
        return { message: { content: 'x'.repeat(400) }, usage: { prompt_tokens: 7, completion_tokens: 5 } };
      },
    };
    const client = createSharedBudgetClient(flaky, account);
    await assert.rejects(client.complete({ messages: [] }), /transport failed/);
    assert.equal(account.spent().turns, 1, 'the failed call consumed its reserved turn');
    await client.complete({ messages: [] });
    assert.equal(account.spent().turns, 2);
    assert.equal(account.spent().tokens, 12, 'reported usage wins; the 4-char estimate never fires when usage exists');
  });
});

describe('the effective toolbox', () => {
  it('refuses an effectful tool whose binding cannot honor a key, at bind time', () => {
    const withEffectful: MasRegistry = {
      ...registry,
      tools: [...registry.tools, {
        id: 'save-report',
        title: 'Persist the report',
        effect: 'effectful',
        input: { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false },
        inputRevision: 'a'.repeat(64),
      }],
    };
    const refused = validateToolBindings(withEffectful, ['save-report'], {
      'save-report': { handler: async () => ({ saved: true }) },
    });
    assert.ok(!refused.valid);
    assert.equal(refused.issues[0].code, 'TMAS1009');
    assert.match(refused.issues[0].detail, /idempotency/);

    const honored = validateToolBindings(withEffectful, ['save-report'], {
      'save-report': { handler: async () => ({ saved: true }), idempotency: 'honored' },
    });
    assert.ok(honored.valid);
  });

  it('schema-checks input through createToolbox and keeps refusals readable', async () => {
    const keys: Array<string | null> = [];
    const built = buildEffectiveToolbox({
      registry,
      requested: ['fetch-metrics'],
      bindings: { 'fetch-metrics': { handler: (input, context) => { keys.push(context.idempotencyKey); return { got: input }; } } },
      signal: new AbortController().signal,
      idempotencyKeyFor: (tool, index) => `run/r//0/n/tool/${tool}/${index}`,
    });
    assert.ok(built.valid && built.value.toolbox !== null);
    const toolbox = built.value.toolbox;

    const invalid = await toolbox.execute('fetch-metrics', { metric: 7 }) as { error?: string, errors?: unknown[] };
    assert.ok(invalid.error !== undefined && Array.isArray(invalid.errors), 'invalid input is the readable refusal shape');
    const unknown = await toolbox.execute('ghost', {}) as { error?: string };
    assert.match(unknown.error ?? '', /unknown tool/);
    const valid = await toolbox.execute('fetch-metrics', { metric: 'research' }) as { got: { metric: string } };
    assert.equal(valid.got.metric, 'research');
    assert.deepEqual(keys, [null], 'a read tool receives no idempotency key — the key is for effectful handlers only');
  });

  it('an uncertain external success raises the guard instead of a silent result', async () => {
    const withEffectful: MasRegistry = {
      ...registry,
      tools: [...registry.tools, {
        id: 'save-report',
        title: 'Persist the report',
        effect: 'effectful',
        input: { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false },
        inputRevision: 'a'.repeat(64),
      }],
    };
    const built = buildEffectiveToolbox({
      registry: withEffectful,
      requested: ['save-report'],
      bindings: {
        'save-report': {
          handler: () => { throw new MasUncertainEffect('save-report', 'the write may have landed'); },
          idempotency: 'honored',
        },
      },
      signal: new AbortController().signal,
      idempotencyKeyFor: (tool, index) => `k/${tool}/${index}`,
    });
    assert.ok(built.valid && built.value.toolbox !== null);
    const result = await built.value.toolbox.execute('save-report', { name: 'weekly' }) as { error?: string };
    assert.match(result.error ?? '', /^uncertain:/, 'the model sees a readable error, never a silent success');
    assert.ok(built.value.uncertainty.value instanceof MasUncertainEffect, 'the out-of-band box records the guard for the lifecycle to stop on');
    assert.equal(built.value.uncertainty.value?.toolName, 'save-report');
  });
});
