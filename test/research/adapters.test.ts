import assert from 'node:assert/strict';
import { it } from 'node:test';
import { compileProvider } from '@jarenjs/contract/provider';
import { discoverOpenalex, discoverCrossref, discoverSemanticScholar, discoverArxiv, discoverSearxng,
  createReplayTransport, researchArtifactIdOf } from '@tangleai/research';
import { query, adapterContext, providerHost, providerReplay, transcript } from './discovery-fixtures.ts';

for (const [provider, adapter] of Object.entries({ openalex: discoverOpenalex, crossref: discoverCrossref,
  semanticscholar: discoverSemanticScholar, arxiv: discoverArxiv }) as Array<['openalex' | 'crossref' | 'semanticscholar' | 'arxiv', typeof discoverOpenalex]>) {
  it(provider + ' traverses native replay pages and retains every raw observation', async () => {
    const replay = await providerReplay(provider), result = await adapter(query(provider), providerHost(replay.transport), adapterContext());
    assert.equal(result.outcome.state, 'complete', JSON.stringify(result.outcome));
    assert.equal(result.records.length, 8); assert.equal(result.outcome.attempts, provider === 'openalex' ? 3 : 2);
    const artifacts = new Map(await Promise.all(result.artifacts.map(async a => [await researchArtifactIdOf(a.bytes), a.bytes] as const)));
    for (const record of result.records) for (const raw of record.rawHashes) assert.ok(artifacts.has('art-' + raw.sha256));
    assert.ok(artifacts.has(result.outcome.observationArtifactId)); assert.equal(replay.stats().networkCalls, 0);
  });
}
for (const reason of ['rate-limited', 'server-error', 'malformed-json']) it(reason + ' retains native failures and captured response bytes', async () => {
  const replay = await createReplayTransport([await transcript('failures/' + reason)], { scope: 'failures' });
  const result = await discoverCrossref(query('crossref', reason), providerHost(replay.transport), adapterContext());
  assert.equal(result.outcome.state, 'incomplete'); assert.equal(result.records.length, 0);
  assert.equal(result.outcome.issues[0].code, 'TRSH1008');
  assert.equal(result.outcome.attempts, reason === 'malformed-json' ? 1 : 2);
  if (reason !== 'malformed-json') {
    assert.equal(result.outcome.issues[0].cause?.state, 'failed');
    assert.equal(result.outcome.issues[0].cause?.status, reason === 'rate-limited' ? 429 : 500);
    assert.equal(result.outcome.counts.failed, 2); assert.equal(result.outcome.counts.rateLimited, reason === 'rate-limited' ? 2 : 0);
  }
  assert.ok(result.outcome.rawHashes.length); assert.ok(result.outcome.observationArtifactId);
});
it('arXiv malformed XML is a counted typed refusal', async () => {
  const replay = await createReplayTransport([await transcript('failures/malformed-atom')], { scope: 'failures' });
  const result = await discoverArxiv(query('arxiv', 'malformed-atom'), providerHost(replay.transport), adapterContext());
  assert.equal(result.outcome.state, 'incomplete'); assert.equal(result.outcome.reason, 'malformed-atom');
  assert.equal(result.outcome.issues[0].code, 'TRSH1008'); assert.ok(result.outcome.rawHashes.length);
});
it('SearxNG hashes the raw response before normalization and emits candidates only', async () => {
  const replay = await providerReplay('searxng');
  const result = await discoverSearxng(query('searxng'), providerHost(replay.transport), adapterContext(), 'https://search.fixture.invalid');
  assert.equal(result.outcome.state, 'complete', JSON.stringify(result.outcome)); assert.equal(result.records.length, 0);
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].queryId, query('searxng').id);
  assert.equal(result.candidates[0].rawHash, (await researchArtifactIdOf(new TextEncoder().encode((await transcript('kmeans-seeding/searxng-1')).response.body))).slice(4));
});
it('native descriptor compilation refuses authorization and unknown fields with JC0021', () => {
  const descriptor = { $provider: '0.1', id: 'refusal', apiVersion: '1', endpoint: 'https://fixture.invalid', protocol: 'rest', method: 'GET',
    safety: 'safe-read', response: { rows: '$.rows', id: '$.id' }, pagination: { empty: 'complete' } };
  for (const bad of [{ ...descriptor, headers: { authorization: 'fixture-public-string' } }, { ...descriptor, unknown: true }])
    assert.throws(() => compileProvider(bad), (error: any) => error.code === 'JC0021');
});
it('row and byte exhaustion preserve audit evidence but admit no partial literature', async () => {
  for (const overrides of [{ rows: 2 }, { bytes: 40 }]) {
    const replay = await providerReplay('openalex'), context = adapterContext();
    const result = await discoverOpenalex(query('openalex', 'kmeans-seeding', overrides), providerHost(replay.transport), context);
    assert.notEqual(result.outcome.state, 'complete'); assert.equal(result.records.length, 0); assert.ok(result.outcome.issues.length);
    assert.notEqual(result.outcome.reason, 'replay-miss');
    assert.ok(result.outcome.observationArtifactId); assert.equal(replay.stats().networkCalls, 0);
  }
});
it('raw hashes retain a UTF-8 BOM even though native JSON decoding removes it', async () => {
  const entry = await transcript('collisions/distinct-title'); entry.response.body = '\ufeff' + entry.response.body;
  const replay = await createReplayTransport([entry], { scope: 'bom' });
  const result = await discoverCrossref(query('crossref', 'distinct-title'), providerHost(replay.transport), adapterContext());
  assert.equal(result.outcome.state, 'complete');
  assert.equal(result.records[0].rawHashes[0].sha256, (await researchArtifactIdOf(new TextEncoder().encode(entry.response.body))).slice(4));
});
it('cancelled admission performs no request and remains counted', async () => {
  const replay = await providerReplay('crossref'), context = adapterContext(), controller = new AbortController();
  controller.abort(); context.signal = controller.signal;
  const result = await discoverCrossref(query('crossref'), providerHost(replay.transport), context);
  assert.equal(result.records.length, 0); assert.equal(result.outcome.counts.cancelled, 1); assert.equal(replay.stats().requests, 0);
});
it('adapters snapshot caller query and licence before yielding', async () => {
  const replay = await providerReplay('crossref'), request = query('crossref'), host = providerHost(replay.transport);
  const expectedId = request.id, pending = discoverCrossref(request, host, adapterContext());
  request.id = 'mutated'; request.text = 'mutated'; host.licence = { spdx: 'NOASSERTION', provenance: 'unasserted', source: 'changed' };
  const result = await pending;
  assert.equal(result.outcome.queryId, expectedId); assert.equal(result.records.length, 8);
  assert.ok(result.records.every(r => r.licence.provenance === 'tangle-authored-synthetic'));
});
