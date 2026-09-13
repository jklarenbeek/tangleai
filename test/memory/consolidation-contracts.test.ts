import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createConsolidationSource, validateConsolidationSource, createConsolidationArtifact,
  validateConsolidationArtifact, type ConsolidationResult } from '../../packages/memory/src/consolidation/contracts.ts';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';
import type { MemorySnapshot } from '@tangleai/core/schemas/consolidation';
const snapshot: MemoryUnit = { id: 'fact', text: 'Sam meets Alex in Paris.', evidence: 'conversation turn',
  tags: ['travel'], at: '2023-05-08T13:56:00Z', kind: 'event' };
const mirror: MemorySnapshot = snapshot;
const reverse: MemoryUnit = mirror;
void reverse;
const must = <T>(result: ConsolidationResult<T>): T => {
  if (result.status !== 'success') throw new Error(`${result.reason}: ${result.detail}`);
  return result.value;
};

it('qualifies exact snapshots by scope and occurrence while cloning caller-owned data', async () => {
  const input = { scope: 'chat', key: 'turn-1', sequence: 0, snapshot: structuredClone(snapshot) };
  const first = must(await createConsolidationSource(input));
  assert.deepEqual(must(await createConsolidationSource(input)), first);
  input.snapshot.text = 'A changed source';
  assert.equal(first.snapshot.text, snapshot.text);
  assert.notEqual(must(await createConsolidationSource({ ...input, snapshot, key: 'turn-2' })).id, first.id);
  assert.notEqual(must(await createConsolidationSource({ ...input, snapshot, scope: 'another-chat' })).id, first.id);
  assert.notEqual(must(await createConsolidationSource({ ...input, snapshot, sequence: 1 })).id, first.id);
  assert.equal((await validateConsolidationSource({ ...first, snapshot: { ...snapshot, text: 'forged' } })).status, 'refused');
});

it('uses the existing closed memory shape and refuses unqualified or nonfinite embeddings', async () => {
  for (const bad of [
    { ...snapshot, evidence: '' }, { ...snapshot, extra: true },
    { ...snapshot, embedding: [1, 0] },
    { ...snapshot, embedding: [1, 0], embeddedBy: { model: 'm', dims: 3 } },
    { ...snapshot, embedding: [NaN, 0], embeddedBy: { model: 'm', dims: 2 } },
  ]) {
    const result = await createConsolidationSource({ scope: 'chat', key: 'turn', sequence: 0, snapshot: bad });
    assert.equal(result.status, 'refused');
    if (result.status === 'refused') assert.equal(result.reason, 'invalid-source');
  }
});

it('hashes artifact text, recipe, ordered evidence and fresh embedding identity', async () => {
  const source = must(await createConsolidationSource({ scope: 'chat', key: 'turn', sequence: 0, snapshot }));
  const input = { scope: 'chat', tier: 'deterministic' as const, recipeHash: 'a'.repeat(64), text: snapshot.text,
    sourceIds: [source.id], keywords: ['paris'] };
  const artifact = must(await createConsolidationArtifact(input));
  assert.deepEqual(must(await validateConsolidationArtifact(artifact)), artifact);
  assert.equal((await validateConsolidationArtifact({ ...artifact, text: 'another claim' })).status, 'refused');
  for (const change of [{ sourceIds: [] }, { sourceIds: [source.id, source.id] }, { text: '' },
    { keywords: ['paris', 'paris'] }, { embedding: [1, 0] },
    { embedding: [1, 0], embeddedBy: { model: 'm', dims: 1 } }]) {
    assert.equal((await createConsolidationArtifact({ ...input, ...change })).status, 'refused');
  }
  const embedded = must(await createConsolidationArtifact({ ...input, embedding: [1, 0], embeddedBy: { model: 'm', dims: 2 } }));
  assert.notEqual(embedded.id, artifact.id);
});
