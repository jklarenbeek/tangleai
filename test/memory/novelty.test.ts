import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { noveltyGate } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

const AT = '2026-08-24T12:00:00Z';

function unit(id: string, embedding: number[]): MemoryUnit {
  return { id, text: `text ${id}`, evidence: 'test', tags: [], at: AT, kind: 'fact', embedding };
}

describe('noveltyGate', () => {
  it('filters a near-duplicate of an existing memory', () => {
    const existing = [unit('e1', [1, 0, 0])];
    const { novel, filtered } = noveltyGate([unit('c1', [0.99, 0.01, 0]), unit('c2', [0, 1, 0])], existing);
    assert.deepEqual(novel.map((u) => u.id), ['c2']);
    assert.deepEqual(filtered.map((u) => u.id), ['c1']);
  });

  it('filters duplicates WITHIN the batch, not only against the store', () => {
    const { novel, filtered } = noveltyGate(
      [unit('c1', [1, 0]), unit('c2', [0.999, 0.001])],
      [],
    );
    assert.deepEqual(novel.map((u) => u.id), ['c1']);
    assert.deepEqual(filtered.map((u) => u.id), ['c2']);
  });

  it('passes units without an embedding — unmeasurable is not duplicate', () => {
    const bare: MemoryUnit = { id: 'c1', text: 't', evidence: 'e', tags: [], at: AT, kind: 'fact' };
    const { novel, filtered } = noveltyGate([bare], [unit('e1', [1, 0])]);
    assert.equal(novel.length, 1);
    assert.equal(filtered.length, 0);
  });

  it('honours the threshold option', () => {
    const existing = [unit('e1', [1, 0])];
    const candidate = [unit('c1', [0.9, 0.435889894354])]; // cosine ~0.9
    assert.equal(noveltyGate(candidate, existing, { threshold: 0.95 }).novel.length, 1);
    assert.equal(noveltyGate(candidate, existing, { threshold: 0.85 }).novel.length, 0);
  });
});
