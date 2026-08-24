import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CHARS_PER_TOKEN, estimateTokens, truncateToTokens } from '@tangleai/core/tokens';

describe('estimateTokens', () => {
  it('rounds up at the 4-chars-per-token heuristic', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcde'), 2);
    assert.equal(estimateTokens('x'.repeat(4 * 100)), 100);
  });
});

describe('truncateToTokens', () => {
  it('keeps text that fits and cuts text that does not', () => {
    assert.equal(truncateToTokens('short', 10), 'short');
    const cut = truncateToTokens('x'.repeat(100), 5);
    assert.equal(cut.length, 5 * CHARS_PER_TOKEN);
  });
  it('answers empty for a non-positive budget', () => {
    assert.equal(truncateToTokens('anything', 0), '');
  });
});
