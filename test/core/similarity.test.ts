import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  similarity,
  cosineSimilarity,
  dotProductSimilarity,
  euclideanSimilarity,
  euclideanDistance,
  l2Normalize,
} from '@tangleai/core/similarity';

describe('cosineSimilarity', () => {
  it('identical vectors score 1', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-12);
  });
  it('orthogonal vectors score 0', () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  });
  it('opposite vectors score -1', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-12);
  });
  it('mismatched or empty input scores 0 instead of throwing', () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
    assert.equal(cosineSimilarity([], []), 0);
    assert.equal(cosineSimilarity(null as unknown as number[], [1]), 0);
  });
  it('zero vector scores 0, not NaN', () => {
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
  });
});

describe('strategies', () => {
  it('dotProduct is the raw dot product', () => {
    assert.equal(dotProductSimilarity([1, 2], [3, 4]), 11);
  });
  it('euclidean similarity is 1/(1+distance), 1 for identical', () => {
    assert.equal(euclideanSimilarity([1, 1], [1, 1]), 1);
    assert.equal(euclideanSimilarity([0, 0], [3, 4]), 1 / 6);
  });
  it('euclidean distance of mismatched input is Infinity, similarity 0', () => {
    assert.equal(euclideanDistance([1], [1, 2]), Infinity);
    assert.equal(euclideanSimilarity([1], [1, 2]), 0);
  });
  it('similarity() dispatches and defaults to cosine', () => {
    assert.equal(similarity([1, 0], [1, 0]), cosineSimilarity([1, 0], [1, 0]));
    assert.equal(similarity([1, 2], [3, 4], 'dotProduct'), 11);
    assert.equal(similarity([1, 1], [1, 1], 'euclidean'), 1);
  });
});

describe('l2Normalize', () => {
  it('normalises in place to unit length', () => {
    const v = [3, 4];
    const out = l2Normalize(v);
    assert.equal(out, v);
    assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-12);
  });
  it('leaves a zero vector untouched', () => {
    assert.deepEqual(l2Normalize([0, 0]), [0, 0]);
  });
});
