/** One independently asserted transaction protocol, exercised by all three backends. */
import assert from 'node:assert/strict';
import { createConsolidationSource, createConsolidationArtifact, createConsolidationMemoryPersistence, createConsolidationStoreAdapter, type ConsolidationResult,
  type ConsolidationStore, type ConsolidationApply } from '@tangleai/memory/consolidation';
export interface ConsolidationProbeHost {
  store: ConsolidationStore;
  peer: ConsolidationStore;
  failAt: string | null;
  reopen(): Promise<void>;
  close(): Promise<void>;
}
export const consolidationMust = <T>(result: ConsolidationResult<T>): T => {
  if (result.status !== 'success') throw new Error(`${result.reason}: ${result.detail}`);
  return result.value;
};
const must = consolidationMust;
const reason = (result: ConsolidationResult<unknown>) => result.status === 'refused' ? result.reason : null;
export async function consolidationProbeSource(scope: string, key = 'first', sequence = 0) {
  return must(await createConsolidationSource({ scope, key, sequence, snapshot: {
    id: 'same-content-id', text: 'Sam meets Alex in Paris.', evidence: 'host transcript', tags: ['travel'],
    at: '2023-05-08T13:56:00Z', kind: 'event',
  } }));
}
async function plan(scope: string, sources: Awaited<ReturnType<typeof consolidationProbeSource>>[]): Promise<ConsolidationApply> {
  const recipeHash = 'a'.repeat(64);
  const artifact = must(await createConsolidationArtifact({ scope, recipeHash, text: 'Sam meets Alex in Paris.',
    sourceIds: sources.map(source => source.id), keywords: ['paris'], tier: 'deterministic' }));
  return { scope, key: 'pass', expectedGeneration: 0, sourceIds: sources.map(source => source.id),
    recipeHash, artifacts: [artifact], completedAt: 1000 };
}
export async function runConsolidationStoreProbes(create: () => Promise<ConsolidationProbeHost>) {
  const passed: string[] = [];
  async function check(name: string, task: (host: ConsolidationProbeHost) => Promise<void>) {
    const host = await create();
    try { await task(host); passed.push(name); } finally { await host.close(); }
  }
  await check('qualified-source-replay-and-capacity', async host => {
    const a = await consolidationProbeSource('delivery'), b = await consolidationProbeSource('delivery', 'second', 1);
    assert.notEqual(a.id, b.id);
    const first = must(await host.store.enqueue([a, b], { maxPending: 2 }));
    assert.equal(first.admitted, 2);
    const before = must(await host.store.snapshot(a.scope));
    const replay = must(await host.store.enqueue([a, b], { maxPending: 2 }));
    assert.equal(replay.writes, 0); assert.equal(replay.admitted, 0);
    assert.deepEqual(must(await host.store.snapshot(a.scope)), before);
    const conflict = must(await createConsolidationSource({ ...a, snapshot: { ...a.snapshot, text: 'changed' } }));
    assert.equal(reason(await host.store.enqueue([conflict], { maxPending: 2 })), 'identity-conflict');
    assert.equal(reason(await host.store.enqueue([await consolidationProbeSource(a.scope, 'third', 2)], { maxPending: 2 })), 'capacity');
    assert.deepEqual(must(await host.store.snapshot(a.scope)), before);
    before.sources[0].snapshot.text = 'caller mutation';
    assert.equal(must(await host.store.snapshot(a.scope)).sources[0].snapshot.text, a.snapshot.text);
  });
  await check('activation-replay-and-actual-reopen', async host => {
    const a = await consolidationProbeSource('reopen'); must(await host.store.enqueue([a], { maxPending: 2 }));
    const input = await plan(a.scope, [a]);
    const first = must(await host.store.apply(input)); assert.equal(first.writes, 3);
    const snapshot = must(await host.store.snapshot(a.scope));
    assert.equal(snapshot.sources.length, 1); assert.equal(snapshot.buffer.pending.length, 0);
    await host.reopen(); assert.deepEqual(must(await host.store.snapshot(a.scope)), snapshot);
    const replay = must(await host.store.apply(input));
    assert.equal(replay.writes, 0); assert.equal(replay.logicalCalls, 0); assert.equal(replay.embeddingItems, 0);
    assert.equal(host.store.stats().writes, 0); assert.equal(replay.revision, first.revision);
    const changed = await plan(a.scope, [a]); changed.artifacts = [must(await createConsolidationArtifact({ ...input.artifacts[0], text: 'changed summary' }))];
    assert.equal(reason(await host.store.apply(changed)), 'identity-conflict');
    assert.deepEqual(must(await host.store.snapshot(a.scope)), snapshot);
  });
  await check('whole-evidence-membership-before-writes', async host => {
    const a = await consolidationProbeSource('membership'), b = await consolidationProbeSource('membership', 'second', 1);
    must(await host.store.enqueue([a, b], { maxPending: 2 }));
    const before = must(await host.store.snapshot(a.scope));
    const partial = await plan(a.scope, [a]); partial.sourceIds.push(b.id);
    assert.equal(reason(await host.store.apply(partial)), 'invalid-artifact');
    const foreign = await consolidationProbeSource('foreign'); must(await host.store.enqueue([foreign], { maxPending: 1 }));
    const invalid = await plan(a.scope, [foreign]);
    assert.equal(reason(await host.store.apply(invalid)), 'invalid-source');
    assert.deepEqual(must(await host.store.snapshot(a.scope)), before);
  });
  await check('competing-generation-and-unrelated-admission', async host => {
    const a = await consolidationProbeSource('race'), b = await consolidationProbeSource('race', 'second', 1);
    must(await host.store.enqueue([a], { maxPending: 2 }));
    const input = await plan(a.scope, [a]);
    // New evidence does not invalidate an immutable captured batch. Activation does.
    must(await host.store.enqueue([b], { maxPending: 2 }));
    const outcomes = await Promise.all([host.store.apply(input), host.peer.apply({ ...input, key: 'contender' })]);
    assert.equal(outcomes.filter(result => result.status === 'success').length, 1);
    assert.equal(outcomes.filter(result => reason(result) === 'stale-generation').length, 1);
    const state = must(await host.store.snapshot(a.scope));
    assert.deepEqual(state.buffer.pending, [b.id]); assert.equal(state.sources.length, 2);
    assert.equal(state.artifacts.length, 1); assert.equal(state.operations.length, 1);
  });
  for (const step of ['put:sources', 'put:buffers', 'commit']) await check(`delivery-rollback-${step}`, async host => {
    const source = await consolidationProbeSource('delivery-failure');
    const before = must(await host.store.snapshot(source.scope));
    host.failAt = step;
    assert.equal(reason(await host.store.enqueue([source], { maxPending: 2 })), 'persistence');
    host.failAt = null;
    assert.deepEqual(must(await host.store.snapshot(source.scope)), before); assert.equal(host.store.stats().writes, 0);
  });
  for (const step of ['put:artifacts', 'put:buffers', 'put:operations', 'commit']) await check(`activation-rollback-${step}`, async host => {
    const source = await consolidationProbeSource('activation-failure');
    must(await host.store.enqueue([source], { maxPending: 2 }));
    const before = must(await host.store.snapshot(source.scope)), writes = host.store.stats().writes;
    host.failAt = step;
    assert.equal(reason(await host.store.apply(await plan(source.scope, [source]))), 'persistence');
    host.failAt = null;
    assert.deepEqual(must(await host.store.snapshot(source.scope)), before); assert.equal(host.store.stats().writes, writes);
    const recovered = must(await host.store.apply(await plan(source.scope, [source]))); assert.equal(recovered.writes, 3);
  });
  await check('operation-reservation-and-terminal-immutability', async host => {
    const source = await consolidationProbeSource('operation'); must(await host.store.enqueue([source], { maxPending: 2 }));
    const request = { scope: source.scope, key: 'operation', requestHash: 'b'.repeat(64), expectedGeneration: 0,
      sourceIds: [source.id], recipeHash: 'a'.repeat(64), maxLogicalCalls: 2 };
    const contenders = await Promise.all([host.store.reserve(request), host.store.reserve(request)]);
    assert.equal(contenders.filter(result => result.status === 'success' && !result.value.replayed).length, 1);
    assert.equal(reason(await host.store.reserve({ ...request, maxLogicalCalls: 3 })), 'identity-conflict');
    const operation = must(contenders[0]).operation;
    const working = must(await host.store.update({ ...operation, revision: 1, phase: 'working', steps: [{
      key: 'synthesis', kind: 'synthesis', requestHash: 'c'.repeat(64), phase: 'dispatched', result: null, detail: null,
    }] }, 0));
    assert.equal(reason(await host.store.update({ ...operation, revision: 1, phase: 'failed', failure: 'refusal' }, 0)), 'invalid-operation');
    await host.reopen(); assert.deepEqual(must(await host.store.operation(source.scope, request.key)), working);
    const terminal = must(await host.store.update({ ...working, revision: 2, phase: 'failed', failure: 'refusal',
      steps: [{ ...working.steps[0], phase: 'failed', detail: 'provider refused' }] }, 1));
    assert.equal(reason(await host.store.update({ ...terminal, phase: 'working', failure: null, revision: 3 }, 2)), 'invalid-operation');
    assert.deepEqual(must(await host.store.snapshot(source.scope)).buffer.pending, [source.id]);
  });
  return { cases: passed, passed: passed.length, failed: 0, physicalRequests: 0 };
}


export async function createConsolidationMemoryProbeHost(): Promise<ConsolidationProbeHost> {
  let host: ConsolidationProbeHost;
  const applyProbe = (step: string) => { if (host?.failAt === step) throw new Error(`injected ${step}`); };
  let persistence = createConsolidationMemoryPersistence({ applyProbe });
  host = {
    store: createConsolidationStoreAdapter(persistence), peer: createConsolidationStoreAdapter(persistence), failAt: null,
    async reopen() {
      const state = persistence.exportState(); await persistence.close();
      persistence = createConsolidationMemoryPersistence({ state, applyProbe });
      host.store = createConsolidationStoreAdapter(persistence); host.peer = createConsolidationStoreAdapter(persistence);
    },
    close: () => persistence.close(),
  };
  return host;
}
