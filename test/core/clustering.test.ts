import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { kMeans } from '@tangleai/core/clustering';

/** A tiny LCG so the whole clustering run is reproducible. */
function seededRandom(seed = 42): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('kMeans', () => {
  it('separates two obvious clusters', () => {
    const vectors = [
      [0, 0], [0.1, 0.1], [0.2, 0],
      [10, 10], [10.1, 9.9], [9.9, 10.2],
    ];
    const { centroids, assignments, iterations } = kMeans(vectors, 2, { random: seededRandom() });
    assert.equal(centroids.length, 2);
    assert.ok(iterations >= 1);
    // the first three share a cluster, the last three share the other
    assert.equal(new Set(assignments.slice(0, 3)).size, 1);
    assert.equal(new Set(assignments.slice(3)).size, 1);
    assert.notEqual(assignments[0], assignments[3]);
  });

  it('is deterministic under an injected random source', () => {
    const vectors = [[0, 0], [1, 1], [5, 5], [6, 6], [10, 0]];
    const a = kMeans(vectors, 2, { random: seededRandom(7) });
    const b = kMeans(vectors, 2, { random: seededRandom(7) });
    assert.deepEqual(a, b);
  });

  it('clamps k to the number of points', () => {
    const { centroids, assignments } = kMeans([[1, 2], [3, 4]], 5, { random: seededRandom() });
    assert.equal(centroids.length, 2);
    assert.equal(assignments.length, 2);
  });

  it('answers empty for empty input or non-positive k', () => {
    assert.deepEqual(kMeans([], 3), { centroids: [], assignments: [], iterations: 0 });
    assert.deepEqual(kMeans([[1]], 0), { centroids: [], assignments: [], iterations: 0 });
  });

  it('survives identical points (k-means++ zero-distance path)', () => {
    const vectors = [[1, 1], [1, 1], [1, 1]];
    const { centroids } = kMeans(vectors, 2, { random: seededRandom() });
    assert.equal(centroids.length, 2);
  });
});
