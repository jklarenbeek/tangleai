import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createConsolidationExecutor, createConsolidationMemoryStore, createConsolidationSource, applyDeterministicConsolidation } from '@tangleai/memory/consolidation';
import { consolidationMust as must } from '../../benchmark/lib/consolidate-store-probes.ts';
async function fixture() {
  const store = createConsolidationMemoryStore();
  const sources = await Promise.all(['Sam moved to Paris in May.', 'In June Alex visited Sam in Paris.'].map(async (text, sequence) =>
    must(await createConsolidationSource({ scope: 'relation', key: `turn-${sequence}`, sequence,
      snapshot: { id: `memory-${sequence}`, text, evidence: `transcript/${sequence}`, kind: 'event', tags: [], at: '2024-06-01T00:00:00Z' } }))));
  must(await store.enqueue(sources, { maxPending: 2 }));
  const claims = [{ text: 'Alex visited Sam in Paris after Sam moved there.', sourceIds: sources.map(source => source.id) }];
  const input = { scope: 'relation', key: 'pass', sourceIds: sources.map(source => source.id), expectedGeneration: 0, completedAt: 1000 };
  let synthesis = 0, support = 0, embedding = 0;
  const seams = {
    synthesizer: { id: 'hand-relation-v1', async run() { synthesis++; return { status: 'ok', claims }; } },
    verifier: { id: 'hand-entailment-v1', async run(request: { claims: typeof claims }) { support++; return { status: 'ok', supported: request.claims.map(() => true) }; } },
    embedder: { model: 'fresh-test', dims: 2, async embed(texts: string[]) { embedding += texts.length; return { model: 'fresh-test', dims: 2, vectors: texts.map(() => [0, 1]) }; } },
  };
  return { store, sources, claims, input, seams, counts: () => ({ synthesis, support, embedding }) };
}
it('activates a supported cross-event relation with fresh identity and zero-effect replay', async () => {
  const f = await fixture(), executor = createConsolidationExecutor({ store: f.store, ...f.seams });
  const first = await executor.execute(f.input); assert.equal(first.status, 'success');
  assert.deepEqual(f.counts(), { synthesis: 1, support: 1, embedding: 1 });
  const state = must(await f.store.snapshot(f.input.scope));
  assert.equal(state.artifacts[0].text, f.claims[0].text); assert.deepEqual(state.artifacts[0].sourceIds, f.input.sourceIds);
  assert.deepEqual(state.artifacts[0].embedding, [0, 1]); assert.equal(state.artifacts[0].embeddedBy?.model, 'fresh-test');
  assert.equal(state.buffer.pending.length, 0); assert.equal(state.sources.length, 2);
  const replay = await executor.execute(f.input); assert.equal(replay.status, 'success');
  assert.equal(replay.accounting.invoked, 0); if (replay.status === 'success') assert.equal(replay.value.writes, 0);
  assert.deepEqual(must(await f.store.snapshot(f.input.scope)), state);
});
it('rejects unsupported cross-event generalization without buying embeddings or activating evidence', async () => {
  const f = await fixture(); let support = 0;
  const executor = createConsolidationExecutor({ store: f.store, ...f.seams,
    verifier: { id: 'reject-generalization', async run() { support++; return { status: 'ok', supported: [false] }; } } });
  const result = await executor.execute(f.input); assert.equal(result.status, 'refused');
  if (result.status === 'refused') assert.equal(result.reason, 'unsupported');
  assert.equal(support, 1); assert.equal(f.counts().embedding, 0);
  const state = must(await f.store.snapshot(f.input.scope)); assert.equal(state.artifacts.length, 0); assert.equal(state.buffer.pending.length, 2);
  await executor.execute(f.input); assert.equal(support, 1);
});
it('refuses foreign, duplicate, empty and missing citations before support or embedding', async () => {
  for (const bad of ['foreign', 'duplicate', 'empty', 'missing']) {
    const f = await fixture(); const ids = bad === 'foreign' ? ['a'.repeat(64)] : bad === 'duplicate' ? [f.sources[0].id, f.sources[0].id]
      : bad === 'empty' ? [] : [f.sources[0].id];
    const executor = createConsolidationExecutor({ store: f.store, ...f.seams,
      synthesizer: { id: 'bad-citations', async run() { return { status: 'ok', claims: [{ text: 'Unsupported', sourceIds: ids }] }; } } });
    const result = await executor.execute(f.input); assert.equal(result.status, 'refused', bad);
    assert.equal(f.counts().support, 0); assert.equal(f.counts().embedding, 0);
    assert.equal(must(await f.store.snapshot(f.input.scope)).buffer.pending.length, 2);
  }
});
it('keeps thrown callback outcome unknown until an explicit stopped-host resolution', async () => {
  const f = await fixture(); let calls = 0;
  const executor = createConsolidationExecutor({ store: f.store, ...f.seams,
    synthesizer: { id: 'unknown-fixture', async run() { calls++; throw new Error('connection lost after dispatch'); } } });
  const result = await executor.execute(f.input); assert.equal(result.status, 'refused');
  if (result.status === 'refused') assert.equal(result.reason, 'unknown');
  const retry = await executor.execute(f.input); assert.equal(retry.accounting.invoked, 0); assert.equal(calls, 1);
  const operation = must(await f.store.operation(f.input.scope, f.input.key))!;
  const resolved = await executor.resolve(f.input, { stopped: true, revision: operation.revision,
    requestHash: operation.steps[0].requestHash, result: { status: 'ok', claims: f.claims } });
  assert.equal(resolved.status, 'success');
  assert.equal((await executor.execute(f.input)).status, 'success'); assert.equal(calls, 1);
});
it('counts refusal, malformed output, overflow, fresh embedding faults and logical exhaustion separately', async () => {
  for (const kind of ['refusal', 'malformed', 'overflow', 'embedding-width', 'embedding-model', 'embedding-finite', 'call-budget']) {
    const f = await fixture();
    const executor = createConsolidationExecutor({ store: f.store, ...f.seams,
      bounds: kind === 'call-budget' ? { maxLogicalCalls: 1 } : undefined,
      synthesizer: { id: `negative-${kind}`, async run() {
        if (kind === 'refusal') return { status: 'refused', detail: 'Cannot establish the relation' };
        if (kind === 'malformed') return { claims: f.claims, unexpected: true };
        if (kind === 'overflow') return { status: 'ok', claims: [{ ...f.claims[0], text: 'x'.repeat(9000) }] };
        return { status: 'ok', claims: f.claims };
      } },
      embedder: { model: 'fresh-test', dims: 2, async embed() { return { model: kind === 'embedding-model' ? 'other' : 'fresh-test', dims: 2,
        vectors: [kind === 'embedding-width' ? [1] : kind === 'embedding-finite' ? [NaN, 1] : [0, 1]] }; } },
    });
    const result = await executor.execute(f.input); assert.equal(result.status, 'refused', kind);
    if (result.status === 'refused') assert.equal(result.reason, kind === 'refusal' ? 'refusal' : kind === 'malformed' ? 'invalid-artifact'
      : kind.startsWith('embedding') ? 'embedding' : 'budget');
    const c = result.accounting;
    assert.equal(c.reservedCalls, c.completedCalls + c.refusedCalls + c.failedCalls + c.unknownCalls);
    assert.equal(c.unknownCalls, 0);
    if (kind === 'call-budget') assert.equal(c.invoked, 0);
    if (kind === 'refusal') assert.equal(c.refusedCalls, 1);
    const state = must(await f.store.snapshot(f.input.scope)); assert.equal(state.artifacts.length, 0); assert.equal(state.buffer.pending.length, 2);
  }
});
it('drains cancellation with known staged results and never repeats completed callbacks', async () => {
  const f = await fixture(), controller = new AbortController(); let support = 0;
  const executor = createConsolidationExecutor({ store: f.store, ...f.seams,
    verifier: { id: 'cancel-after-support', async run() { support++; controller.abort(); return { status: 'ok', supported: [true] }; } } });
  const cancelled = await executor.execute({ ...f.input, signal: controller.signal });
  assert.equal(cancelled.status, 'refused'); if (cancelled.status === 'refused') assert.equal(cancelled.reason, 'cancelled');
  assert.equal(f.counts().embedding, 0); assert.equal(must(await f.store.snapshot(f.input.scope)).buffer.pending.length, 2);
  const resumed = await executor.execute(f.input); assert.equal(resumed.status, 'success');
  assert.equal(resumed.accounting.invoked, 1); assert.equal(support, 1); assert.equal(f.counts().synthesis, 1);
});

it('does not bypass an uncertain overlapping pass by changing the key or activating a fallback', async () => {
  const f = await fixture(); let calls = 0;
  const executor = createConsolidationExecutor({ store: f.store, ...f.seams,
    synthesizer: { id: 'uncertain-overlap', async run() { calls++; throw new Error('unknown'); } } });
  await executor.execute(f.input);
  const other = await executor.execute({ ...f.input, key: 'another-key' });
  assert.equal(other.status, 'refused'); if (other.status === 'refused') assert.equal(other.reason, 'unknown');
  assert.equal(calls, 1, 'another key must not repurchase uncertain work');
  const fallback = await applyDeterministicConsolidation(f.store, f.sources, { key: 'fallback', expectedGeneration: 0, completedAt: 1000 });
  assert.equal(fallback.status, 'refused'); if (fallback.status === 'refused') assert.equal(fallback.reason, 'unknown');
  assert.equal(must(await f.store.snapshot(f.input.scope)).buffer.pending.length, 2);
});
it('refuses deterministic activation over an unresolved callback reservation', async () => {
  const f = await fixture();
  const executor = createConsolidationExecutor({ store: f.store, ...f.seams,
    synthesizer: { id: 'uncertain-fallback', async run() { throw new Error('unknown'); } } });
  await executor.execute(f.input);
  const fallback = await applyDeterministicConsolidation(f.store, f.sources, { key: 'fallback', expectedGeneration: 0, completedAt: 1000 });
  assert.equal(fallback.status, 'refused'); if (fallback.status === 'refused') assert.equal(fallback.reason, 'unknown');
  assert.equal(must(await f.store.snapshot(f.input.scope)).buffer.pending.length, 2);
});
it('qualifies every staged callback boundary, actual reopen and independent handles in memory', async () => {
  const { runConsolidationExecutionProbes } = await import('../../benchmark/lib/consolidate-execution-probes.ts');
  const { createConsolidationMemoryProbeHost } = await import('../../benchmark/lib/consolidate-store-probes.ts');
  const report = await runConsolidationExecutionProbes(createConsolidationMemoryProbeHost);
  assert.equal(report.passed, 16); assert.equal(report.failed, 0); assert.equal(report.physicalRequests, 0);
});
it('releases a known stale prepared pass without replaying callbacks or consuming its sources', async () => {
  const f = await fixture();
  const input = { ...f.input, sourceIds: [f.sources[1].id] };
  const executor = createConsolidationExecutor({ store: f.store, ...f.seams,
    synthesizer: { id: 'disjoint-stale', async run() { return { status: 'ok', claims: [{ text: f.sources[1].snapshot.text, sourceIds: input.sourceIds }] }; } },
    verifier: { id: 'activate-disjoint', async run() {
      must(await applyDeterministicConsolidation(f.store, [f.sources[0]], { key: 'other-source', expectedGeneration: 0, completedAt: 1000 }));
      return { status: 'ok', supported: [true] };
    } },
  });
  const result = await executor.execute(input); assert.equal(result.status, 'refused');
  if (result.status === 'refused') assert.equal(result.reason, 'stale-generation');
  assert.equal(must(await f.store.operation(input.scope, input.key))?.phase, 'failed');
  assert.deepEqual(must(await f.store.snapshot(input.scope)).buffer.pending, input.sourceIds);
  assert.equal((await executor.execute(input)).accounting.invoked, 0);
});
it('validates explicit uncertainty resolution before effects and permits a separately labeled known-failure fallback', async () => {
  const f = await fixture(); let calls = 0;
  const executor = createConsolidationExecutor({ store: f.store, ...f.seams,
    synthesizer: { id: 'resolve-negative', async run() { calls++; throw new Error('unknown'); } } });
  await executor.execute(f.input);
  const before = must(await f.store.snapshot(f.input.scope)), operation = before.operations[0];
  const resolution = { stopped: true as const, revision: operation.revision, requestHash: operation.steps[0].requestHash,
    result: { status: 'ok', claims: f.claims } };
  assert.equal((await executor.resolve(f.input, { ...resolution, stopped: false } as never)).status, 'refused');
  assert.equal((await executor.resolve(f.input, { ...resolution, requestHash: 'a'.repeat(64) })).status, 'refused');
  assert.equal((await executor.resolve(f.input, { ...resolution, result: { status: 'ok', claims: [{ text: 'foreign', sourceIds: ['b'.repeat(64)] }] } })).status, 'refused');
  assert.deepEqual(must(await f.store.snapshot(f.input.scope)), before);
  must(await executor.resolve(f.input, { stopped: true, revision: operation.revision, requestHash: resolution.requestHash, failure: 'refusal' }));
  assert.equal((await executor.execute(f.input)).accounting.invoked, 0); assert.equal(calls, 1);
  must(await applyDeterministicConsolidation(f.store, f.sources, { key: 'known-failure-fallback', expectedGeneration: 0, completedAt: 1000 }));
  const state = must(await f.store.snapshot(f.input.scope));
  assert.ok(state.artifacts.every(artifact => artifact.tier === 'deterministic')); assert.equal(state.sources.length, 2);
});
