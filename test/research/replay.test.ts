import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createReplayTransport, discoverCrossref } from '@tangleai/research';
import { loadResearchFixture } from '../../benchmark/lib/research-fixture.ts';
import { runNativeResearchFixture } from '../../benchmark/lib/research-workflow.ts';
import { query, providerHost, adapterContext, transcript } from './discovery-fixtures.ts';

it('two replay runs make zero network calls and produce identical artifacts', async () => {
  const loaded = await loadResearchFixture(), prior = globalThis.fetch; let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw Error('Unexpected network request.'); };
  try {
    const first = await runNativeResearchFixture(loaded, loaded.topics[0], 'a'.repeat(64));
    const second = await runNativeResearchFixture(loaded, loaded.topics[0], 'a'.repeat(64));
    assert.deepEqual(first.discovery, second.discovery);
    assert.deepEqual(first.measurement.artifacts, second.measurement.artifacts);
    assert.equal(first.discovery?.cards.total, 16); assert.equal(first.discovery?.cards.resolvable, 16);
    assert.deepEqual(first.discovery?.replay, { requests: 20, misses: 0, networkCalls: 0 });
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = prior; }
});
it('a replay miss remains a counted TRSH1008 and never dispatches ambient fetch', async () => {
  const replay = await createReplayTransport([], { scope: 'missing' });
  const result = await discoverCrossref(query('crossref'), providerHost(replay.transport), adapterContext());
  assert.equal(result.records.length, 0); assert.equal(result.outcome.issues[0].code, 'TRSH1008');
  assert.equal(result.outcome.reason, 'replay-miss'); assert.equal(result.outcome.issues[0].cause?.reason, 'replay-miss');
  assert.deepEqual(replay.stats(), { requests: 2, misses: 2, networkCalls: 0 });
});
it('replay snapshots transcripts and keeps exact query ordering and public headers', async () => {
  const entry = await transcript('failures/server-error'), replay = await createReplayTransport([entry], { scope: 'request-identity' });
  const url = entry.url; entry.response.body = 'mutated';
  const response = await replay.transport({ url, method: 'GET', safety: 'safe-read' }, { signal: new AbortController().signal, attempt: 1, maxAttempts: 1 });
  assert.notEqual(await response.text(), 'mutated');
  for (const request of [{ url, headers: { accept: 'application/json' } }, { url: url.replace('query=server-error&rows=5', 'rows=5&query=server-error') }])
    await assert.rejects(replay.transport({ ...request, method: 'GET', safety: 'safe-read' }, { signal: new AbortController().signal, attempt: 1, maxAttempts: 1 }), /TRSH1008/);
});
