import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { rankByEmbedding, recallByEmbedding } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

const AT = '2026-08-24T12:00:00Z';

function unit(id: string, embedding?: number[], extra: Partial<MemoryUnit> = {}): MemoryUnit {
  const u: MemoryUnit = { id, text: `text ${id}`, evidence: 'e', tags: [], at: AT, kind: 'fact', ...extra };
  if (embedding) {
    u.embedding = embedding;
    u.embeddedBy = extra.embeddedBy ?? { model: 'test', dims: embedding.length };
  }
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

describe('recallByEmbedding', () => {
  it('ranks only records embedded by the query identity and reports the rest as skipped', () => {
    const units = [
      unit('mine', [1, 0]),
      unit('theirs', [1, 0], { embeddedBy: { model: 'other', dims: 2 } }),
      unit('bare'),
      unit('gone', [1, 0], { supersededBy: 'mine' }),
    ];
    const { ranked, skipped } = recallByEmbedding(units, [1, 0], { identity: { model: 'test', dims: 2 } });
    assert.deepEqual(ranked.map((r) => r.unit.id), ['mine']);
    assert.equal(skipped, 2, 'the other identity and the bare record — never the superseded one');
  });

  it('takes the Float32Array an embedder answers as the query', () => {
    const { ranked } = recallByEmbedding([unit('a', [0, 1]), unit('b', [1, 0])], new Float32Array([1, 0]));
    assert.equal(ranked[0].unit.id, 'b');
  });
});
