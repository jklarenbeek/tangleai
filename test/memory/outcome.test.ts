import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryUnitStore, createMemoryUnit, applyOutcome, outcomeAdjustment } from '@tangleai/memory';

const AT = '2026-08-24T12:00:00Z';
const REPORT_AT = '2026-08-24T14:00:00Z';

describe('outcomeAdjustment', () => {
  it('failure hits harder than success helps — the loop stays conservative', () => {
    assert.ok(Math.abs(outcomeAdjustment('failure')) > outcomeAdjustment('success'));
    assert.ok(outcomeAdjustment('partial') > 0);
  });
});

describe('applyOutcome', () => {
  it('moves confidence on ground truth and clamps at the floor', async () => {
    const store = createMemoryUnitStore();
    const boosted = createMemoryUnit({ text: 'use the side door', evidence: 'worked before', at: AT, confidence: 0.5 });
    await store.put(boosted);

    const success = await applyOutcome(store, {
      memoryIds: [boosted.id], outcome: 'success', at: REPORT_AT, evidence: 'door opened',
    });
    assert.equal(success.adjusted, 1);
    assert.ok(Math.abs(((await store.get(boosted.id))?.confidence ?? 0) - 0.65) < 1e-12);

    // hammer it with failures — it stops at the floor, never vanishes
    for (let i = 0; i < 5; i++) {
      await applyOutcome(store, { memoryIds: [boosted.id], outcome: 'failure', at: REPORT_AT, evidence: 'door locked' });
    }
    const floored = await store.get(boosted.id);
    assert.equal(floored?.confidence, 0.1);
    assert.equal(floored?.at, REPORT_AT);
  });

  it('defaults missing confidence to 0.5 before adjusting', async () => {
    const store = createMemoryUnitStore();
    const unit = createMemoryUnit({ text: 'no prior confidence', evidence: 'e', at: AT });
    await store.put(unit);
    await applyOutcome(store, { memoryIds: [unit.id], outcome: 'partial', at: REPORT_AT, evidence: 'meh' });
    assert.ok(Math.abs(((await store.get(unit.id))?.confidence ?? 0) - 0.55) < 1e-12);
  });

  it('reports missing ids instead of swallowing them', async () => {
    const store = createMemoryUnitStore();
    const outcome = await applyOutcome(store, {
      memoryIds: ['m-ghost'], outcome: 'success', at: REPORT_AT, evidence: 'e',
    });
    assert.equal(outcome.adjusted, 0);
    assert.deepEqual(outcome.missing, ['m-ghost']);
  });
});
