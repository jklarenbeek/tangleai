/**
 * The tier a Studio profile travels in: an Anthropic model refuses an output
 * schema with an object that is not closed, so an open profile goes in the
 * prompt (JSON mode) for it, and every other provider keeps its own tier.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hasOpenObject, profileTier } from '@tangleai/jaren/studio';

const client = (model: string) => ({ endpoint: { model } });
const open = { type: 'object', properties: { state: { type: 'object' } }, additionalProperties: false };
const closed = { type: 'object', properties: { n: { type: 'number' } }, additionalProperties: false };

describe('the Studio profile tier', () => {
  it('finds an open object anywhere in a schema', () => {
    assert.equal(hasOpenObject(open), true);
    assert.equal(hasOpenObject(closed), false);
    assert.equal(hasOpenObject({ type: ['object', 'null'] }), true);
    assert.equal(hasOpenObject({ anyOf: [closed, { $defs: { x: { type: 'object' } } }] }), true);
  });
  it('uses JSON mode for an open profile on an Anthropic model only', () => {
    assert.equal(profileTier(open, client('anthropic/claude-haiku-5.5')), 'json');
    assert.equal(profileTier(open, client('claude-haiku-5-5')), 'json');
    assert.equal(profileTier(closed, client('anthropic/claude-haiku-5.5')), undefined);
    assert.equal(profileTier(open, client('qwen/qwen3.8-27b')), undefined);
    assert.equal(profileTier(open, {}), undefined);
  });
});
