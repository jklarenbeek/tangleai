import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryUnitStore, planCrystallization, applyCrystallization } from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

const AT = '2026-08-24T12:00:00Z';
const LATER = '2026-08-24T13:00:00Z';
const now = () => LATER;

function unit(id: string, embedding: number[], extra: Partial<MemoryUnit> = {}): MemoryUnit {
  return {
    id, text: `text ${id}`, evidence: `evidence ${id}`, tags: [id], at: AT,
    kind: 'fact', embedding, embeddedBy: { model: 'test', dims: embedding.length }, ...extra,
  };
}

describe('planCrystallization', () => {
  it('plans a merge for a near-duplicate pair, keeping the higher confidence', () => {
    const plan = planCrystallization([
      unit('a', [1, 0], { confidence: 0.9 }),
      unit('b', [0.999, 0.001], { confidence: 0.4 }),
      unit('c', [0, 1], { confidence: 0.5 }),
    ]);
    assert.equal(plan.examined, 3);
    assert.deepEqual(plan.merges.map((m) => [m.keepId, m.removeId]), [['a', 'b']]);
  });

  it('gives a record at most one merge per pass (A~B~C collapses over passes)', () => {
    const plan = planCrystallization([
      unit('a', [1, 0], { confidence: 0.9 }),
      unit('b', [0.9999, 0.0001], { confidence: 0.8 }),
      unit('c', [0.9998, 0.0002], { confidence: 0.7 }),
    ]);
    assert.equal(plan.merges.length, 1);
  });

  it('never merges across embedders', () => {
    const plan = planCrystallization([
      unit('a', [1, 0]),
      unit('b', [1, 0], { embeddedBy: { model: 'other', dims: 2 } }),
    ]);
    assert.deepEqual(plan.merges, []);
  });

  it('skips superseded records and records without embeddings', () => {
    const bare: MemoryUnit = { id: 'c', text: 't', evidence: 'e', tags: [], at: AT, kind: 'fact' };
    const plan = planCrystallization([
      unit('a', [1, 0], { supersededBy: 'x' }),
      unit('b', [1, 0]),
      bare,
    ]);
    assert.equal(plan.merges.length, 0);
  });
});

describe('applyCrystallization', () => {
  it('merges provenance, tags, relations and evidence, then deletes the absorbed record', async () => {
    const store = createMemoryUnitStore();
    const keep = unit('a', [1, 0], { confidence: 0.6, relations: [{ target: 'z', relType: 'RELATES_TO', weight: 0.5 }] });
    const remove = unit('b', [0.999, 0.001], {
      confidence: 0.4,
      mergedFrom: ['b0'],
      relations: [
        { target: 'z', relType: 'RELATES_TO', weight: 0.5 },
        { target: 'w', relType: 'MENTIONS' },
      ],
    });
    await store.put(keep);
    await store.put(remove);

    const plan = planCrystallization([keep, remove]);
    const { crystallized } = await applyCrystallization(store, plan, { now });
    assert.equal(crystallized, 1);

    const merged = await store.get('a');
    assert.ok(merged);
    assert.equal(await store.get('b'), undefined);
    assert.ok(Math.abs((merged.confidence ?? 0) - 0.65) < 1e-12);
    assert.equal(merged.at, LATER);
    assert.deepEqual(merged.mergedFrom, ['b', 'b0']);
    assert.deepEqual(merged.tags, ['a', 'b']);
    assert.ok(merged.evidence.includes('evidence a') && merged.evidence.includes('evidence b'));
    assert.deepEqual(merged.relations, [
      { target: 'z', relType: 'RELATES_TO', weight: 1 },
      { target: 'w', relType: 'MENTIONS' },
    ]);
  });

  it('clamps confidence at 1', async () => {
    const store = createMemoryUnitStore();
    await store.put(unit('a', [1, 0], { confidence: 0.98 }));
    await store.put(unit('b', [0.999, 0.001], { confidence: 0.1 }));
    await applyCrystallization(store, planCrystallization(await store.list()), { now });
    assert.equal((await store.get('a'))?.confidence, 1);
  });

  it('skips a merge whose records vanished instead of guessing', async () => {
    const store = createMemoryUnitStore();
    const { crystallized } = await applyCrystallization(store, {
      merges: [{ keepId: 'ghost', removeId: 'ghost2', similarity: 1 }], examined: 0,
    }, { now });
    assert.equal(crystallized, 0);
  });
});
