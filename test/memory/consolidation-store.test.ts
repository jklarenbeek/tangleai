import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createConsolidationMemoryPersistence, createConsolidationStoreAdapter, createConsolidationMemoryStore, createConsolidationSource, createConsolidationArtifact } from '@tangleai/memory/consolidation';
import { runConsolidationStoreProbes, consolidationProbeSource, consolidationMust as must, createConsolidationMemoryProbeHost } from '../../benchmark/lib/consolidate-store-probes.ts';

it('memory persistence qualifies the shared complete atomic protocol', async () => {
  const result = await runConsolidationStoreProbes(createConsolidationMemoryProbeHost);
  assert.equal(result.passed, 12); assert.equal(result.failed, 0); assert.equal(result.physicalRequests, 0);
});


it('an unknown dispatch cannot be reset to dispatched and spend the same reservation again', async () => {
  const store = createConsolidationMemoryStore();
  const source = await consolidationProbeSource('unknown'); must(await store.enqueue([source], { maxPending: 2 }));
  const reserved = must(await store.reserve({ scope: source.scope, key: 'run', requestHash: 'b'.repeat(64),
    expectedGeneration: 0, sourceIds: [source.id], recipeHash: 'a'.repeat(64), maxLogicalCalls: 1 })).operation;
  const dispatched = must(await store.update({ ...reserved, revision: 1, phase: 'working', steps: [{ key: 'synthesis',
    kind: 'synthesis', requestHash: 'c'.repeat(64), phase: 'dispatched', result: null, detail: null }] }, 0));
  const unknown = must(await store.update({ ...dispatched, revision: 2,
    steps: [{ ...dispatched.steps[0], phase: 'unknown', detail: 'host stopped' }] }, 1));
  const reset = await store.update({ ...unknown, revision: 3,
    steps: [{ ...unknown.steps[0], phase: 'dispatched', detail: null }] }, 2);
  assert.equal(reset.status, 'refused');
  assert.deepEqual(must(await store.operation(source.scope, 'run')), unknown);
});

it('revision exhaustion refuses admission without leaving an unreadable pending buffer', async () => {
  const source = await consolidationProbeSource('exhausted');
  const store = createConsolidationMemoryStore({ state: { sources: [], artifacts: [], operations: [], buffers: [{
    scope: source.scope, revision: Number.MAX_SAFE_INTEGER, generation: 0, pending: [], completedAt: null,
  }] } });
  const before = must(await store.snapshot(source.scope));
  assert.equal((await store.enqueue([source], { maxPending: 2 })).status, 'refused');
  assert.deepEqual(must(await store.snapshot(source.scope)), before);
  assert.equal(store.stats().writes, 0);
});


it('refuses duplicate persisted occurrence keys', async () => {
  const source = await consolidationProbeSource('corrupt');
  const different = must(await createConsolidationSource({ ...source, snapshot: { ...source.snapshot, text: 'different content' } }));
  const duplicate = createConsolidationMemoryStore({ state: { sources: [source, different], artifacts: [], buffers: [], operations: [] } });
  assert.equal((await duplicate.snapshot(source.scope)).status, 'refused');
});

it('checks persisted snapshot hashes before activating their evidence', async () => {
  const source = await consolidationProbeSource('corrupt');
  const persistence = createConsolidationMemoryPersistence({ state: {
    sources: [{ ...source, snapshot: { ...source.snapshot, text: 'tampered' } }], artifacts: [], operations: [],
    buffers: [{ scope: source.scope, revision: 1, generation: 0, pending: [source.id], completedAt: null }],
  } });
  const store = createConsolidationStoreAdapter(persistence), before = persistence.exportState();
  const recipeHash = 'a'.repeat(64);
  const artifact = must(await createConsolidationArtifact({ scope: source.scope, recipeHash, tier: 'deterministic',
    text: source.snapshot.text, sourceIds: [source.id], keywords: [] }));
  assert.equal((await store.apply({ scope: source.scope, recipeHash, key: 'pass', expectedGeneration: 0,
    sourceIds: [source.id], artifacts: [artifact], completedAt: 1000 })).status, 'refused');
  assert.deepEqual(persistence.exportState(), before);
  await persistence.close();
});
