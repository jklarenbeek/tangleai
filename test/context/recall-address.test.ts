import { it } from 'node:test';
import assert from 'node:assert/strict';
import { sizeOf } from '@jarenjs/core/chunk';
import { slotAddress, slotAddressesIn } from '@tangleai/context/recall';

it('recall addresses report UTF-16 characters, including astral text', () => {
  for (const text of ['abc', '😀']) {
    const address = slotAddress('example', sizeOf(text));
    assert.equal(address, `[recall("example") · ${text.length} chars]`);
    assert.deepEqual(slotAddressesIn(address), ['example']);
  }
});
