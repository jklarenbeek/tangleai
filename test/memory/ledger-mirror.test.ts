/**
 * THE alignment test: a Tangle memory unit, projected through
 * `toLedgerMemory`, must be admissible to an unmodified @jarenjs/ai
 * ledger and recallable by it — by tag, and, since the ledger learned
 * `recall({ near })`, by meaning through the same embedder that wrote
 * the vector. This is the contract that lets a plain jarenjs agent
 * (site assistant, benchmark harness, anything) consume memories that
 * Tangle's policies curated — if this test breaks, the two projects
 * have drifted apart at the seam that matters most.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createLedger, createMemoryStorage } from '@jarenjs/ai';
import { createHashEmbedder } from '@jarenjs/ai/embed';
import type { LedgerMemory as JarenLedgerMemory } from '@jarenjs/ai/schemas/ledger';
import { toLedgerMemory, type LedgerMemory } from '@tangleai/core/schemas/memory';
import { createMemoryUnitStore, createMemoryUnit } from '@tangleai/memory';

const AT = '2026-08-24T12:00:00Z';
const now = () => AT;

/** The compile-time half of the pin: Tangle's projection IS the ledger's
 * record type, in both directions. A drift in either interface fails
 * `tsc` before any test runs. */
const asJaren = (memory: LedgerMemory): JarenLedgerMemory => memory;
const asTangle = (memory: JarenLedgerMemory): LedgerMemory => memory;
void asJaren;
void asTangle;

describe('tangle → jarenjs ledger mirror', () => {
  it('a curated tangle memory is admissible and recallable in a jarenjs ledger, by tag and by meaning', async () => {
    const embedder = createHashEmbedder();
    const store = createMemoryUnitStore();
    const text = 'the deploy gate is npm run site:gate';
    const [vector] = await embedder.embed([text]);
    const unit = createMemoryUnit({
      text,
      evidence: 'observed in package.json scripts',
      tags: ['deploy', 'gate'],
      at: AT,
      embedding: Array.from(vector),
      embeddedBy: { model: embedder.model, dims: embedder.dims },
      confidence: 0.8,
    });
    await store.put(unit);

    const ledger = createLedger({ storage: createMemoryStorage(), now, embedder });
    const stored = await ledger.addMemory(toLedgerMemory(unit));
    assert.ok(!('error' in stored), `projection was rejected by the ledger: ${JSON.stringify(stored)}`);

    const byTag = await ledger.recall({ tags: ['deploy'] });
    assert.ok(Array.isArray(byTag));
    assert.equal(byTag.length, 1);
    assert.equal(byTag[0].id, unit.id);
    assert.equal(byTag[0].text, unit.text);
    assert.equal(byTag[0].evidence, unit.evidence);

    const byMeaning = await ledger.recall({ near: 'which command is the deploy gate?' });
    assert.ok(!Array.isArray(byMeaning) && !('error' in byMeaning), JSON.stringify(byMeaning));
    assert.equal(byMeaning.memories[0].id, unit.id);
    assert.equal(byMeaning.skipped, 0);
    assert.ok(byMeaning.scores[0] > 0);
  });

  it('the ledger refuses tangle-only fields, so the projection is the only door — and it stores the projection verbatim', async () => {
    // Since jarenjs 0.44 the ledger refuses an unknown member rather
    // than dropping it (a silently dropped field is a silently lost
    // fact), so a full tangle unit is REJECTED and `toLedgerMemory` is
    // not a convenience but the contract. What it projects is stored
    // byte-for-byte, embedding pair included.
    const ledger = createLedger({ storage: createMemoryStorage(), now });
    const unit = createMemoryUnit({
      text: 'x', evidence: 'e', at: AT,
      embedding: [1, 2], embeddedBy: { model: 'test', dims: 2 }, confidence: 0.7,
    });
    const refused = await ledger.addMemory(unit);
    assert.ok('error' in refused, 'kind/confidence are unknown to the ledger');
    const stored = await ledger.addMemory(toLedgerMemory(unit));
    assert.deepEqual(stored, toLedgerMemory(unit));
  });

  it('a vector without its identity is refused by the ledger — and never leaves Tangle in the first place', async () => {
    const ledger = createLedger({ storage: createMemoryStorage(), now });
    const orphan = { ...toLedgerMemory(createMemoryUnit({ text: 'y', evidence: 'e', at: AT })), embedding: [1, 2] };
    const stored = await ledger.addMemory(orphan);
    assert.ok('error' in stored, 'the ledger holds the both-or-neither rule');
    // createMemoryUnit drops a vector that arrives without embeddedBy
    const unit = createMemoryUnit({ text: 'y', evidence: 'e', at: AT, embedding: [1, 2] });
    assert.equal(unit.embedding, undefined);
  });
});
