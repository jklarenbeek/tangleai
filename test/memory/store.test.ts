import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryUnitStore, createMemoryUnit } from '@tangleai/memory';
import type { TangleError } from '@tangleai/core/errors';

const AT = '2026-08-24T12:00:00Z';

describe('createMemoryUnitStore', () => {
  it('round-trips a valid unit', async () => {
    const store = createMemoryUnitStore();
    const unit = createMemoryUnit({ text: 'water boils at 100C at sea level', evidence: 'physics', at: AT });
    await store.put(unit);
    assert.deepEqual(await store.get(unit.id), unit);
    assert.equal((await store.list()).length, 1);
    await store.delete(unit.id);
    assert.equal(await store.get(unit.id), undefined);
  });

  it('rejects a malformed unit at the boundary with a coded error', async () => {
    const store = createMemoryUnitStore();
    const malformed = { id: 'm-x', text: 'no evidence', tags: [], at: AT, kind: 'fact' };
    await assert.rejects(
      // deliberately violating the compile-time contract to hit the runtime gate
      () => store.put(malformed as unknown as Parameters<typeof store.put>[0]),
      (err: TangleError) => err.code === 'TA0001',
    );
  });

  it('hands out clones, not live references', async () => {
    const store = createMemoryUnitStore();
    const unit = createMemoryUnit({ text: 'clone me', evidence: 'test', at: AT });
    await store.put(unit);
    const first = await store.get(unit.id);
    assert.ok(first);
    first.text = 'mutated';
    const second = await store.get(unit.id);
    assert.equal(second?.text, 'clone me');
  });
});

describe('createMemoryUnit', () => {
  it('content-addresses the id so re-ingestion is idempotent', () => {
    const a = createMemoryUnit({ text: 'same text', evidence: 'a', at: AT });
    const b = createMemoryUnit({ text: 'same text', evidence: 'b', at: AT });
    assert.equal(a.id, b.id);
    assert.match(a.id, /^m-[a-z0-9]+-9$/);
  });
  it('defaults kind to fact and tags to empty', () => {
    const unit = createMemoryUnit({ text: 'x', evidence: 'e', at: AT });
    assert.equal(unit.kind, 'fact');
    assert.deepEqual(unit.tags, []);
  });
});
