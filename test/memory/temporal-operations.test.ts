import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemporalMemoryStore, prepareTemporal, temporalValue, recoverTemporalOperation } from '@tangleai/memory/temporal';
import { temporalTestBundle, extractionReply, chatResponse, preparationInput, TEMPORAL_TEST_MODEL } from '../fixtures/temporal-provider.ts';
test('zero request budget and oversized input dispatch no transport; one repair consumes a second request', async () => {
  for (const limit of [{ maxPhysicalRequests: 0 }, { maxInputTokens: 1 }]) {
    const bundle = await temporalTestBundle(), input = preparationInput(bundle), store = createTemporalMemoryStore(); let calls = 0;
    const result = await prepareTemporal({ ...input, limits: { ...input.limits, ...limit } }, { store, model: TEMPORAL_TEST_MODEL, fetch: async () => { calls++; return chatResponse(extractionReply(bundle)); } });
    assert.equal(result.status !== 'success' && result.reason, 'budget-exhausted'); assert.equal(calls, 0);
  }
  for (const budget of [1, 2]) {
    const bundle = await temporalTestBundle(), input = preparationInput(bundle), store = createTemporalMemoryStore(); let calls = 0;
    const result = await prepareTemporal({ ...input, limits: { ...input.limits, maxPhysicalRequests: budget, maxRepairs: 1 } },
      { store, model: TEMPORAL_TEST_MODEL, fetch: async () => chatResponse(++calls === 1 ? '{' : extractionReply(bundle)) });
    assert.equal(calls, budget); assert.equal(result.status, budget === 2 ? 'success' : 'refused');
    const operation = temporalValue(await store.operation(input.scope, input.key))!;
    assert.deepEqual(operation.attempts.map(a => a.role), budget === 2 ? ['extract', 'repair'] : ['extract']);
  }
});
test('HTTP failures have one attempt; response-before-persistence crashes become unknown and cannot retry', async () => {
  for (const mode of ['http', 'after-response']) {
    const bundle = await temporalTestBundle(), input = preparationInput(bundle), store = createTemporalMemoryStore(); let calls = 0;
    const options = { store, model: TEMPORAL_TEST_MODEL, fetch: async () => { calls++; return mode === 'http' ? new Response('down', { status: 503 }) : chatResponse(extractionReply(bundle)); },
      probe: (step: string) => { if (mode === 'after-response' && step === 'after-transport') throw Error('crash'); } };
    assert.equal((await prepareTemporal(input, options)).status, 'refused'); assert.equal(calls, 1);
    assert.equal((await prepareTemporal(input, options)).status, 'refused'); assert.equal(calls, 1);
    const operation = temporalValue(await store.operation(input.scope, input.key))!;
    assert.equal(operation.phase, mode === 'http' ? 'failed' : 'unknown'); assert.equal(temporalValue(await store.head(input.scope)), null);
  }
});
// The deadline has to outlast the preparation that runs BEFORE the fetch,
// or it fires during setup and `calls` is 0: a refusal, but not the one
// under test. A 20ms deadline lost that race whenever the suite ran four
// files wide, so the number is the fixtures' ordinary 1000ms — still two
// orders of magnitude shorter than a fetch that never resolves.
test('deadline aborts an uncooperative injected fetch and records uncertainty without activating', async () => {
  const bundle = await temporalTestBundle(), input = preparationInput(bundle), store = createTemporalMemoryStore(); let calls = 0;
  const result = await prepareTemporal({ ...input, limits: { ...input.limits, deadlineMs: 1000 } }, { store, model: TEMPORAL_TEST_MODEL,
    fetch: async () => { calls++; return new Promise<Response>(() => {}); } });
  assert.equal(result.status, 'refused'); assert.equal(calls, 1);
  assert.equal(temporalValue(await store.operation(input.scope, input.key))!.phase, 'unknown');
  assert.equal(temporalValue(await store.head(input.scope)), null);
});
test('explicit crashed-owner recovery preserves unknown outcome and completed operations require receipts', async () => {
  const store = createTemporalMemoryStore();
  const reserved = temporalValue(await store.reserveOperation({ scope: 's', key: 'crashed', requestIdentity: 'a'.repeat(64), maxPhysicalRequests: 1 })).operation;
  const invalid = await store.updateOperation({ ...reserved, phase: 'completed', revision: 1 }, 0);
  assert.equal(invalid.status, 'refused');
  const recovered = temporalValue(await recoverTemporalOperation(store, 's', 'crashed', 0));
  assert.equal(recovered.phase, 'unknown'); assert.equal(recovered.attempts.length, 0);
  assert.equal((await recoverTemporalOperation(store, 's', 'crashed', 0)).status, 'refused');
});
