/**
 * The context seam: closed outcomes with addresses/citations/
 * capabilities, explicit unavailable/failed states, clamped bounds,
 * abort honoring — and the suite ledger/environment composition with a
 * bounded digest, an explicit read budget and idempotent chunking.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDocumentsContextProvider,
  createMasAgentContext,
  createMcpContextProvider,
  createMemoryContextProvider,
  createToolboxContextProvider,
  createWebContextProvider,
} from '@tangleai/mas';

const OPTIONS = { signal: new AbortController().signal, maxUnits: 2, maxChars: 40 };

describe('context providers return closed outcomes', () => {
  it('memory: identity-gated recall with addresses, clamped to bounds', async () => {
    const provider = createMemoryContextProvider({
      recall: async () => [
        { id: 'm1', text: 'a'.repeat(100) },
        { id: 'm2', text: 'short' },
        { id: 'm3', text: 'never reaches the unit cap' },
      ],
    });
    const outcome = await provider.read({ node: 'writer', query: {} }, OPTIONS);
    assert.equal(outcome.outcome, 'ok');
    assert.ok(outcome.outcome === 'ok');
    assert.equal(outcome.units.length, 1, 'the char budget ends the list before the second unit');
    assert.equal(outcome.units[0].address, 'memory:m1');
    // the suite's truncate cuts at the budget and appends its marker
    assert.ok(outcome.units[0].text.length < 60 && outcome.units[0].text.includes('[truncated]'));
  });

  it('an unconfigured host is an explicit unavailable, never a silent empty', async () => {
    for (const provider of [
      createMemoryContextProvider(null),
      createDocumentsContextProvider(null),
      createWebContextProvider(null),
      createMcpContextProvider(null),
    ]) {
      const outcome = await provider.read({ node: 'n', query: {} }, OPTIONS);
      assert.equal(outcome.outcome, 'unavailable', `${provider.id} states its absence`);
      assert.ok(outcome.outcome === 'unavailable' && outcome.reason.length > 0);
    }
  });

  it('a throwing host and a raised signal are explicit failures', async () => {
    const provider = createDocumentsContextProvider({
      recallChunks: async () => { throw new Error('index offline'); },
    });
    const failed = await provider.read({ node: 'n', query: {} }, OPTIONS);
    assert.ok(failed.outcome === 'failed' && failed.reason.includes('index offline'));

    const aborted = new AbortController();
    aborted.abort();
    const early = await provider.read({ node: 'n', query: {} }, { ...OPTIONS, signal: aborted.signal });
    assert.equal(early.outcome, 'failed');
  });

  it('web snippets carry the discovery capability, never evidence', async () => {
    const provider = createWebContextProvider({
      search: async () => [{ url: 'https://example.com', title: 'T', snippet: 'S' }],
    });
    const outcome = await provider.read({ node: 'n', query: 'q' }, OPTIONS);
    assert.ok(outcome.outcome === 'ok');
    assert.deepEqual(outcome.units[0].capabilities, ['discovery']);
  });

  it('toolbox context is the manifest — declarations, not closures', async () => {
    const provider = createToolboxContextProvider({
      list: () => [{ name: 'fetch-metrics', description: 'Fetch one named metric', inputSchema: { type: 'object' } }],
    });
    const outcome = await provider.read({ node: 'n', query: {} }, { ...OPTIONS, maxChars: 500 });
    assert.ok(outcome.outcome === 'ok');
    assert.equal(outcome.units[0].address, 'tool:fetch-metrics');
    assert.ok(!outcome.units[0].text.includes('function'), 'no closure leaks into a unit');
  });

  it('the MCP seam reports injected availability before reading', async () => {
    const provider = createMcpContextProvider({
      status: () => ({ available: false, reason: 'not authenticated' }),
      read: async () => [],
    });
    const outcome = await provider.read({ node: 'n', query: {} }, OPTIONS);
    assert.ok(outcome.outcome === 'unavailable' && outcome.reason === 'not authenticated');
  });
});

describe('the suite ledger/environment composition', () => {
  it('keeps the root view bounded, requires an explicit read budget, and chunks idempotently', async () => {
    const context = createMasAgentContext({ now: () => '2026-01-01T00:00:00Z' });
    const corpus = 'line\n'.repeat(4000);
    await context.putCorpus('report', corpus);

    const digest = await context.environment.digest({}) as { slots: Array<{ excerpt: string }>, size: number };
    assert.ok(JSON.stringify(digest).length < corpus.length / 10, 'the digest never returns bulk content');

    const refused = await context.environment.read('report', {} as never) as { error?: string };
    assert.ok(refused.error !== undefined && refused.error.includes('character budget'), 'bulk content requires an explicit budget');
    const read = await context.environment.read('report', { chars: 50 }) as { text: string, more: boolean };
    assert.equal(read.text.length, 50);
    assert.equal(read.more, true);

    const first = await context.environment.chunk('report', { strategy: 'size', size: 4000 }) as { count: number, chunks: Array<{ name: string }> };
    const second = await context.environment.chunk('report', { strategy: 'size', size: 4000 }) as { count: number, chunks: Array<{ name: string }> };
    assert.deepEqual(first.chunks.map((chunk) => chunk.name), second.chunks.map((chunk) => chunk.name), 'identical chunking is idempotent — derived addresses');
  });

  it('archives and recalls through the suite ledger, not a local compactor', async () => {
    const context = createMasAgentContext({ now: () => '2026-01-01T00:00:00Z' });
    const slot = await context.ledger.putSlot('round/1', 'the drafted section', { kind: 'round' });
    assert.ok(!('error' in (slot as { error?: string })) || (slot as { error?: string }).error === undefined);
    const content = await context.ledger.readSlot('round/1');
    assert.equal(content, 'the drafted section');
  });
});
