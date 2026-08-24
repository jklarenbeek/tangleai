/**
 * THE alignment test: a Tangle memory unit, projected through
 * `toLedgerMemory`, must be admissible to an unmodified @jarenjs/ai
 * ledger and recallable by it. This is the contract that lets a plain
 * jarenjs agent (site assistant, benchmark harness, anything) consume
 * memories that Tangle's policies curated — if this test breaks, the
 * two projects have drifted apart at the seam that matters most.
 *
 * TS note: `addMemory` is published as `Promise<{}>` (see
 * JARENASK.md), so reading the stored record needs a cast.
 * `recall`'s `any[] | { error }` union, by contrast, narrows cleanly
 * through `Array.isArray`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLedger, createMemoryStorage } from '@jarenjs/ai';
import { toLedgerMemory, type LedgerMemory } from '@tangleai/core/schemas/memory';
import { createMemoryUnitStore, createMemoryUnit } from '@tangleai/memory';

const AT = '2026-08-24T12:00:00Z';
const now = () => AT;

describe('tangle → jarenjs ledger mirror', () => {
  it('a curated tangle memory is admissible and recallable in a jarenjs ledger', async () => {
    const store = createMemoryUnitStore();
    const unit = createMemoryUnit({
      text: 'the deploy gate is npm run site:gate',
      evidence: 'observed in package.json scripts',
      tags: ['deploy', 'gate'],
      at: AT,
      embedding: [0.1, 0.2, 0.3],
      confidence: 0.8,
    });
    await store.put(unit);

    const ledger = createLedger({ storage: createMemoryStorage(), now });
    const stored = await ledger.addMemory(toLedgerMemory(unit)) as { error?: string };
    assert.equal(stored.error, undefined,
      `projection was rejected by the ledger: ${JSON.stringify(stored)}`);

    const recalled = await ledger.recall({ tags: ['deploy'] });
    assert.ok(Array.isArray(recalled));
    assert.equal(recalled.length, 1);
    assert.equal(recalled[0].id, unit.id);
    assert.equal(recalled[0].text, unit.text);
    assert.equal(recalled[0].evidence, unit.evidence);
  });

  it('the ledger strips tangle-only fields on write — what it stores IS the projection', async () => {
    // addMemory rebuilds its record from the five fields it knows, so a
    // full tangle unit does not error — the vector fields just do not
    // survive. The projection and the ledger agree on what a jarenjs
    // memory is; this pins that the agreement holds in both directions.
    const ledger = createLedger({ storage: createMemoryStorage(), now });
    const unit = createMemoryUnit({ text: 'x', evidence: 'e', at: AT, embedding: [1, 2], confidence: 0.7 });
    const stored = await ledger.addMemory(unit) as LedgerMemory;
    assert.deepEqual(stored, toLedgerMemory(unit));
  });
});
