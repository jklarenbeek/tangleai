import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { rankByEmbedding } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

const AT = '2026-08-24T12:00:00Z';

function unit(id: string, embedding?: number[], extra: Partial<MemoryUnit> = {}): MemoryUnit {
  const u: MemoryUnit = { id, text: `text ${id}`, evidence: 'e', tags: [], at: AT, kind: 'fact', ...extra };
  if (embedding) u.embedding = embedding;
  return u;
}

describe('rankByEmbedding', () => {
  it('ranks best-first and honours k', () => {
    const units = [unit('far', [0, 1]), unit('near', [1, 0.01]), unit('mid', [0.7, 0.7])];
    const ranked = rankByEmbedding(units, [1, 0], { k: 2 });
    assert.deepEqual(ranked.map((r) => r.unit.id), ['near', 'mid']);
    assert.ok(ranked[0].score > ranked[1].score);
  });

  it('never surfaces superseded or un-embedded records', () => {
    const units = [
      unit('dead', [1, 0], { supersededBy: 'x' }),
      unit('bare'),
      unit('live', [1, 0]),
    ];
    assert.deepEqual(rankByEmbedding(units, [1, 0]).map((r) => r.unit.id), ['live']);
  });

  it('applies minScore', () => {
    const units = [unit('orthogonal', [0, 1]), unit('aligned', [1, 0])];
    assert.equal(rankByEmbedding(units, [1, 0], { minScore: 0.5 }).length, 1);
  });
});
