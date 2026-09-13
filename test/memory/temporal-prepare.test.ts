import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalMemoryStore, createTemporalMemoryPersistence, createTemporalStoreAdapter, prepareTemporal, temporalValue,
  createSourceOccurrence, temporalStamp } from '@tangleai/memory/temporal';
import { temporalTestBundle, extractionReply, chatResponse, preparationInput, TEMPORAL_TEST_MODEL } from '../fixtures/temporal-provider.ts';
test('structured extraction is cited and replay survives reopen with zero calls, writes or activations', async () => {
  const bundle = await temporalTestBundle(), input = preparationInput(bundle), persistence = createTemporalMemoryPersistence();
  let store = createTemporalStoreAdapter(persistence), calls = 0;
  const fetch: typeof globalThis.fetch = async (_url, init) => { calls++; const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, false); assert.equal(body.max_tokens, input.limits.maxOutputTokens); return chatResponse(extractionReply(bundle)); };
  temporalValue(await prepareTemporal(input, { store, fetch, model: TEMPORAL_TEST_MODEL }));
  const snapshot = temporalValue(await store.snapshot(input.scope)); assert.equal(snapshot.claims.length, 1); assert.equal(calls, 1);
  assert.equal(snapshot.claims[0].derivation.method, 'model');
  store = createTemporalMemoryStore({ state: persistence.exportState() });
  const replay = temporalValue(await prepareTemporal(input, { store, fetch, model: TEMPORAL_TEST_MODEL }));
  assert.equal(replay.replayed, true); assert.equal(replay.writes, 0); assert.equal(replay.activations, 0); assert.equal(calls, 1); assert.equal(store.stats().writes, 0);
  const mismatch = await prepareTemporal({ ...input, policyIdentity: 'changed' }, { store, fetch, model: TEMPORAL_TEST_MODEL });
  assert.equal(mismatch.status !== 'success' && mismatch.reason, 'identity-mismatch'); assert.equal(calls, 1);
});
test('same-key contenders buy one physical request and activate once', async () => {
  const bundle = await temporalTestBundle(), input = preparationInput(bundle), store = createTemporalMemoryStore(); let calls = 0;
  const fetch: typeof globalThis.fetch = async () => { calls++; await new Promise(r => setTimeout(r, 5)); return chatResponse(extractionReply(bundle)); };
  const results = await Promise.all([prepareTemporal(input, { store, fetch, model: TEMPORAL_TEST_MODEL }), prepareTemporal(input, { store, fetch, model: TEMPORAL_TEST_MODEL })]);
  assert.equal(calls, 1); assert.equal(store.stats().activations, 1); assert.ok(results.some(r => r.status === 'success'));
  assert.ok(results.every(r => r.status === 'success' || r.reason === 'provider-refusal'));
});
test('strict preparation removes future sources before extraction, vectors and cache identities', async () => {
  const bundle = await temporalTestBundle(), input = preparationInput(bundle), store = createTemporalMemoryStore();
  const future = temporalValue(await createSourceOccurrence({ scope: input.scope, sessionOrdinal: 100, turnOrdinal: 0, role: 'user', text: 'FUTURE-SECRET', sourceLocator: 'future',
    observedAt: temporalValue(temporalStamp('2025-01-01T00:00:00Z')), knownAt: '2025-01-01T00:00:00Z' }));
  let calls = 0;
  const fetch: typeof globalThis.fetch = async (url, init) => {
    calls++; const body = String(init?.body); assert.equal(body.includes('FUTURE-SECRET'), false); assert.equal(body.includes('gold-answer'), false);
    if (String(url).endsWith('/embeddings')) return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }], usage: { prompt_tokens: 1 } }));
    const payload = JSON.parse(JSON.parse(body).messages.at(-1).content);
    assert.deepEqual(Object.keys(payload).sort(), ['scope', 'sources']); assert.equal(payload.sources.length, 1);
    return chatResponse(extractionReply(bundle));
  };
  const { embeddings: _, ...withoutVectors } = input;
  const result = await prepareTemporal({ ...withoutVectors, sources: [...input.sources, future], knowledge: { mode: 'strict-as-of', cutoff: '1970-01-01T00:00:01Z' } },
    { store, fetch, model: TEMPORAL_TEST_MODEL, embeddingModel: { ...TEMPORAL_TEST_MODEL, model: input.embeddedBy.model, identity: 'scripted-embedding-v1' } });
  temporalValue(result); assert.equal(calls, 2);
  const snapshot = temporalValue(await store.snapshot(input.scope)); assert.equal(snapshot.sources.length, 1); assert.equal(snapshot.projection.embeddings.length, 1);
  assert.equal(JSON.stringify(temporalValue(await store.operation(input.scope, input.key))).includes('FUTURE-SECRET'), false);
});
test('uncited and forged spans never activate, even when provider JSON is well formed', async () => {
  for (const corruption of ['uncited', 'quote', 'source-hash', 'coverage']) {
    const bundle = await temporalTestBundle(), input = preparationInput(bundle), store = createTemporalMemoryStore(), proposal = extractionReply(bundle);
    if (corruption === 'uncited') proposal.claims[0].citations = [];
    if (corruption === 'quote') proposal.claims[0].citations[0].quote = 'fabricated';
    if (corruption === 'source-hash') proposal.claims[0].citations[0].sourceHash = 'f'.repeat(64);
    if (corruption === 'coverage') proposal.coveredSourceIds = [];
    const result = await prepareTemporal(input, { store, model: TEMPORAL_TEST_MODEL, fetch: async () => chatResponse(proposal) });
    assert.equal(result.status !== 'success' && result.reason, corruption === 'coverage' ? 'incomplete-index' : 'identity-mismatch', corruption); assert.equal(temporalValue(await store.head(input.scope)), null);
    assert.equal(temporalValue(await store.operation(input.scope, input.key))!.phase, 'failed');
  }
});
test('host assertions need no model or transport, while imported model artifacts and malformed vectors refuse before purchase', async () => {
  const bundle = await temporalTestBundle(), input = preparationInput(bundle), store = createTemporalMemoryStore();
  temporalValue(await prepareTemporal({ ...input, claims: bundle.claims, limits: { ...input.limits, maxPhysicalRequests: 0 } }, { store }));
  assert.equal(temporalValue(await store.operation(input.scope, input.key))!.attempts.length, 0);
  let calls = 0;
  const badVector = await prepareTemporal({ ...input, key: 'bad-vector', embeddings: [{ sourceId: bundle.sources[0].id, vector: [1] }] },
    { store, model: TEMPORAL_TEST_MODEL, fetch: async () => { calls++; return chatResponse(extractionReply(bundle)); } });
  assert.equal(badVector.status !== 'success' && badVector.reason, 'identity-mismatch'); assert.equal(calls, 0);
  const imported = await prepareTemporal({ ...input, key: 'imported', claims: bundle.claims.map(c => ({ ...c, derivation: { ...c.derivation, method: 'model' as const } })) }, { store });
  assert.equal(imported.status !== 'success' && imported.reason, 'identity-mismatch');
});
