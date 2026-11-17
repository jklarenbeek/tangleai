/**
 * The agent's synchronous SHA-256 answers exactly what Jaren's platform
 * digest answers, so a run identity is the value a host computes for the
 * same prompt and tools with `sha256Hex` or `canonicalSha256`.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '@jarenjs/core/string';
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { sha256HexSync } from '../../packages/agents/src/sha256.ts';

it('equals the platform digest at every padding boundary and for any text', async () => {
  assert.equal(sha256HexSync('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256HexSync(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const texts = [
    ...[1, 54, 55, 56, 57, 63, 64, 65, 111, 119, 120, 127, 128, 129, 1000, 70000].map(n => 'a'.repeat(n)),
    'Grüße aus Zürich', '漢字かな交じり文', 'مرحبا بالعالم', '🎉 emoji 👩‍👩‍👧', 'lone \ud800 surrogate', 'é'.repeat(28), '€'.repeat(19),
  ];
  for (const text of texts) assert.equal(sha256HexSync(text), await sha256Hex(text), `${text.length} characters`);
});

it('over canonical JSON equals canonicalSha256', async () => {
  const tools = [{ type: 'function', function: { name: 'b', description: 'Zoek één ding', parameters: { type: 'object', properties: { z: { type: 'number' }, a: { type: 'string' } } } } }];
  assert.equal(sha256HexSync(canonicalizeJson(tools)), await canonicalSha256(tools));
});
