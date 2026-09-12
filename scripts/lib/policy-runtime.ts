/** Probe the public behavior as well as the generated data: literals in consumers must not drift. */
import assert from 'node:assert/strict';
import {
  DEFAULT_MEMORY_POLICY, DEFAULT_NOVELTY_THRESHOLD, DEFAULT_CONTRADICTION_THRESHOLD,
  DEFAULT_CRYSTALLIZE_THRESHOLD, DEFAULT_MAX_PAIRS, noveltyGate, planContradictionPairs,
  planCrystallization, recallByEmbedding, policyThresholds, type MemoryPolicyValues,
} from '@tangleai/memory';
import { DEFAULT_THRESHOLDS, OFFLINE_EMBEDDER_DIMS, createOfflineEmbedder } from '@tangleai/pipeline';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

export async function verifyRuntimePolicy(expected: MemoryPolicyValues): Promise<void> {
  assert.deepEqual(DEFAULT_MEMORY_POLICY, expected, 'Public memory defaults differ from the selected cell');
  const thresholds = policyThresholds(expected);
  assert.deepEqual(DEFAULT_THRESHOLDS, thresholds, 'Pipeline defaults drifted');
  assert.equal(DEFAULT_NOVELTY_THRESHOLD, thresholds.novelty, 'Novelty default drifted');
  assert.equal(DEFAULT_CONTRADICTION_THRESHOLD, thresholds.contradiction, 'Contradiction default drifted');
  assert.equal(DEFAULT_CRYSTALLIZE_THRESHOLD, thresholds.crystallize, 'Crystallization default drifted');
  assert.equal(DEFAULT_MAX_PAIRS, expected.contradiction.maxPairs, 'Pair cap drifted');
  assert.equal(OFFLINE_EMBEDDER_DIMS, expected.embedding.dims, 'Offline width drifted');
  const embedder = createOfflineEmbedder();
  assert.equal(embedder.model, expected.embedding.model);
  assert.equal((await embedder.embed(['policy default probe']))[0].length, expected.embedding.dims);
  const unit = (id: string, cosine = 1): MemoryUnit => ({ id, text: id, evidence: 'runtime policy probe', at: '2026-09-12T00:00:00Z', tags: [], kind: 'fact',
    embeddedBy: { model: 'probe', dims: 2 }, embedding: [cosine, Math.sqrt(1 - cosine * cosine)] });
  const many = Array.from({ length: Math.max(expected.retrieval.k + 1, 10) }, (_, i) => unit(`u${i}`));
  assert.equal(recallByEmbedding(many, [1, 0]).ranked.length, expected.retrieval.k, 'Retrieval k drifted');
  const cutoff = expected.retrieval.minScore;
  assert.deepEqual(recallByEmbedding([unit('above', cutoff + 0.0001), unit('below', cutoff - 0.0001)], [1, 0]).ranked.map(r => r.unit.id), ['above'], 'Retrieval minScore drifted');
  assert.equal(noveltyGate([unit('a'), unit('b')], []).filtered.length, expected.novelty.enabled ? 1 : 0, 'Novelty behavior drifted');
  assert.equal(planCrystallization([unit('a'), unit('b')]).merges.length, expected.crystallization.enabled ? 1 : 0, 'Crystallization behavior drifted');
  assert.equal(planContradictionPairs([unit('a'), unit('b')]).length, expected.contradiction.enabled ? 1 : 0, 'Contradiction behavior drifted');
  assert.equal(planContradictionPairs(many, { threshold: 0 }).length, Math.min(expected.contradiction.maxPairs, many.length * (many.length - 1) / 2), 'Default pair cap behavior drifted');
}
